"""API 依賴：數據庫會話、當前用戶、角色檢查、運行時、派發器。"""

from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import SESSION_COOKIE, read_session, session_matches
from app.models import User
from app.models.enums import Role
from app.pipeline.orchestrator import Dispatcher
from app.providers.gateway import Gateway
from app.services.runtime import Runtime


def get_runtime(request: Request) -> Runtime:
    runtime: Runtime = request.app.state.runtime
    return runtime


def get_dispatcher(request: Request) -> Dispatcher:
    dispatcher: Dispatcher = request.app.state.dispatcher
    return dispatcher


def get_gateway(request: Request) -> Gateway:
    gateway: Gateway = request.app.state.gateway
    return gateway


async def get_session(runtime: Annotated[Runtime, Depends(get_runtime)]) -> AsyncIterator[AsyncSession]:
    async with runtime.sessionmaker() as session:
        yield session


RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
DispatcherDep = Annotated[Dispatcher, Depends(get_dispatcher)]
GatewayDep = Annotated[Gateway, Depends(get_gateway)]


async def current_user(request: Request, runtime: RuntimeDep, session: SessionDep) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    settings = runtime.settings
    data = (
        read_session(settings.secret_key.get_secret_value(), token, settings.session_max_age_s)
        if token
        else None
    )
    user = await session.get(User, data[0]) if data else None
    if user is None or data is None or not user.is_active or not session_matches(user.password_hash, data[1]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "請先登入")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_roles(*roles: Role) -> Callable[[User], Coroutine[Any, Any, User]]:
    async def check(user: CurrentUser) -> User:
        if not set(roles) & set(user.roles):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "沒有權限")
        return user

    return check


AdminUser = Annotated[User, Depends(require_roles(Role.ADMIN))]
ReviewerUser = Annotated[User, Depends(require_roles(Role.REVIEWER, Role.ADMIN))]
CreatorUser = Annotated[User, Depends(require_roles(Role.CREATOR, Role.ADMIN))]
