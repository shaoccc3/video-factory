#!/bin/bash
# video-factory 雲端環境安裝腳本。映像已預裝 Python 3.13、ffmpeg、Docker、Playwright Chromium
set -x

# 1. Node 24 + pnpm（映像預設是 Node 22）
NODE_MAJOR=24
if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  TARBALL=$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -o "node-v${NODE_MAJOR}\.[0-9.]*-linux-x64\.tar\.xz" | head -1)
  if [ -n "$TARBALL" ] && curl -fsSL "$BASE/$TARBALL" | tar -xJ -C /opt; then
    ln -sfn "/opt/${TARBALL%.tar.xz}" "/opt/node${NODE_MAJOR}"
    "/opt/node${NODE_MAJOR}/bin/npm" install -g --prefix "/opt/node${NODE_MAJOR}" pnpm@latest || true
    mkdir -p /root/.local/bin
    for b in node npm npx corepack pnpm pnpx; do
      [ -e "/opt/node${NODE_MAJOR}/bin/$b" ] && ln -sf "/opt/node${NODE_MAJOR}/bin/$b" "/root/.local/bin/$b"
    done
  fi
fi

# 2. 升級 uv（映像內版本較舊）；從 PyPI 取，因為雲端的 GitHub 代理不放行其他倉庫的 release 下載
python3 -m pip install -q --break-system-packages --target /tmp/uv-new uv \
  && install -m 755 /tmp/uv-new/bin/uv /tmp/uv-new/bin/uvx /root/.local/bin/ || true

# 3. ffmpeg 與字幕字體來源（2026-09-23 實測映像未預裝）；字體由 SessionStart hook 抽取到 assets/fonts/
if ! command -v ffmpeg >/dev/null || [ ! -d /usr/share/fonts/opentype/noto ]; then
  apt-get update -q && apt-get install -y -q --no-install-recommends ffmpeg fonts-noto-cjk || true
fi
# 4. 預拉 compose 用到的映像，快取後每個會話不用重拉
(dockerd >/tmp/dockerd-setup.log 2>&1 &)
for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
for img in postgres:18 valkey/valkey:9 chrislusf/seaweedfs:latest; do docker pull -q "$img" & done
wait
pkill dockerd || true
exit 0
