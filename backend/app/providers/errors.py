"""模型調用錯誤：統一分類，決定是否重試。"""

import asyncio
import random
from collections.abc import Awaitable, Callable

import structlog

from app.models.enums import ErrorKind

log = structlog.get_logger(__name__)

RETRYABLE = frozenset({ErrorKind.RATE_LIMIT, ErrorKind.TIMEOUT, ErrorKind.SERVER})

_MODERATION_HINTS = ("sensitive", "risk", "moderation", "policy", "contentfilter", "violat")
_RATE_HINTS = ("ratelimit", "rate_limit", "quota", "overload", "toomanyrequests", "throttl")
_TIMEOUT_HINTS = ("timeout", "expired", "deadline")
_SERVER_HINTS = ("internal", "unavailable", "servererror", "service_error")


class ProviderError(Exception):
    """外部模型調用失敗。message 不含密鑰或帶簽名的 URL。"""

    def __init__(
        self,
        kind: ErrorKind,
        message: str,
        *,
        code: str | None = None,
        status: int | None = None,
        billed_tokens: int = 0,
        billed_completion_tokens: int = 0,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.code = code
        self.status = status
        # 失敗前已經計費的 token（例如大模型多次修復仍失敗），網關會照樣記賬
        self.billed_tokens = billed_tokens
        self.billed_completion_tokens = billed_completion_tokens  # billed_tokens 中屬於輸出的部分

    @property
    def retryable(self) -> bool:
        return self.kind in RETRYABLE


class BudgetExceededError(Exception):
    """超出單任務或每日預算。"""

    def __init__(self, message: str, *, scope: str) -> None:
        super().__init__(message)
        self.scope = scope


def classify_code(code: str | None, default: ErrorKind = ErrorKind.CLIENT) -> ErrorKind:
    """按錯誤碼推斷類型（方舟／BytePlus 的錯誤碼是字串，如 InputTextSensitiveContentDetected）。"""
    if not code:
        return default
    low = code.lower().replace("-", "").replace(".", "")
    for hints, kind in (
        (_MODERATION_HINTS, ErrorKind.MODERATION),
        (_RATE_HINTS, ErrorKind.RATE_LIMIT),
        (_TIMEOUT_HINTS, ErrorKind.TIMEOUT),
        (_SERVER_HINTS, ErrorKind.SERVER),
    ):
        if any(h in low for h in hints):
            return kind
    return default


def classify_http(status: int, code: str | None) -> ErrorKind:
    if status == 429:
        return ErrorKind.RATE_LIMIT
    if status in (408, 504):
        return ErrorKind.TIMEOUT
    if status >= 500:
        return classify_code(code, ErrorKind.SERVER)
    return classify_code(code, ErrorKind.CLIENT)


def backoff_delay(attempt: int, base_s: float, cap_s: float = 60.0) -> float:
    """指數退避加抖動。attempt 從 1 開始。"""
    delay: float = min(cap_s, base_s * (2 ** (attempt - 1)))
    return delay * (0.8 + 0.4 * random.random())  # noqa: S311 - 抖動不需要密碼學隨機


async def with_retries[T](
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int,
    base_s: float,
    what: str,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    """只重試限流、超時、服務端錯誤；內容審核與請求錯誤直接拋出。"""
    for attempt in range(1, attempts + 1):
        try:
            return await fn()
        except ProviderError as exc:
            if not exc.retryable or attempt == attempts:
                raise
            delay = backoff_delay(attempt, base_s)
            log.warning("provider_retry", what=what, attempt=attempt, kind=exc.kind, delay_s=delay)
            await sleep(delay)
    raise AssertionError("unreachable")
