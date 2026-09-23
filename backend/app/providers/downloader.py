"""安全下載外部 URL：域名白名單、只允許 https、大小上限，防 SSRF。"""

import fnmatch
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from app.models.enums import ErrorKind
from app.providers.errors import ProviderError


def host_allowed(url: str, patterns: tuple[str, ...]) -> bool:
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        return False
    host = parts.hostname.lower()
    for pattern in patterns:
        pat = pattern.lower()
        if pat.startswith("*."):
            if host.endswith(pat[1:]):
                return True
        elif fnmatch.fnmatchcase(host, pat):
            return True
    return False


async def download(
    client: httpx.AsyncClient,
    url: str,
    dest: Path,
    *,
    allowed_hosts: tuple[str, ...],
    max_bytes: int,
) -> Path:
    """下載到 dest。錯誤訊息不包含 URL（可能帶簽名）。"""
    if not host_allowed(url, allowed_hosts):
        raise ProviderError(ErrorKind.CLIENT, "下載地址不在白名單內", code="download_host_denied")
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        async with client.stream("GET", url, follow_redirects=False) as resp:
            if resp.status_code >= 500:
                raise ProviderError(ErrorKind.SERVER, f"下載失敗：HTTP {resp.status_code}")
            if resp.status_code != 200:
                raise ProviderError(
                    ErrorKind.CLIENT, f"下載失敗：HTTP {resp.status_code}", status=resp.status_code
                )
            declared = int(resp.headers.get("content-length", "0") or 0)
            if declared > max_bytes:
                raise ProviderError(ErrorKind.CLIENT, "下載文件超過大小上限", code="too_large")
            written = 0
            with dest.open("wb") as fh:
                async for chunk in resp.aiter_bytes():
                    written += len(chunk)
                    if written > max_bytes:
                        raise ProviderError(ErrorKind.CLIENT, "下載文件超過大小上限", code="too_large")
                    fh.write(chunk)
    except httpx.TimeoutException as exc:
        raise ProviderError(ErrorKind.TIMEOUT, "下載超時") from exc
    except httpx.TransportError as exc:
        raise ProviderError(ErrorKind.SERVER, f"下載連線失敗：{type(exc).__name__}") from exc
    except ProviderError:
        dest.unlink(missing_ok=True)
        raise
    return dest
