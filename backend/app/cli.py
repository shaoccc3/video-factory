"""運維命令。用法：python -m app.cli ensure-bucket"""

import argparse
import time

import structlog

from app.core.logging import configure_logging
from app.core.settings import get_settings
from app.core.storage import create_s3_client, ensure_bucket

log = structlog.get_logger("cli")


def cmd_ensure_bucket(retries: int, delay_s: float) -> None:
    settings = get_settings()
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


def main(argv: list[str] | None = None) -> None:
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.log_json)
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    eb = sub.add_parser("ensure-bucket", help="建立對象存儲 bucket（已存在則略過）")
    eb.add_argument("--retries", type=int, default=30)
    eb.add_argument("--delay", type=float, default=2.0)
    args = parser.parse_args(argv)
    if args.command == "ensure-bucket":
        cmd_ensure_bucket(args.retries, args.delay)


if __name__ == "__main__":
    main()
