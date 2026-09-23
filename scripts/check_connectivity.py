#!/usr/bin/env python3
"""檢查 Claude Code 雲端環境到方舟（火山 / BytePlus）與對照組的連通性。

只用標準庫；只打印地址、狀態碼、耗時與判讀，不打印密鑰、請求頭或響應內容。
列出任務（GET /contents/generations/tasks）不產生費用。
"""

from __future__ import annotations

import os
import ssl
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

ARK_ENDPOINTS = {
    "volcengine": "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks?page_size=1",
    "byteplus": "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks?page_size=1",
}
CONTROL_ENDPOINTS = ["https://pypi.org", "https://registry.npmjs.org", "https://github.com"]
TIMEOUT_S = 15

# Python 3.13 預設開啟 VERIFY_X509_STRICT，雲端代理的 CA 不符合其 key usage 要求；
# 只關掉這個嚴格旗標，證書驗證本身保持開啟。
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.verify_flags &= ~ssl.VERIFY_X509_STRICT


@dataclass
class Result:
    label: str
    url: str
    status: str
    elapsed_ms: int
    verdict: str


def _request(url: str, auth: bool) -> tuple[str, dict[str, str], str]:
    """返回 (狀態碼或錯誤類型, 回應頭, 錯誤訊息)。錯誤訊息不含請求內容。"""
    req = urllib.request.Request(url, method="GET")
    if auth:
        req.add_header("Authorization", "Bearer " + os.environ["ARK_API_KEY"])
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S, context=_SSL_CTX) as resp:
            return str(resp.status), dict(resp.headers), ""
    except urllib.error.HTTPError as e:
        return str(e.code), dict(e.headers or {}), ""
    except urllib.error.URLError as e:
        return "ERR", {}, str(e.reason)
    except (TimeoutError, OSError) as e:
        return "ERR", {}, type(e).__name__


def _judge(status: str, headers: dict[str, str], err: str, is_ark: bool) -> str:
    deny = {k.lower(): v for k, v in headers.items()}.get("x-deny-reason", "")
    if (status == "403" and deny == "host_not_allowed") or "Tunnel connection failed: 403" in err:
        return "被雲端網絡白名單攔截"
    if status == "ERR":
        return f"連線失敗（{err}）"
    if not is_ark:
        return "可達"
    if status == "401":
        return "已連到方舟，但密鑰未生效"
    return "已連到方舟，密鑰已生效"


def main() -> None:
    results: list[Result] = []
    has_key = bool(os.environ.get("ARK_API_KEY"))
    for region, url in ARK_ENDPOINTS.items():
        for label, auth in (("A 無 Authorization", False), ("B 帶 Authorization", True)):
            if auth and not has_key:
                results.append(Result(f"{region} {label}", url, "SKIP", 0, "ARK_API_KEY 不存在，跳過"))
                continue
            t0 = time.monotonic()
            status, headers, err = _request(url, auth)
            ms = int((time.monotonic() - t0) * 1000)
            results.append(Result(f"{region} {label}", url, status, ms, _judge(status, headers, err, True)))
    for url in CONTROL_ENDPOINTS:
        t0 = time.monotonic()
        status, headers, err = _request(url, False)
        ms = int((time.monotonic() - t0) * 1000)
        results.append(Result("對照組", url, status, ms, _judge(status, headers, err, False)))

    print("| 項目 | 地址 | 狀態碼 | 耗時(ms) | 判讀 |")
    print("|---|---|---|---|---|")
    for r in results:
        print(f"| {r.label} | {r.url} | {r.status} | {r.elapsed_ms} | {r.verdict} |")


if __name__ == "__main__":
    main()
