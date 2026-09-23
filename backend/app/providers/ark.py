"""方舟（火山引擎）／ModelArk（BytePlus）的 HTTP 客戶端。

兩個區域的 REST 接口相同（路徑見官方 SDK：/contents/generations/tasks、/images/generations、
/chat/completions），只有基礎地址不同，所以用 httpx 直接調用，不依賴體積較大的官方 SDK。
"""

from typing import Any

import httpx

from app.models.enums import ErrorKind
from app.providers.errors import ProviderError, classify_http

PROXY_PLACEHOLDER = "injected-by-proxy"


class ArkHttp:
    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        *,
        timeout_s: float = 60.0,
        strip_auth_header: bool = False,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        headers = {"Content-Type": "application/json"}
        # Claude Code 雲端的 API credentials 由代理注入密鑰：佔位值不能當成真密鑰發出
        if api_key and not (strip_auth_header and api_key == PROXY_PLACEHOLDER):
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers=headers,
            timeout=httpx.Timeout(timeout_s, connect=15.0),
            transport=transport,
        )

    @property
    def client(self) -> httpx.AsyncClient:
        return self._client

    async def request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            resp = await self._client.request(method, path, json=json, params=params)
        except httpx.TimeoutException as exc:
            raise ProviderError(ErrorKind.TIMEOUT, "請求方舟超時") from exc
        except httpx.TransportError as exc:
            raise ProviderError(ErrorKind.SERVER, f"連線方舟失敗：{type(exc).__name__}") from exc
        if resp.status_code >= 400:
            code, message = _error_fields(resp)
            raise ProviderError(
                classify_http(resp.status_code, code),
                message or f"HTTP {resp.status_code}",
                code=code,
                status=resp.status_code,
            )
        if not resp.content:
            return {}
        data = resp.json()
        if not isinstance(data, dict):
            raise ProviderError(ErrorKind.SERVER, "方舟返回了非物件 JSON")
        return data

    async def aclose(self) -> None:
        await self._client.aclose()


def _error_fields(resp: httpx.Response) -> tuple[str | None, str | None]:
    try:
        body = resp.json()
    except ValueError:
        return None, None
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        code = err.get("code")
        message = err.get("message")
        return (str(code) if code else None, str(message)[:500] if message else None)
    return None, None
