"""對象存儲：S3 相容（開發 SeaweedFS、生產公網 S3）與本地目錄（測試、無 Docker 的開發）。"""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.settings import Settings

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client

CHUNK = 1024 * 1024


@dataclass(frozen=True)
class ObjectRange:
    body: Iterator[bytes]
    start: int
    end: int  # 含
    total: int


class Storage(Protocol):
    def put_file(self, key: str, path: Path, content_type: str) -> None: ...
    def put_bytes(self, key: str, data: bytes, content_type: str) -> None: ...
    def download_to(self, key: str, path: Path) -> None: ...
    def size(self, key: str) -> int: ...
    def open_range(self, key: str, start: int = 0, end: int | None = None) -> ObjectRange: ...
    def presigned_get(self, key: str, expires_s: int) -> str | None: ...
    def delete(self, key: str) -> None: ...
    def check(self) -> None: ...


def create_s3_client(
    settings: Settings, *, timeout_s: float = 10.0, endpoint_url: str | None = None
) -> S3Client:
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url or settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key.get_secret_value() if settings.s3_access_key else None,
        aws_secret_access_key=(settings.s3_secret_key.get_secret_value() if settings.s3_secret_key else None),
        config=Config(
            connect_timeout=timeout_s,
            read_timeout=timeout_s * 6,
            retries={"max_attempts": 3, "mode": "standard"},
            s3={"addressing_style": "path"},
            signature_version="s3v4",
        ),
    )


def ensure_bucket(client: S3Client, bucket: str) -> bool:
    """bucket 不存在就建立。返回是否新建。"""
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code not in ("404", "NoSuchBucket", "NotFound"):
            raise
        client.create_bucket(Bucket=bucket)
        return True
    return False


class S3Storage:
    def __init__(self, settings: Settings) -> None:
        self.bucket = settings.s3_bucket
        self.client = create_s3_client(settings)
        self.public_client = (
            create_s3_client(settings, endpoint_url=settings.s3_public_endpoint_url)
            if settings.s3_public_endpoint_url
            else None
        )
        self.check_timeout = settings.readiness_timeout_s
        self._settings = settings

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        self.client.upload_file(str(path), self.bucket, key, ExtraArgs={"ContentType": content_type})

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def download_to(self, key: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(path))

    def size(self, key: str) -> int:
        return self.client.head_object(Bucket=self.bucket, Key=key)["ContentLength"]

    def open_range(self, key: str, start: int = 0, end: int | None = None) -> ObjectRange:
        total = self.size(key)
        last = total - 1 if end is None else min(end, total - 1)
        resp = self.client.get_object(Bucket=self.bucket, Key=key, Range=f"bytes={start}-{last}")
        body = resp["Body"]
        return ObjectRange(body.iter_chunks(CHUNK), start, last, total)

    def presigned_get(self, key: str, expires_s: int) -> str | None:
        client = self.public_client or self.client
        return client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires_s
        )

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def check(self) -> None:
        create_s3_client(self._settings, timeout_s=self.check_timeout).head_bucket(Bucket=self.bucket)


class LocalStorage:
    """本地目錄存儲。無法給外部服務拉取（presigned_get 返回 None），只用於測試與 Mock 開發。"""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError("非法的存儲鍵")
        return path

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, dest)

    def put_bytes(self, key: str, data: bytes, content_type: str) -> None:
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

    def download_to(self, key: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self._path(key), path)

    def size(self, key: str) -> int:
        return self._path(key).stat().st_size

    def open_range(self, key: str, start: int = 0, end: int | None = None) -> ObjectRange:
        path = self._path(key)
        total = path.stat().st_size
        last = total - 1 if end is None else min(end, total - 1)

        def gen() -> Iterator[bytes]:
            with path.open("rb") as fh:
                fh.seek(start)
                remaining = last - start + 1
                while remaining > 0:
                    chunk = fh.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return ObjectRange(gen(), start, last, total)

    def presigned_get(self, key: str, expires_s: int) -> str | None:
        return None

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def check(self) -> None:
        if not self.root.is_dir():
            raise FileNotFoundError(str(self.root))


def create_storage(settings: Settings) -> Storage:
    if settings.storage_backend == "local":
        return LocalStorage(settings.local_storage_dir)
    return S3Storage(settings)
