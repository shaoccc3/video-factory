"""S3 相容對象存儲的客戶端（開發用 SeaweedFS，生產用公網可訪問的 S3 相容存儲）。"""

from typing import TYPE_CHECKING

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.settings import Settings

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


def create_s3_client(settings: Settings, *, timeout_s: float = 5.0) -> "S3Client":
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key.get_secret_value()
        if settings.s3_access_key
        else None,
        aws_secret_access_key=(
            settings.s3_secret_key.get_secret_value() if settings.s3_secret_key else None
        ),
        config=Config(
            connect_timeout=timeout_s,
            read_timeout=timeout_s,
            retries={"max_attempts": 1},
            s3={"addressing_style": "path"},
        ),
    )


def ensure_bucket(client: "S3Client", bucket: str) -> bool:
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
