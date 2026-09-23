from collections.abc import Iterator

import pytest

from app.workers import app as celery_app
from app.workers.tasks import ping


@pytest.fixture(autouse=True)
def eager() -> Iterator[None]:
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    yield
    celery_app.conf.task_always_eager = False


def test_ping_eager() -> None:
    assert ping.delay().get(timeout=1) == "pong"
