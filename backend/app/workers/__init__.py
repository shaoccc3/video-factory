"""Celery 應用：broker 與結果後端用 Valkey（Redis 協議相容）。

啟動：uv run celery -A app.workers worker -l info
"""

from celery import Celery
from celery.signals import worker_init

from app.core.readiness import worker_preflight
from app.core.settings import get_settings

_settings = get_settings()

app = Celery(
    "video_factory",
    broker=_settings.broker_url,
    backend=_settings.result_backend,
    include=["app.workers.tasks"],
)
app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    task_ignore_result=True,
    result_expires=3600,
    timezone="UTC",
    # 分鏡生成可能要數分鐘；只對 compose 另設較長時限
    task_soft_time_limit=45 * 60,
    task_time_limit=50 * 60,
)


@worker_init.connect
def _preflight(**_: object) -> None:
    """worker 啟動前自檢臨時目錄、字體與 ffmpeg（不要等到第一個任務才失敗）。"""
    worker_preflight(_settings)
