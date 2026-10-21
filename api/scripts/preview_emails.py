"""Render every email variant to HTML files to look at in a browser.

    cd api && python -m scripts.preview_emails [out_dir]

Writes welcome/reset × email/Google signup into out_dir (default
/tmp/dora-emails). Images load from site_url, so run the API (and the Vite
server, in dev) for them to show.
"""
import sys
from datetime import datetime
from pathlib import Path

# Register the postgresql dialect before model classes import.
import sqlalchemy.dialects.postgresql  # noqa: F401
from app.models.user import User
from app.services.email import reset_password_email, welcome_email

TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJuYXR0eUBudW1say5pbyJ9.sample-signature"

users = {
    "email": User(firstname="Natty", lastname="Tesfaye", email="natty@numlk.io", username="natty",
                  password="x", created_at=datetime(2026, 10, 20)),
    "google": User(firstname="", lastname="", email="natty@numlk.io", username="natty", password="",
                   is_google_user=True, is_profile_public=False, created_at=datetime(2026, 10, 20)),
}

out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/dora-emails")
out.mkdir(parents=True, exist_ok=True)
for variant, user in users.items():
    for name, (_, subject, html, text) in {
        "welcome": welcome_email(user),
        "reset": reset_password_email(user, TOKEN),
    }.items():
        (out / f"{name}-{variant}.html").write_text(html)
        (out / f"{name}-{variant}.txt").write_text(f"Subject: {subject}\n\n{text}")
        print(out / f"{name}-{variant}.html")
