"""Test fixtures.

Uses an in-memory SQLite database (StaticPool) so tests run without any
infrastructure. Env vars must be set BEFORE the app modules are imported.
"""

import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["SMS_PROVIDER"] = "mock"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client():
    """A TestClient backed by a fresh, seeded in-memory database.

    The app lifespan seeds demo data on startup; teardown drops all tables so
    every test starts from the same known state.
    """
    from app.database import engine  # noqa: E402
    from app.main import app  # noqa: E402
    from app.models import Base  # noqa: E402

    Base.metadata.drop_all(bind=engine)  # clean slate
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)