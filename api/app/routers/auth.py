import asyncio
import logging
from urllib.parse import quote

import httpx
from authlib.integrations.base_client.errors import MismatchingStateError, OAuthError
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, Response
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
from app.models.user import User
from app.services.email import send_reset_password_email
from app.services.username import USERNAME_RE, generate_unique_username

router = APIRouter(prefix="/auth", tags=["Auth"])

log = logging.getLogger(__name__)

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={
        "scope": "openid email profile",
        # httpx's default 5s limit is too tight for this server's link to
        # Google: most connects take ~1s, but some take 3-20s (measured Oct
        # 2026), and a timeout mid-sign-in used to surface as a 500.
        "timeout": httpx.Timeout(40.0, connect=30.0),
    },
)


async def warm_google_oauth() -> None:
    """Fetch Google's OpenID config and signing keys once at startup. authlib
    caches both in memory, so a sign-in then needs only one call to Google
    (the code exchange) instead of three. Best effort: if Google is slow or
    unreachable now, the first sign-in fetches them instead."""
    if not settings.GOOGLE_CLIENT_ID:
        return
    for attempt in range(3):
        try:
            await oauth.google.fetch_jwk_set()
            log.info("Google sign-in: OpenID config and signing keys cached")
            return
        except Exception as exc:  # noqa: BLE001 - never block or crash startup
            log.warning("Google sign-in: warm-up attempt %d failed: %r", attempt + 1, exc)
            await asyncio.sleep(5 * (attempt + 1))


def _frontend(path: str) -> str:
    return settings.FRONTEND_URL.rstrip("/") + path


def _google_failed(reason: str) -> RedirectResponse:
    msg = f"Google sign-in didn't go through ({reason}). Please try again."
    return RedirectResponse(url=_frontend("/login?error=" + quote(msg)), status_code=303)


@router.get("/google")
async def google_login(request: Request, next: str | None = None):
    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")
    # Clear any stale OAuth state to prevent MismatchingStateError on retries
    for key in list(request.session.keys()):
        if key.startswith("_state_"):
            del request.session[key]
    # Where to go afterwards. Same-site paths only, so this can't become an
    # open redirect to someone else's site.
    if next and next.startswith("/") and not next.startswith("//"):
        request.session["after_google"] = next
    else:
        request.session.pop("after_google", None)
    try:
        return await oauth.google.authorize_redirect(request, settings.GOOGLE_REDIRECT_URI)
    except httpx.HTTPError as exc:
        log.warning("Google sign-in: couldn't reach Google to start: %r", exc)
        return _google_failed("couldn't reach Google")


@router.get("/google/callback")
async def google_callback(request: Request, session: SessionDep):
    # Every failure here used to surface as a bare 500. Each one now logs the
    # real reason and sends the user back to sign in with a readable message.
    if request.query_params.get("error"):
        # e.g. access_denied when the user cancels on Google's consent screen
        log.info("Google sign-in: Google returned error=%s", request.query_params["error"])
        return _google_failed("it was cancelled")
    try:
        token = await oauth.google.authorize_access_token(request)
    except MismatchingStateError:
        log.warning("Google sign-in: state mismatch (session cookie missing or expired)")
        return _google_failed("the sign-in session expired")
    except OAuthError as exc:
        log.warning("Google sign-in: OAuth error %s: %s", exc.error, exc.description)
        return _google_failed("Google rejected the request")
    except httpx.HTTPError as exc:
        log.warning("Google sign-in: network error talking to Google: %r", exc)
        return _google_failed("couldn't reach Google")
    except Exception:
        log.exception("Google sign-in: unexpected error while finishing sign-in")
        return _google_failed("something went wrong on our side")

    user_info = token.get("userinfo")
    if not user_info or not user_info.get("email"):
        log.warning("Google sign-in: no email in the userinfo Google returned: %r", user_info)
        return _google_failed("Google didn't share an email address")

    email = user_info["email"]
    user_result = await session.exec(select(User).where(User.email == email))
    user = user_result.first()

    if not user:
        # Create non-password user
        user = User(
            firstname=user_info.get("given_name") or "",
            lastname=user_info.get("family_name") or "",
            email=email,
            password="",  # No password for google users
            is_google_user=True,
            username=await generate_unique_username(session, email.split("@")[0]),
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)

    access_token = create_access_token(data={"sub": user.email})
    response = RedirectResponse(url=_frontend(request.session.pop("after_google", "/")), status_code=303)
    response.set_cookie(key="access_token", value=f"Bearer {access_token}", httponly=True)
    return response


