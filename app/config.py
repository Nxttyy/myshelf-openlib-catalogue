from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Open Bookie"
    # FIX: use env vars here
    DEBUG: bool = True
    OPENLIBRARY_BASE_URL: str = "https://openlibrary.org/api/volumes/brief/isbn"
    DATABASE_URL: str

    # Auth
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 1 week

    # Google OAuth
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/auth/google/callback"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
