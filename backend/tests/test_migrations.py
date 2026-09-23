from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

BACKEND = Path(__file__).resolve().parents[1]


def test_upgrade_and_downgrade_on_sqlite(tmp_path: Path) -> None:
    db = tmp_path / "m.db"
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite+aiosqlite:///{db}")
    command.upgrade(cfg, "head")
    engine = create_engine(f"sqlite:///{db}")
    assert "users" in inspect(engine).get_table_names()
    command.downgrade(cfg, "base")
    assert "users" not in inspect(engine).get_table_names()
    engine.dispose()
