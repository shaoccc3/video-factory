"""批量建立：CSV（每行一條任務）或多張圖片（每張一個圖生影片任務）。按 max_parallel 限制同時運行數。"""

import csv
import io
import shutil
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import func, select

from app.api.assets import ingest_upload, save_upload
from app.api.deps import CreatorUser, CurrentUser, DispatcherDep, RuntimeDep, SessionDep
from app.api.schemas import BatchDetail, BatchOut
from app.api.serializers import job_summaries
from app.models import Batch, Job, Template, User
from app.models.enums import AssetKind, Role, VideoType
from app.pipeline.orchestrator import ActionError
from app.services.audit import audit
from app.services.jobs import JobInput, create_job

router = APIRouter(prefix="/batches", tags=["batches"])
CSV_FIELDS = ("title", "topic", "extra")


async def _template(session: SessionDep, template_id: uuid.UUID) -> Template:
    tpl = await session.get(Template, template_id)
    if tpl is None or not tpl.is_active:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "模板不存在或已停用")
    return tpl


async def _batch_out(session: SessionDep, batch: Batch) -> BatchOut:
    rows = await session.execute(
        select(Job.status, func.count()).where(Job.batch_id == batch.id).group_by(Job.status)
    )
    tpl = await session.get(Template, batch.template_id)
    return BatchOut(
        id=batch.id,
        template_id=batch.template_id,
        template_name=tpl.name if tpl else "",
        total=batch.total,
        max_parallel=batch.max_parallel,
        status=batch.status,
        created_at=batch.created_at,
        counts={status_: int(n) for status_, n in rows.all()},
    )


def parse_csv(data: bytes, limit: int) -> list[dict[str, str]]:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "CSV 必須是 UTF-8 編碼") from exc
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or "topic" not in [f.strip() for f in reader.fieldnames]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "CSV 需要表頭，至少包含 topic 欄（可選 title、extra）"
        )
    rows = []
    for row in reader:
        clean = {k.strip(): (v or "").strip() for k, v in row.items() if k}
        if clean.get("topic"):
            rows.append({f: clean.get(f, "") for f in CSV_FIELDS})
    if not rows:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "CSV 沒有有效的資料行")
    if len(rows) > limit:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"一次最多 {limit} 條")
    return rows


async def _create_batch(
    session: SessionDep,
    runtime: RuntimeDep,
    user: User,
    tpl: Template,
    inputs: list[JobInput],
    max_parallel: int,
    draft_mode: bool,
) -> Batch:
    batch = Batch(
        owner_id=user.id,
        template_id=tpl.id,
        total=len(inputs),
        max_parallel=max_parallel,
        draft_mode=draft_mode,
    )
    session.add(batch)
    await session.flush()
    for data in inputs:
        data.batch_id = batch.id
        data.draft_mode = draft_mode
        try:
            await create_job(session, runtime.config, runtime.settings.ark_region, user, data)
        except ActionError as exc:
            raise HTTPException(exc.status, f"第 {inputs.index(data) + 1} 條：{exc}") from exc
    return batch


@router.post("/csv", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
async def create_from_csv(
    user: CreatorUser,
    session: SessionDep,
    runtime: RuntimeDep,
    dispatcher: DispatcherDep,
    request: Request,
    template_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    max_parallel: int = Form(default=2, ge=1, le=10),
    draft_mode: bool = Form(default=False),
) -> BatchOut:
    tpl = await _template(session, template_id)
    tmp = Path(tempfile.mkdtemp(prefix="batch-"))
    try:
        path = await save_upload(runtime, file, AssetKind.CSV, tmp)
        rows = parse_csv(path.read_bytes(), runtime.settings.batch_max_items)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    inputs = [
        JobInput(template_id=tpl.id, title=r["title"] or r["topic"][:30], topic=r["topic"], extra=r["extra"])
        for r in rows
    ]
    batch = await _create_batch(session, runtime, user, tpl, inputs, max_parallel, draft_mode)
    audit(
        session,
        request,
        user.id,
        "batch_create",
        target_type="batch",
        target_id=batch.id,
        source="csv",
        total=batch.total,
    )
    await session.commit()
    dispatcher.batch(batch.id)
    return await _batch_out(session, batch)


@router.post("/images", response_model=BatchOut, status_code=status.HTTP_201_CREATED)
async def create_from_images(
    user: CreatorUser,
    session: SessionDep,
    runtime: RuntimeDep,
    dispatcher: DispatcherDep,
    request: Request,
    template_id: uuid.UUID = Form(...),
    files: list[UploadFile] = File(...),
    topic: str = Form(..., min_length=1, max_length=500),
    max_parallel: int = Form(default=2, ge=1, le=10),
    draft_mode: bool = Form(default=False),
) -> BatchOut:
    tpl = await _template(session, template_id)
    if tpl.video_type != VideoType.QUICK:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "圖片批量只支援「圖片／文字轉短片」模板")
    if not files or len(files) > runtime.settings.batch_max_items:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"請上傳 1～{runtime.settings.batch_max_items} 張圖片"
        )
    tmp = Path(tempfile.mkdtemp(prefix="batch-"))
    inputs = []
    try:
        for f in files:
            asset = await ingest_upload(runtime, f, AssetKind.PRODUCT, user, ["批量"], tmp)
            session.add(asset)
            await session.flush()
            title = Path(asset.display_name).stem[:60] or topic[:30]
            inputs.append(JobInput(template_id=tpl.id, title=title, topic=topic, image_asset_id=asset.id))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    batch = await _create_batch(session, runtime, user, tpl, inputs, max_parallel, draft_mode)
    audit(
        session,
        request,
        user.id,
        "batch_create",
        target_type="batch",
        target_id=batch.id,
        source="images",
        total=batch.total,
    )
    await session.commit()
    dispatcher.batch(batch.id)
    return await _batch_out(session, batch)


@router.get("", response_model=list[BatchOut])
async def list_batches(user: CurrentUser, session: SessionDep) -> list[BatchOut]:
    query = select(Batch).order_by(Batch.created_at.desc()).limit(100)
    if not ({Role.ADMIN, Role.REVIEWER} & set(user.roles)):
        query = query.where(Batch.owner_id == user.id)
    return [await _batch_out(session, b) for b in (await session.scalars(query)).all()]


@router.get("/{batch_id}", response_model=BatchDetail)
async def get_batch(batch_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> BatchDetail:
    batch = await session.get(Batch, batch_id)
    if batch is None or (batch.owner_id != user.id and not ({Role.ADMIN, Role.REVIEWER} & set(user.roles))):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "批量不存在")
    jobs = (await session.scalars(select(Job).where(Job.batch_id == batch.id).order_by(Job.created_at))).all()
    out = await _batch_out(session, batch)
    return BatchDetail(**out.model_dump(), jobs=await job_summaries(session, jobs))
