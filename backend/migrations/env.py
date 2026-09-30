"""
Alembic migration environment for the Qimchi database.

Works both from the CLI (``alembic -c alembic.ini upgrade head``) and
programmatically via ``api.shared.db.run_migrations`` (which passes the URL and
script location in a Config object, without an ini file). Offline mode is not
used by the app but is supported for completeness.

"""

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Ensure the backend root (containing the ``api`` package) is importable,
# regardless of the cwd Alembic is invoked from.
_BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from sqlmodel import SQLModel  # noqa: E402

import api.db_models  # noqa: E402,F401  (registers tables on SQLModel.metadata)

config = context.config

# Only configure logging from a real ini file (not when run programmatically).
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata


def _get_url() -> str:
    """Resolve the DB URL from the Config, falling back to the app default."""
    url = config.get_main_option("sqlalchemy.url")
    if url:
        return url
    from api.shared.paths import db_path

    return f"sqlite:///{db_path().as_posix()}"


def run_migrations_offline() -> None:
    context.configure(
        url=_get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _get_url()
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # render_as_batch: SQLite can't ALTER TABLE in place; batch mode
        # rebuilds tables so future migrations that alter columns work.
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
