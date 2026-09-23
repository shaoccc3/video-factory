"""素材庫：上傳、列表、內容串流（支援 Range）、縮圖、下載（成片需審核通過）。"""

import asyncio
import re
import shutil
import tempfile
import uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select

from app.api.deps import CurrentUser, RuntimeDep, SessionDep
from app.api.schemas import AssetOut, Page
from app.api.serializers import asset_out
from app.models import Asset, Job, User
from app.models.enums import UPLOADABLE_KINDS, AssetKind, JobStatus, Role
from app.services.assets import (
    NewAsset,
    UploadRejectedError,
    max_bytes_for,
    sanitize_display_name,
    store_asset,
    validate_upload,
)
from app.services.audit import audit
from app.services.runtime import Runtime

router = APIRouter(prefix="/assets", tags=["assets"])
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


async def save_upload(runtime: Runtime, file: UploadFile, kind: AssetKind, dest_dir: Path) -> Path:
    """邊讀邊寫並檢查大小，超限立即中止。"""
    limit = max_bytes_for(runtime, kind)
    dest = dest_dir / uuid.uuid4().hex
    written = 0
    with dest.open("wb") as fh:
        while chunk := await file.read(1024 * 1024):
            written += len(chunk)
            if written > limit:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT, f"文件超過大小上限（{limit // 1024 // 1024} MB）"
                )
            fh.write(chunk)
    return dest


async def ingest_upload(
    runtime: Runtime, file: UploadFile, kind: AssetKind, owner: User, tags: list[str], tmp_dir: Path
) -> Asset:
    path = await save_upload(runtime, file, kind, tmp_dir)
    try:
        mime = validate_upload(runtime, kind, path)
    except UploadRejectedError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    return await store_asset(
        runtime,
        NewAsset(
            path,
            kind,
            mime,
            owner.id,
            source="upload",
            display_name=sanitize_display_name(file.filename),
            tags=tuple(tags),
        ),
    )


def parse_tags(raw: str | None) -> list[str]:
    if not raw:
        return []
    tags = [t.strip()[:30] for t in re.split(r"[,，]", raw) if t.strip()]
    return list(dict.fromkeys(tags))[:20]


@router.post("", response_model=AssetOut, status_code=status.HTTP_201_CREATED)
async def upload(
    user: CurrentUser,
    session: SessionDep,
    runtime: RuntimeDep,
    request: Request,
    file: UploadFile = File(...),
    kind: AssetKind = Form(...),
    tags: str | None = Form(default=None),
) -> AssetOut:
    if kind not in UPLOADABLE_KINDS:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "不支援上傳這種素材類型")
    tmp = Path(tempfile.mkdtemp(prefix="upload-"))
    try:
        asset = await ingest_upload(runtime, file, kind, user, parse_tags(tags), tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    session.add(asset)
    await session.flush()
    audit(
        session,
        request,
        user.id,
        "asset_upload",
        target_type="asset",
        target_id=asset.id,
        kind=kind.value,
        size=asset.size,
    )
    await session.commit()
    return asset_out(asset)


@router.get("", response_model=Page[AssetOut])
async def list_assets(
    user: CurrentUser,
    session: SessionDep,
    kind: AssetKind | None = None,
    tag: str | None = Query(default=None, max_length=30),
    q: str | None = Query(default=None, max_length=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=100),
) -> Page[AssetOut]:
    query = select(Asset).where(Asset.is_deleted.is_(False))
    if kind is not None:
        query = query.where(Asset.kind == kind.value)
    else:  # 素材庫預設只列上傳的素材與關鍵幀
        query = query.where(or_(Asset.source == "upload", Asset.kind == AssetKind.KEYFRAME.value))
    if not ({Role.ADMIN, Role.REVIEWER} & set(user.roles)):
        query = query.where(or_(Asset.source == "upload", Asset.owner_id == user.id))
    if q:
        query = query.where(Asset.display_name.ilike(f"%{q.strip()}%"))
    rows = list((await session.scalars(query.order_by(Asset.created_at.desc()))).all())
    if tag:
        rows = [a for a in rows if tag in (a.tags or [])]
    total = len(rows)
    items = rows[(page - 1) * page_size : page * page_size]
    return Page(items=[asset_out(a) for a in items], total=total)


async def _visible_asset(session: SessionDep, asset_id: uuid.UUID, user: User) -> tuple[Asset, Job | None]:
    asset = await session.get(Asset, asset_id)
    if asset is None or asset.is_deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "素材不存在")
    privileged = bool({Role.ADMIN, Role.REVIEWER} & set(user.roles))
    job = await session.get(Job, asset.job_id) if asset.job_id else None
    if asset.source == "upload" or privileged or asset.owner_id == user.id:
        return asset, job
    if asset.kind == AssetKind.FINAL and job is not None and job.status == JobStatus.APPROVED:
        return asset, job
    raise HTTPException(status.HTTP_404_NOT_FOUND, "素材不存在")


