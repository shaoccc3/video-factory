# video-factory 後端映像（api、worker、migrate、storage-init 共用）。構建上下文為倉庫根目錄：
#   docker build -f backend/Dockerfile .
FROM ghcr.io/astral-sh/uv:python3.13-trixie-slim

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

# ffmpeg；字幕字體從 fonts-noto-cjk 抽出繁中字面（SIL OFL）後移除整包，減小映像
COPY scripts/fetch_fonts.py /tmp/fetch_fonts.py
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk \
    && uv run --no-project --with fonttools python /tmp/fetch_fonts.py --dest /srv/assets/fonts \
    && apt-get purge -y fonts-noto-cjk && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/fetch_fonts.py \
    && groupadd --system app && useradd --system --gid app --home-dir /srv app

WORKDIR /srv/backend

COPY backend/pyproject.toml backend/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev --no-install-project

COPY config /srv/config
COPY assets/fonts/README.md /srv/assets/fonts/README.md
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY backend/app ./app

ENV PATH="/srv/backend/.venv/bin:$PATH" \
    WORK_DIR=/tmp/video-factory-work
# worker 臨時工作目錄先建好並交給 app：compose.prod.yaml 在這裡掛命名卷，新卷會沿用這個擁有者
RUN install -d -o app -g app "$WORK_DIR"
USER app
EXPOSE 8000
CMD ["uvicorn", "--factory", "app.main:app_factory", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
