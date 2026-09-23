"""Celery 任務。"""

from app.workers import app


@app.task(name="video_factory.ping")
def ping() -> str:
    return "pong"
