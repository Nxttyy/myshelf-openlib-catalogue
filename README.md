# Dora

Monorepo for Dora.

- `api/` FastAPI backend, Alembic migrations, MCP endpoint. Run everything from inside `api/`:
  ```sh
  cd api
  python -m venv venv && venv/bin/pip install -r requirements.txt
  venv/bin/alembic upgrade head
  venv/bin/uvicorn app.main:app --reload
  ```
- `web/` React frontend (Vite). See `web/README.md`.
- `launch-film/` launch video source.
