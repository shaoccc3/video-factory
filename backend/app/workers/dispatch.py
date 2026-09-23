"""把流水線步驟派發到 Celery（按任務名發送，API 進程不需要導入 worker 代碼）。"""

import uuid

from celery import Celery

TASK_SCRIPT = "video_factory.script"
TASK_SCENE = "video_factory.scene"
TASK_COMPOSE = "video_factory.compose"
TASK_BATCH = "video_factory.batch"
TASK_KEYFRAME = "video_factory.keyframe"


class CeleryDispatcher:
    def __init__(self, app: Celery) -> None:
        self._app = app

    def script(self, job_id: uuid.UUID) -> None:
        self._app.send_task(TASK_SCRIPT, args=[str(job_id)])

    def scene(self, job_id: uuid.UUID, scene_id: uuid.UUID) -> None:
        self._app.send_task(TASK_SCENE, args=[str(job_id), str(scene_id)])

    def compose(self, job_id: uuid.UUID) -> None:
        self._app.send_task(TASK_COMPOSE, args=[str(job_id)])

    def batch(self, batch_id: uuid.UUID) -> None:
        self._app.send_task(TASK_BATCH, args=[str(batch_id)])

    def keyframe(self, job_id: uuid.UUID, scene_id: uuid.UUID) -> None:
        self._app.send_task(TASK_KEYFRAME, args=[str(job_id), str(scene_id)])
