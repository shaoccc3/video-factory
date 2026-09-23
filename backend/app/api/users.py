"""用戶管理（管理員）。"""

import uuid

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select

from app.api.deps import AdminUser, SessionDep
from app.api.schemas import UserCreate, UserOut, UserUpdate
from app.core.security import hash_password
from app.models import User
from app.models.enums import Role
from app.services.audit import audit

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(_: AdminUser, session: SessionDep) -> list[User]:
    return list((await session.scalars(select(User).order_by(User.created_at))).all())


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, admin: AdminUser, session: SessionDep, request: Request) -> User:
    email = body.email.lower()
    if await session.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "電子郵件已被使用")
    user = User(
        email=email,
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        roles=[r.value for r in body.roles],
        is_active=True,
        daily_budget_cny=body.daily_budget_cny,
        auth_provider="local",
    )
    session.add(user)
    await session.flush()
    audit(session, request, admin.id, "user_create", target_type="user", target_id=user.id, roles=user.roles)
    await session.commit()
    return user


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: uuid.UUID, body: UserUpdate, admin: AdminUser, session: SessionDep, request: Request
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "用戶不存在")
    changes = body.model_dump(exclude_unset=True)
    if user.id == admin.id and (
        changes.get("is_active") is False or ("roles" in changes and Role.ADMIN not in changes["roles"])
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "不能停用自己或移除自己的管理員角色")
    if "display_name" in changes:
        user.display_name = changes["display_name"]
    if changes.get("password"):
        user.password_hash = hash_password(changes["password"])
    if changes.get("roles"):
        user.roles = [Role(r).value for r in changes["roles"]]
    if "is_active" in changes and changes["is_active"] is not None:
        user.is_active = changes["is_active"]
    if "daily_budget_cny" in changes:
        user.daily_budget_cny = changes["daily_budget_cny"]
    fields = sorted(k for k in changes if k != "password") + (["password"] if "password" in changes else [])
    audit(session, request, admin.id, "user_update", target_type="user", target_id=user.id, fields=fields)
    await session.commit()
    return user
