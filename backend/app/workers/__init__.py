"""Celery 應用：broker 與結果後端用 Valkey（Redis 協議相容）。

啟動：uv run celery -A app.workers worker -l info
"""

from celery import Celery

from app.core.settings import get_settings

_settings = get_settings()

app = Celery(
    "video_factory",
    broker=_settings.valkey_url,
    backend=_settings.valkey_url,
    include=["app.workers.tasks"],
)
app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    timezone="UTC",
)
