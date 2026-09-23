# video-factory 後端映像（api、worker、migrate、storage-init 共用）。構建上下文為倉庫根目錄：
#   docker build -f backend/Dockerfile .
FROM ghcr.io/astral-sh/uv:python3.13-trixie-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app && useradd --system --gid app --home-dir /srv app

WORKDIR /srv/backend

COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev --no-install-project

COPY config /srv/config
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY backend/app ./app

ENV PATH="/srv/backend/.venv/bin:$PATH"
USER app
EXPOSE 8000
CMD ["uvicorn", "--factory", "app.main:app_factory", "--host", "0.0.0.0", "--port", "8000"]
