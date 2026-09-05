"""SQLAlchemy engine + session factory.

Works against both PostgreSQL and SQLite. In-memory SQLite (used by the test
suite) gets a StaticPool so every request shares one connection.
"""

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from .config import settings

_connect_args: dict = {}
_engine_kwargs: dict = {}

if settings.database_url.startswith("sqlite"):
    # SQLite needs this to be usable from FastAPI's thread pool
    _connect_args = {"check_same_thread": False}
    if settings.database_url in ("sqlite://", "sqlite:///:memory:"):
        # One shared in-memory connection for tests
        _engine_kwargs = {"poolclass": StaticPool}

engine = create_engine(
    settings.database_url,
    connect_args=_connect_args,
    **_engine_kwargs,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def ensure_columns(engine) -> None:
    """Additive migrations for pre-existing databases.

    create_all() never alters existing tables, so any column added to a model
    *after* its table was first created would otherwise crash at runtime with
    "no such column". Instead of hand-maintaining a list, diff every ORM
    table against the live database and ALTER TABLE each missing column in
    (both SQLite and PostgreSQL support this syntax). Runs after create_all,
    so it is a no-op on fresh databases. Only nullable, non-PK columns are
    auto-added — the safe subset for SQLite ALTER TABLE.
    """
    # Local import: models.py imports only sqlalchemy, so this cannot cycle,
    # but keeping it local avoids touching import order at module load.
    from . import models

    # Diff ORM tables against the live schema first, then apply — avoids
    # interleaving inspector reads with the write transaction on SQLite.
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    missing: list[tuple[str, str, str]] = []  # (table, column, sql type)
    for table in models.Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # fresh table — create_all() created it complete
        live_columns = {c["name"] for c in inspector.get_columns(table.name)}
        for col in table.columns:
            if col.name in live_columns or col.primary_key or not col.nullable:
                continue
            missing.append((table.name, col.name, col.type.compile(dialect=engine.dialect)))

    with engine.begin() as conn:
        for table, column, col_type in missing:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))

    # Non-nullable columns introduced after a table was first created cannot
    # ride the generic nullable-only diff above, so they get an explicit,
    # additive ALTER with a DEFAULT backfilled for existing rows. No-op on
    # fresh databases (create_all built them complete).
    with engine.begin() as conn:
        insp = inspect(engine)
        live = {t: {c["name"] for c in insp.get_columns(t)} for t in insp.get_table_names()}
        dialect = engine.dialect
        for _table, _col, _ddl in (
            # Home-collection routing columns on the existing lab tables
            ("lab_tests", "collection_type", "VARCHAR(10) NOT NULL DEFAULT 'hospital'"),
            ("lab_tests", "home_collectable", "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("lab_orders", "collection_mode", "VARCHAR(10) NOT NULL DEFAULT 'hospital'"),
        ):
            if _table in live and _col not in live[_table]:
                conn.execute(text(f"ALTER TABLE {_table} ADD COLUMN {_col} {_ddl}"))


def get_db():
    """FastAPI dependency that yields a database session per request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()