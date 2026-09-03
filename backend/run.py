"""Dev launcher: `python run.py` starts uvicorn with auto-reload.

For PostgreSQL: either `docker compose up` (recommended) or set DATABASE_URL.
Without DATABASE_URL the app uses a local SQLite file so it runs anywhere.
"""

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)