class MeRead(BaseModel):
    """The signed-in user, as the web app needs it."""
    id: str
    firstname: str
    lastname: str
    email: str
    # username, or the email's local part for accounts that never set one
    handle: str
    is_profile_public: bool


def _me(user: User) -> MeRead:
    return MeRead(
        id=str(user.id),
        firstname=user.firstname,
        lastname=user.lastname,
        email=user.email,
        handle=user.username or user.email.split("@")[0],
        is_profile_public=user.is_profile_public,
    )


def _set_session_cookie(response: Response, user: User) -> None:
    """Same cookie the form login sets, so a session works in both UIs."""
    token = create_access_token(data={"sub": user.email})
    response.set_cookie(key="access_token", value=f"Bearer {token}", httponly=True)


@router.get("/me", response_model=MeRead | None)
async def me(current_user: User | None = Depends(get_current_user)):
    """The signed-in user, or null for guests (a 200 either way, so the
    web app can ask on every load without logging errors)."""
    return _me(current_user) if current_user else None


# ── JSON auth for the React app ─────────────────────────────────────────────
# The form endpoints above redirect to Jinja pages; these return JSON instead.
# They go away together with the forms at the switch-over.

class LoginRequest(BaseModel):
    email: str
    password: str


class SignupRequest(BaseModel):
    firstname: str
    lastname: str
    email: str
    password: str


class ResetRequest(BaseModel):
    email: str


class PasswordReset(BaseModel):
    token: str
    new_password: str


@router.post("/session", response_model=MeRead)
async def create_session(body: LoginRequest, response: Response, session: SessionDep):
    user = (await session.exec(select(User).where(User.email == body.email.strip()))).first()
    if not user or not verify_password(body.password, user.password):
        raise HTTPException(status_code=401, detail="That email and password don't match.")
    _set_session_cookie(response, user)
    return _me(user)


@router.delete("/session", status_code=204)
async def end_session(response: Response):
    response.delete_cookie("access_token")


@router.post("/account", response_model=MeRead, status_code=201)
async def create_account(body: SignupRequest, response: Response, session: SessionDep):
    email = body.email.strip()
    if (await session.exec(select(User).where(User.email == email))).first():
        raise HTTPException(status_code=409, detail="There's already an account with that email.")
    user = User(
        firstname=body.firstname.strip(),
        lastname=body.lastname.strip(),
        email=email,
        password=get_password_hash(body.password),
        username=await generate_unique_username(session, email.split("@")[0]),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    _set_session_cookie(response, user)
    return _me(user)


@router.post("/password-reset-requests", status_code=202)
async def request_password_reset(body: ResetRequest, session: SessionDep):
    """Always 202, whether or not the email has an account, so the response
    can't be used to find out who has one."""
    email = body.email.strip()
    user = (await session.exec(select(User).where(User.email == email))).first()
    if user:
        send_reset_password_email(email_to=user.email, token=create_password_reset_token(email=email))
    return {"ok": True}


@router.post("/password-resets", status_code=204)
async def reset_password_json(body: PasswordReset, session: SessionDep):
    email = verify_password_reset_token(body.token)
    user = (await session.exec(select(User).where(User.email == email))).first() if email else None
    if not user:
        raise HTTPException(status_code=400, detail="This reset link has expired or was already used.")
    user.password = get_password_hash(body.new_password)
    session.add(user)
    await session.commit()


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


class UsernameUpdate(BaseModel):
    username: str


@router.patch("/username")
async def update_username(
    body: UsernameUpdate,
    session: SessionDep,
    current_user: User = Depends(require_user),
):
    uname = body.username.strip().lower()
    if not USERNAME_RE.match(uname):
        raise HTTPException(
            status_code=422,
            detail="3–30 characters: lowercase letters, numbers, hyphen or underscore.",
        )
    taken = (await session.exec(
        select(User).where(User.username == uname, User.id != current_user.id)
    )).first()
    if taken:
        raise HTTPException(status_code=409, detail="That username is already taken.")

    current_user.username = uname
    session.add(current_user)
    await session.commit()
    return {"ok": True, "username": uname}

