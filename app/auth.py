from datetime import datetime, timedelta
from typing import Any, Union

from fastapi import Depends, HTTPException, Request, status
from jose import JWTError, jwt
import bcrypt as _bcrypt
from sqlmodel import select

from app.config import settings
from app.db import SessionDep
from app.models.user import TokenData, User

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return _bcrypt.checkpw(plain_password.encode("utf-8")[:72], hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8")[:72], _bcrypt.gensalt()).decode("utf-8")


def create_access_token(data: dict, expires_delta: Union[timedelta, None] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt

async def get_current_user(request: Request, session: SessionDep) -> User | None:
    # 1. Try to get token from cookie (for browser/HTMX) or Authorization header
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header

    if not token or not token.startswith("Bearer "):
        return None

    token = token[len("Bearer "):]

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            return None
        token_data = TokenData(email=email)
    except JWTError:
        return None

    user_result = await session.exec(select(User).where(User.email == token_data.email))
    user = user_result.first()
    return user


async def require_user(current_user: User | None = Depends(get_current_user)) -> User:
    """Like get_current_user, but rejects unauthenticated requests with a 401.

    Use this on endpoints that write to a user's library — without it, a lapsed
    session resolves to ``None`` and the route can silently create orphaned data.
    """
    if current_user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return current_user


def create_password_reset_token(email: str) -> str:
    delta = timedelta(hours=1)
    now = datetime.utcnow()
    expires = now + delta
    exp = expires.timestamp()
    encoded_jwt = jwt.encode(
        {"exp": exp, "nbf": now, "sub": email}, settings.SECRET_KEY, algorithm=settings.ALGORITHM
    )
    return encoded_jwt


def verify_password_reset_token(token: str) -> str | None:
    try:
        decoded_token = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return str(decoded_token["sub"])
    except JWTError:
        return None
