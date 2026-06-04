from datetime import timedelta
from typing import Annotated

from authlib.integrations.base_client.errors import MismatchingStateError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, status, Form
from pydantic import BaseModel
from fastapi.responses import RedirectResponse
from sqlmodel import select

from app.auth import (
    create_access_token,
    get_current_user,
    require_user,
    get_password_hash,
    verify_password,
    create_password_reset_token,
    verify_password_reset_token,
)
from app.config import settings
from app.db import SessionDep
from app.models.user import Token, User, UserCreate, UserLogin
from app.services.email import send_reset_password_email

router = APIRouter(prefix="/auth", tags=["Auth"])

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


@router.post("/register")
async def register(
    session: SessionDep,
    firstname: str = Form(...),
    lastname: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
):
    # Check if user exists
    existing = await session.exec(select(User).where(User.email == email))
    if existing.first():
        return RedirectResponse(url=f"/register?error=Email already registered", status_code=303)

    # Create user
    user = User(
        firstname=firstname,
        lastname=lastname,
        email=email,
        password=get_password_hash(password),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    access_token = create_access_token(data={"sub": user.email})
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(key="access_token", value=f"Bearer {access_token}", httponly=True)
    return response


@router.post("/login")
async def login(
    session: SessionDep,
    username: str = Form(...),  # 'username' matches standard OAuth2 form, used for email here
    password: str = Form(...),
):
    user_result = await session.exec(select(User).where(User.email == username))
    user = user_result.first()
    if not user or not verify_password(password, user.password):
        return RedirectResponse(url=f"/login?error=Invalid credentials", status_code=303)

    access_token = create_access_token(data={"sub": user.email})
    response = RedirectResponse(url="/", status_code=303)
    response.set_cookie(key="access_token", value=f"Bearer {access_token}", httponly=True)
    return response


@router.post("/password-recovery")
async def recover_password(session: SessionDep, email: str = Form(...)):
    user_result = await session.exec(select(User).where(User.email == email))
    user = user_result.first()

    if user:
        password_reset_token = create_password_reset_token(email=email)
        send_reset_password_email(email_to=user.email, token=password_reset_token)

    # Always redirect to same page to avoid account enumeration
    return RedirectResponse(url="/forgot-password?success=1", status_code=303)


@router.post("/reset-password")
async def reset_password(
    session: SessionDep,
    token: str = Form(...),
    new_password: str = Form(...),
):
    email = verify_password_reset_token(token)
    if not email:
        return RedirectResponse(url="/login?error=Invalid or expired reset token", status_code=303)

    user_result = await session.exec(select(User).where(User.email == email))
    user = user_result.first()
    if not user:
        return RedirectResponse(url="/login?error=User not found", status_code=303)

    user.password = get_password_hash(new_password)
    session.add(user)
    await session.commit()

    return RedirectResponse(url="/login?error=Password updated successfully. Please log in.", status_code=303)


@router.get("/google")
async def google_login(request: Request):
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")
    # Clear any stale OAuth state to prevent MismatchingStateError on retries
    for key in list(request.session.keys()):
        if key.startswith("_state_"):
            del request.session[key]
    return await oauth.google.authorize_redirect(request, settings.GOOGLE_REDIRECT_URI)


@router.get("/google/callback")
async def google_callback(request: Request, session: SessionDep):
    try:
        token = await oauth.google.authorize_access_token(request)
    except MismatchingStateError:
        return RedirectResponse(
            url="/login?error=Google sign-in failed (session expired). Please try again.",
            status_code=303,
        )
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


class ProfileUpdate(BaseModel):
    is_profile_public: bool


@router.patch("/profile")
async def update_profile(
    body: ProfileUpdate,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    current_user.is_profile_public = body.is_profile_public
    session.add(current_user)
    await session.commit()
    return {"ok": True}


@router.get("/logout")
async def logout():
    response = RedirectResponse(url="/")
    response.delete_cookie("access_token")
    return response
