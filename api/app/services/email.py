import logging
import smtplib
from datetime import datetime
from email.message import EmailMessage

from jinja2 import Environment, FileSystemLoader, select_autoescape

from app.config import settings
from app.models.user import User

log = logging.getLogger(__name__)

# The HTML templates come verbatim from the design project's emails/ folder;
# keep them that way so a design change is a file swap. Their images load from
# {{ site_url }}/email/, served from app/static/email (see main.py).
_env = Environment(
    loader=FileSystemLoader("app/templates/email"),
    autoescape=select_autoescape(["html"]),
)

RESET_EXPIRES_IN = "1 hour"  # matches create_password_reset_token


def _site_url() -> str:
    # FRONTEND_URL in dev (the Vite server, which proxies /email), the site's
    # public address otherwise.
    return (settings.FRONTEND_URL or settings.PUBLIC_URL).rstrip("/")


def _handle(user: User) -> str:
    return user.username or user.email.split("@")[0]


def send_email(email_to: str, subject: str, html_content: str, text_content: str):
    """Sends with a plain-text part as well, for text-only clients and spam
    filters. Meant to run as a background task: logs failures, never raises."""
    if not settings.SMTP_HOST:
        print(f"SMTP not configured. Would send to {email_to}: {subject}\n{text_content}")
        return

    message = EmailMessage()
    message["From"] = f"{settings.EMAILS_FROM_NAME} <{settings.EMAILS_FROM_EMAIL}>"
    message["To"] = email_to
    message["Subject"] = subject
    message.set_content(text_content)
    message.add_alternative(html_content, subtype="html")

    try:
        smtp = smtplib.SMTP_SSL if settings.SMTP_SSL else smtplib.SMTP
        with smtp(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
            if settings.SMTP_TLS and not settings.SMTP_SSL:
                server.starttls()
            if settings.SMTP_USER and settings.SMTP_PASSWORD:
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.send_message(message)
    except Exception:
        log.exception("Couldn't send %r to %s", subject, email_to)


def welcome_context(user: User) -> dict:
    created = user.created_at or datetime.utcnow()
    return {
        "firstname": user.firstname.strip(),
        "email": user.email,
        "handle": _handle(user),
        "site_url": _site_url(),
        "is_google_user": user.is_google_user,
        "created_at": f"{created.day} {created:%b %Y}",
        "profile_url": f"/u/{_handle(user)}",
        "is_profile_public": user.is_profile_public,
        "guide_url": "/guide",
        "explore_url": "/explore",
        "cta_url": "/",
    }


def reset_context(user: User, token: str) -> dict:
    return {
        "firstname": user.firstname.strip(),
        "email": user.email,
        "site_url": _site_url(),
        "is_google_user": user.is_google_user,
        "reset_link": f"{_site_url()}/reset-password?token={token}",
        "expires_in": RESET_EXPIRES_IN,
    }


def _welcome_text(c: dict) -> str:
    hi = f"Hi {c['firstname']}" if c["firstname"] else "Hi there"
    shelf = c["site_url"] + c["profile_url"]
    if c["is_profile_public"]:
        privacy = "It's public, so anyone with this link can see what you add. You can make it private from your profile at any time."
    else:
        privacy = "It's private. Only you can see what you add. You can make it public from your profile."
    if c["is_google_user"]:
        signin = f"You signed up with Google as {c['email']} on {c['created_at']}. There's no password to remember. Keep using \"Continue with Google\" to sign in."
    else:
        signin = f"You signed up as {c['email']} on {c['created_at']}. If you forget your password, use \"Forgot password?\" on the sign-in page."
    return f"""{hi}, your shelf is ready.

Dora keeps a record of the books you own and the films you've watched. It's empty for now, so here's how to start.

Open Dora: {c['site_url']}{c['cta_url']}

01 Add a book
Scan the barcode with your phone camera, or type the ISBN. Dora fills in the cover, author, and page count.

02 Add a film
Paste an IMDb ID or search a title. Dora fills in the poster, director, and runtime.

03 Write it down
Mark what you've read or watched, and keep a note of what stayed with you.

More detail in the guide: {c['site_url']}{c['guide_url']}
Browse other shelves: {c['site_url']}{c['explore_url']}

Your shelf: {shelf}
{privacy}

{signin}

You're getting this because a Dora account was created with {c['email']}. If that wasn't you, you can ignore this email.
"""


def _reset_text(c: dict) -> str:
    hi = f"Hi {c['firstname']}," if c["firstname"] else "Hi there,"
    if c["is_google_user"]:
        body = f"You usually sign in to Dora with Google, so {c['email']} doesn't have a password yet. If you'd like one, set it here. Signing in with Google will keep working too."
        ignore = "You can ignore this email. Nothing changes unless you use the link, and you can keep signing in with Google."
    else:
        body = f"We got a request to reset the password for {c['email']}. If it was you, choose a new one here."
        ignore = "You can ignore this email. Your password stays the same unless you use the link."
    return f"""{hi}

{body}

{c['reset_link']}

The link works for {c['expires_in']}. After that, ask for a new one from the sign-in page.

Didn't ask for this? {ignore}
"""


# Each returns send_email's arguments, rendered while the request still holds
# the user, so the route can hand them to a background task:
#   background.add_task(send_email, *welcome_email(user))

def welcome_email(user: User) -> tuple[str, str, str, str]:
    c = welcome_context(user)
    html = _env.get_template("welcome.html").render(c)
    return user.email, "Welcome to Dora", html, _welcome_text(c)


def reset_password_email(user: User, token: str) -> tuple[str, str, str, str]:
    c = reset_context(user, token)
    subject = "Set a password for Dora" if user.is_google_user else "Reset your Dora password"
    html = _env.get_template("password_reset.html").render(c)
    return user.email, subject, html, _reset_text(c)
