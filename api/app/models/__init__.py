"""Import all models so Alembic and SQLModel.metadata can see them."""

from app.models.book import Book
from app.models.film import Film
from app.models.scan_session import ScanSession
from app.models.user import User
from app.models.user_book import UserBook
from app.models.user_book_image import UserBookImage
from app.models.user_film import UserFilm

__all__ = ["Book", "Film", "ScanSession", "User", "UserBook", "UserBookImage", "UserFilm"]