@router.get("/{asset_id}", response_model=AssetOut)
async def get_asset(asset_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> AssetOut:
    asset, _ = await _visible_asset(session, asset_id, user)
    return asset_out(asset)


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset(
    asset_id: uuid.UUID, user: CurrentUser, session: SessionDep, request: Request
) -> Response:
    asset, _ = await _visible_asset(session, asset_id, user)
    if asset.source != "upload":
        raise HTTPException(status.HTTP_409_CONFLICT, "只能刪除上傳的素材")
    if asset.owner_id != user.id and Role.ADMIN not in user.roles:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "只能刪除自己上傳的素材")
    asset.is_deleted = True  # 軟刪除：已引用的任務仍可追溯
    audit(session, request, user.id, "asset_delete", target_type="asset", target_id=asset.id)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _stream(
    runtime: Runtime, key: str, mime: str, range_header: str | None, extra: dict[str, str]
) -> StreamingResponse:
    total = runtime.storage.size(key)
    start, end = 0, total - 1
    status_code = status.HTTP_200_OK
    if range_header and (m := RANGE_RE.fullmatch(range_header.strip())):
        s, e = m.groups()
        if s == "" and e:
            start, end = max(0, total - int(e)), total - 1
        else:
            start = int(s or 0)
            end = min(int(e), total - 1) if e else total - 1
        if start > end or start >= total:
            raise HTTPException(status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE, "Range 不合法")
        status_code = status.HTTP_206_PARTIAL_CONTENT
    obj = runtime.storage.open_range(key, start, end)
    headers = {"Accept-Ranges": "bytes", "Content-Length": str(end - start + 1), **extra}
    if status_code == status.HTTP_206_PARTIAL_CONTENT:
        headers["Content-Range"] = f"bytes {start}-{end}/{total}"
    return StreamingResponse(obj.body, status_code=status_code, media_type=mime, headers=headers)


@router.get("/{asset_id}/content")
async def content(
    asset_id: uuid.UUID, user: CurrentUser, session: SessionDep, runtime: RuntimeDep, request: Request
) -> StreamingResponse:
    asset, _ = await _visible_asset(session, asset_id, user)
    return await asyncio.to_thread(
        _stream,
        runtime,
        asset.storage_key,
        asset.mime,
        request.headers.get("range"),
        {"Cache-Control": "private, max-age=300"},
    )


@router.get("/{asset_id}/thumbnail")
async def thumbnail(
    asset_id: uuid.UUID, user: CurrentUser, session: SessionDep, runtime: RuntimeDep
) -> StreamingResponse:
    asset, _ = await _visible_asset(session, asset_id, user)
    if not asset.thumbnail_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "沒有縮圖")
    return await asyncio.to_thread(
        _stream, runtime, asset.thumbnail_key, "image/jpeg", None, {"Cache-Control": "private, max-age=3600"}
    )


@router.get("/{asset_id}/download")
async def download(
    asset_id: uuid.UUID, user: CurrentUser, session: SessionDep, runtime: RuntimeDep, request: Request
) -> StreamingResponse:
    asset, job = await _visible_asset(session, asset_id, user)
    if asset.kind in (AssetKind.FINAL, AssetKind.SUBTITLE, AssetKind.COVER) and (
        job is None or job.status != JobStatus.APPROVED
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "成片需審核通過後才能下載")
    name = asset.display_name or f"{asset.id}"
    audit(
        session,
        request,
        user.id,
        "asset_download",
        target_type="asset",
        target_id=asset.id,
        job_id=str(job.id) if job else None,
    )
    await session.commit()
    disposition = f"attachment; filename*=UTF-8''{quote(name)}"
    return await asyncio.to_thread(
        _stream, runtime, asset.storage_key, asset.mime, None, {"Content-Disposition": disposition}
    )
