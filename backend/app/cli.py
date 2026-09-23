"""運維命令。

python -m app.cli ensure-bucket                         建立對象存儲 bucket
python -m app.cli sync-templates [--force]              把 config/templates 同步到數據庫
python -m app.cli create-user EMAIL NAME --roles admin,reviewer [--password-env VAR]
                                                        建立或更新本地帳號（密碼從環境變量或提示輸入）
"""

import argparse
import asyncio
import getpass
import os
import sys
import time

import structlog
from sqlalchemy import func, select

from app.core.logging import configure_logging
from app.core.security import hash_password
from app.core.settings import Settings, get_settings
from app.core.storage import create_s3_client, ensure_bucket
from app.models import User
from app.models.enums import Role
from app.pipeline.templates import sync_templates
from app.services.runtime import build_runtime

log = structlog.get_logger("cli")


def cmd_ensure_bucket(settings: Settings, retries: int, delay_s: float) -> None:
    if settings.storage_backend != "s3":
        log.info("ensure_bucket_skipped", reason="storage_backend 不是 s3")
        return
    client = create_s3_client(settings)
    for attempt in range(1, retries + 1):
        try:
            created = ensure_bucket(client, settings.s3_bucket)
        except Exception as exc:
            log.warning("ensure_bucket_retry", attempt=attempt, error=type(exc).__name__)
            if attempt == retries:
                raise
            time.sleep(delay_s)
        else:
            log.info("ensure_bucket_done", bucket=settings.s3_bucket, created=created)
            return


async def cmd_sync_templates(settings: Settings, force: bool) -> None:
    runtime = build_runtime(settings, null_pool=True)
    try:
        async with runtime.sessionmaker() as session:
            changed = await sync_templates(session, settings.templates_dir, force=force)
            await session.commit()
        log.info("templates_synced", changed=changed)
    finally:
        await runtime.aclose()


async def cmd_create_user(settings: Settings, email: str, name: str, roles: list[str], password: str) -> None:
    runtime = build_runtime(settings, null_pool=True)
    try:
        async with runtime.sessionmaker() as session:
            user = await session.scalar(select(User).where(func.lower(User.email) == email.lower()))
            if user is None:
                user = User(email=email.lower(), display_name=name, auth_provider="local", is_active=True)
                session.add(user)
            user.display_name = name
            user.roles = roles
            user.password_hash = hash_password(password)
            user.is_active = True
            await session.commit()
        log.info("user_saved", email=email.lower(), roles=roles)
    finally:
        await runtime.aclose()


def main(argv: list[str] | None = None) -> None:
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.log_json)
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    eb = sub.add_parser("ensure-bucket", help="建立對象存儲 bucket（已存在則略過）")
    eb.add_argument("--retries", type=int, default=30)
    eb.add_argument("--delay", type=float, default=2.0)
    st = sub.add_parser("sync-templates", help="同步 config/templates 到數據庫")
    st.add_argument("--force", action="store_true", help="覆蓋已存在的模板（會蓋掉管理員的修改）")
    cu = sub.add_parser("create-user", help="建立或更新本地帳號")
    cu.add_argument("email")
    cu.add_argument("name")
    cu.add_argument("--roles", default="creator", help="逗號分隔：admin,creator,reviewer")
    cu.add_argument("--password-env", help="從這個環境變量讀密碼（不在命令行明文傳入）")
    args = parser.parse_args(argv)

    if args.command == "ensure-bucket":
        cmd_ensure_bucket(settings, args.retries, args.delay)
    elif args.command == "sync-templates":
        asyncio.run(cmd_sync_templates(settings, args.force))
    elif args.command == "create-user":
        roles = [Role(r.strip()).value for r in args.roles.split(",") if r.strip()]
        password = os.environ.get(args.password_env, "") if args.password_env else getpass.getpass("密碼：")
        if len(password) < 8:
            print("密碼至少 8 個字元", file=sys.stderr)
            raise SystemExit(2)
        asyncio.run(cmd_create_user(settings, args.email, args.name, roles, password))


if __name__ == "__main__":
    main()
