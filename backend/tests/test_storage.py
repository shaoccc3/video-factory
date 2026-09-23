from typing import Any

import pytest
from botocore.exceptions import ClientError

from app.core.storage import ensure_bucket


class FakeS3:
    def __init__(self, head_error: str | None) -> None:
        self.head_error = head_error
        self.created: list[str] = []

    def head_bucket(self, **kwargs: Any) -> None:
        if self.head_error:
            raise ClientError({"Error": {"Code": self.head_error}}, "HeadBucket")

    def create_bucket(self, **kwargs: Any) -> None:
        self.created.append(kwargs["Bucket"])


def test_existing_bucket_not_recreated() -> None:
    s3 = FakeS3(head_error=None)
    assert ensure_bucket(s3, "b") is False  # type: ignore[arg-type]
    assert s3.created == []


def test_missing_bucket_created() -> None:
    s3 = FakeS3(head_error="404")
    assert ensure_bucket(s3, "b") is True  # type: ignore[arg-type]
    assert s3.created == ["b"]


def test_other_errors_propagate() -> None:
    s3 = FakeS3(head_error="403")
    with pytest.raises(ClientError):
        ensure_bucket(s3, "b")  # type: ignore[arg-type]
