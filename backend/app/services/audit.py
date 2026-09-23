"""審計日誌：登入、建任務、審核、下載、配置變更。detail 不含密鑰與帶簽名的 URL。"""

import uuid

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog


def audit(
    session: AsyncSession,
    request: Request | None,
    actor_id: uuid.UUID | None,
    action: str,
    *,
    target_type: str | None = None,
    target_id: object = None,
    **detail: object,
) -> None:
    ip = request.client.host if request is not None and request.client else None
    ua = request.headers.get("user-agent", "")[:255] if request is not None else None
    session.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            detail={k: v for k, v in detail.items() if v is not None},
            ip=ip,
            user_agent=ua,
        )
    )
