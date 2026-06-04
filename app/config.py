from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Open Bookie"
    # FIX: use env vars here
    DEBUG: bool = True
    OPENLIBRARY_BASE_URL: str = "https://openlibrary.org/api/volumes/brief/isbn"
    OPENLIBRARY_SEARCH_URL: str = "https://openlibrary.org/search.json"
    OPENLIBRARY_COVERS_URL: str = "https://covers.openlibrary.org/b/id"
    # Open Library asks clients to identify themselves with a contact address so
    # they can reach out before throttling. Sent in the User-Agent header.
    CONTACT_EMAIL: str = "nathnaelyirga@gmail.com"
    DATABASE_URL: str

    # Auth
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 1 week

    # Google OAuth
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: str | None = None
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/auth/google/callback"

    # SMTP / Email
    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    EMAILS_FROM_EMAIL: str | None = "noreply@openbookie.com"
    EMAILS_FROM_NAME: str | None = "Open Bookie"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
