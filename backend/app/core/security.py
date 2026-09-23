"""密碼雜湊（argon2）與會話令牌（簽名、帶過期）。"""

import uuid

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

_hasher = PasswordHasher()
SESSION_COOKIE = "vf_session"
_SALT = "vf-session-v1"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _serializer(secret: str) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(secret, salt=_SALT)


def issue_session(secret: str, user_id: uuid.UUID, password_hash: str | None) -> str:
    # 帶上密碼雜湊的前綴：改密碼後舊會話自動失效
    return _serializer(secret).dumps({"uid": str(user_id), "pv": (password_hash or "")[-16:]})


def read_session(secret: str, token: str, max_age_s: int) -> tuple[uuid.UUID, str] | None:
    try:
        data = _serializer(secret).loads(token, max_age=max_age_s)
    except (SignatureExpired, BadSignature):
        return None
    try:
        return uuid.UUID(str(data["uid"])), str(data.get("pv", ""))
    except (KeyError, ValueError, TypeError):
        return None


def session_matches(password_hash: str | None, pv: str) -> bool:
    return (password_hash or "")[-16:] == pv
