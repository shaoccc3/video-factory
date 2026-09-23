"""認證：本地帳號密碼，會話存在 HttpOnly Cookie。預留 OAuth（飛書、企業微信）接入點：User.auth_provider。"""

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, RuntimeDep, SessionDep
from app.api.schemas import LoginIn, UserOut
from app.core.security import SESSION_COOKIE, hash_password, issue_session, verify_password
from app.models import User
from app.services.audit import audit

router = APIRouter(prefix="/auth", tags=["auth"])
_DUMMY_HASH = hash_password("timing-equalizer")


@router.post("/login", response_model=UserOut)
async def login(
    body: LoginIn, request: Request, response: Response, session: SessionDep, runtime: RuntimeDep
) -> User:
    user = await session.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    ok = verify_password(user.password_hash if user else _DUMMY_HASH, body.password)
    if user is None or not ok or not user.is_active:
        audit(
            session,
            request,
            user.id if user else None,
            "login_failed",
            email=body.email.strip().lower()[:100],
        )
        await session.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "帳號或密碼錯誤")
    settings = runtime.settings
    response.set_cookie(
        SESSION_COOKIE,
        issue_session(settings.secret_key.get_secret_value(), user.id, user.password_hash),
        max_age=settings.session_max_age_s,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    audit(session, request, user.id, "login")
    await session.commit()
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> Response:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user
