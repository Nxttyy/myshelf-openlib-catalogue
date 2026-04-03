from datetime import timedelta

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlmodel import select

from app.auth import create_access_token, get_password_hash, verify_password
from app.config import settings
from app.db import SessionDep
from app.models.user import Token, User, UserCreate, UserLogin

router = APIRouter(prefix="/auth", tags=["Auth"])

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


@router.post("/register", response_model=Token)
async def register(user_in: UserCreate, session: SessionDep):
    # Check if user exists
    existing = await session.exec(select(User).where(User.email == user_in.email))
    if existing.first():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create user
    user = User(
        firstname=user_in.firstname,
        lastname=user_in.lastname,
        email=user_in.email,
        password=get_password_hash(user_in.password),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/login", response_model=Token)
async def login(user_in: UserLogin, session: SessionDep):
    user_result = await session.exec(select(User).where(User.email == user_in.email))
    user = user_result.first()
    if not user or not verify_password(user_in.password, user.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    access_token = create_access_token(data={"sub": user.email})
    return {"access_token": access_token, "token_type": "bearer"}


@router.get("/google")
async def google_login(request: Request):
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")
    return await oauth.google.authorize_redirect(request, settings.GOOGLE_REDIRECT_URI)


@router.get("/google/callback")
async def google_callback(request: Request, session: SessionDep):
    token = await oauth.google.authorize_access_token(request)
    user_info = token.get("userinfo")
    if not user_info:
        raise HTTPException(status_code=400, detail="Google authentication failed")

    email = user_info["email"]
    user_result = await session.exec(select(User).where(User.email == email))
    user = user_result.first()

    if not user:
        # Create non-password user
        user = User(
            firstname=user_info.get("given_name", ""),
            lastname=user_info.get("family_name", ""),
            email=email,
            password="",  # No password for google users
            is_google_user=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    access_token = create_access_token(data={"sub": user.email})
    
    # Redirect to home with token in cookie or as a param (simulated here for simple app)
    response = RedirectResponse(url="/")
    response.set_cookie(key="access_token", value=f"Bearer {access_token}", httponly=True)
    return response


@router.get("/logout")
async def logout():
    response = RedirectResponse(url="/")
    response.delete_cookie("access_token")
    return response
