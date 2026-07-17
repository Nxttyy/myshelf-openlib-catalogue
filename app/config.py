from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    APP_NAME: str = "Dora"
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
    # Shared secret for the /mcp endpoint (Ask Dora agent access). If unset,
    # the MCP endpoint rejects every request.
    MCP_SECRET: str | None = None

    # Ask Dora — FlowStudio agent workflow webhook. URL is the base webhook
    # endpoint (without /trigger). If either is unset, /dora routes return 503.
    DORA_WEBHOOK_URL: str | None = None
    DORA_WEBHOOK_SECRET: str | None = None
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
    EMAILS_FROM_NAME: str | None = "Dora"

    # S3-compatible object storage — comment photo uploads. Any endpoint that
    # speaks the S3 API works (AWS, MinIO, R2, B2, Wasabi, ...). Photo upload
    # routes return 503 if any of these are unset.
    S3_ENDPOINT_URL: str | None = None
    S3_REGION: str | None = None
    S3_BUCKET: str | None = None
    S3_ACCESS_KEY: str | None = None
    S3_SECRET_KEY: str | None = None

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
