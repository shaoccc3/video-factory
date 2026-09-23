"""素材：上傳校驗（按文件內容判斷類型）、存儲、縮圖、給模型用的 URL。"""

import asyncio
import contextlib
import hashlib
import tempfile
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.media.ffmpeg import FFmpegError, probe, run_ffmpeg
from app.models import Asset
from app.models.enums import AssetKind
from app.services.runtime import Runtime

IMAGE_KINDS = frozenset(
    {
        AssetKind.LOGO,
        AssetKind.PRODUCT,
        AssetKind.IMAGE,
        AssetKind.KEYFRAME,
        AssetKind.LAST_FRAME,
        AssetKind.COVER,
    }
)
VIDEO_KINDS = frozenset({AssetKind.CLIP, AssetKind.FINAL})
AUDIO_KINDS = frozenset({AssetKind.BGM, AssetKind.VOICE})

MIME_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/mp4": ".m4a",
    "font/otf": ".otf",
    "font/ttf": ".ttf",
    "font/collection": ".ttc",
    "text/csv": ".csv",
    "application/x-subrip": ".srt",
}


class UploadRejectedError(ValueError):
    pass


def sniff_mime(head: bytes) -> str | None:
    """按文件頭判斷類型，不信任文件名與瀏覽器給的 Content-Type。"""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav"
    if head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        return "audio/mp4" if brand in (b"M4A ", b"M4B ") else "video/mp4"
    if head.startswith(b"OTTO"):
        return "font/otf"
    if head.startswith((b"\x00\x01\x00\x00", b"true")):
        return "font/ttf"
    if head.startswith(b"ttcf"):
        return "font/collection"
    return None


ALLOWED_UPLOAD: dict[AssetKind, frozenset[str]] = {
    AssetKind.LOGO: frozenset({"image/png", "image/jpeg", "image/webp"}),
    AssetKind.PRODUCT: frozenset({"image/png", "image/jpeg", "image/webp"}),
    AssetKind.IMAGE: frozenset({"image/png", "image/jpeg", "image/webp"}),
    AssetKind.BGM: frozenset({"audio/mpeg", "audio/wav", "audio/mp4"}),
    AssetKind.FONT: frozenset({"font/otf", "font/ttf", "font/collection"}),
}


def max_bytes_for(runtime: Runtime, kind: AssetKind) -> int:
    s = runtime.settings
    if kind in AUDIO_KINDS:
        return s.upload_max_audio_bytes
    if kind == AssetKind.FONT:
        return s.upload_max_font_bytes
    if kind == AssetKind.CSV:
        return s.upload_max_csv_bytes
    return s.upload_max_image_bytes


def validate_upload(runtime: Runtime, kind: AssetKind, path: Path) -> str:
    size = path.stat().st_size
    if size == 0:
        raise UploadRejectedError("文件是空的")
    if size > max_bytes_for(runtime, kind):
        raise UploadRejectedError(f"文件超過大小上限（{max_bytes_for(runtime, kind) // 1024 // 1024} MB）")
    allowed = ALLOWED_UPLOAD.get(kind)
    if allowed is None:
        raise UploadRejectedError("不支援上傳這種素材類型")
    with path.open("rb") as fh:
        mime = sniff_mime(fh.read(32))
    if mime not in allowed:
        raise UploadRejectedError("文件類型不符合（按文件內容判斷）")
    return mime


def sanitize_display_name(name: str | None) -> str:
    if not name:
        return ""
    base = Path(name).name
    cleaned = "".join(ch for ch in base if ch.isprintable() and ch not in '<>:"/\\|?*')
    return cleaned[:120]


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def storage_key(kind: str, ext: str) -> str:
    now = datetime.now(UTC)
    return f"{kind}/{now:%Y/%m}/{uuid.uuid4().hex}{ext}"


async def make_thumbnail(src: Path, dest: Path, *, is_video: bool) -> Path | None:
    args = ["-ss", "1", "-i", str(src)] if is_video else ["-i", str(src)]
    args += ["-frames:v", "1", "-vf", "scale='min(360,iw)':-2", "-q:v", "4", str(dest)]
    try:
        await run_ffmpeg(args, timeout_s=60)
    except FFmpegError:
        if not is_video:
            return None
        try:  # 影片短於 1 秒時取第一幀
            await run_ffmpeg(["-i", str(src), "-frames:v", "1", "-vf", "scale='min(360,iw)':-2", str(dest)])
        except FFmpegError:
            return None
    return dest


@dataclass(frozen=True)
class NewAsset:
    path: Path
    kind: AssetKind
    mime: str
    owner_id: uuid.UUID | None
    job_id: uuid.UUID | None = None
    source: str = "generated"
    display_name: str = ""
    tags: tuple[str, ...] = ()


async def store_asset(runtime: Runtime, new: NewAsset) -> Asset:
    """把本地文件存進對象存儲，返回未提交的 Asset（呼叫方 add 到 session）。"""
    ext = MIME_EXT.get(new.mime, new.path.suffix or ".bin")
    key = storage_key(new.kind.value, ext)
    width = height = None
    duration = None
    thumb_key = None
    if new.kind in IMAGE_KINDS or new.kind in VIDEO_KINDS:
        try:
            info = await probe(new.path)
            width, height, duration = (
                info.width,
                info.height,
                info.duration_s if new.kind in VIDEO_KINDS else None,
            )
        except FFmpegError:
            pass
        with tempfile.TemporaryDirectory() as tmp:
            thumb = await make_thumbnail(new.path, Path(tmp) / "thumb.jpg", is_video=new.kind in VIDEO_KINDS)
            if thumb is not None:
                thumb_key = storage_key(f"{new.kind.value}-thumb", ".jpg")
                await asyncio.to_thread(runtime.storage.put_file, thumb_key, thumb, "image/jpeg")
    elif new.kind in AUDIO_KINDS:
        with contextlib.suppress(FFmpegError):
            duration = (await probe(new.path)).duration_s
    await asyncio.to_thread(runtime.storage.put_file, key, new.path, new.mime)
    return Asset(
        owner_id=new.owner_id,
        job_id=new.job_id,
        kind=new.kind.value,
        storage_key=key,
        thumbnail_key=thumb_key,
        mime=new.mime,
        size=new.path.stat().st_size,
        sha256=_sha256(new.path),
        width=width,
        height=height,
        duration_s=duration,
        tags=list(new.tags),
        display_name=new.display_name,
        source=new.source,
    )


class AssetUrlError(RuntimeError):
    pass


def model_input_url(runtime: Runtime, asset: Asset) -> str:
    """給 Seedance／Seedream 拉取的 URL（預簽名、有效期覆蓋排隊時間）。Mock 模式用內部標識。"""
    if runtime.providers.mode == "mock":
        return f"asset://{asset.id}"
    url = runtime.storage.presigned_get(asset.storage_key, runtime.settings.presign_expires_s)
    if not url:
        raise AssetUrlError(
            "目前的存儲無法生成公網可訪問的地址，圖生影片需要公網對象存儲（S3_PUBLIC_ENDPOINT_URL）"
        )
    return url


async def fetch_to(runtime: Runtime, asset: Asset, dest: Path) -> Path:
    await asyncio.to_thread(runtime.storage.download_to, asset.storage_key, dest)
    return dest
