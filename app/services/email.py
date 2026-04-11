import smtplib
from email.message import EmailMessage
from app.config import settings

def send_email(email_to: str, subject: str, html_content: str):
    if not settings.SMTP_HOST:
        print(f"SMTP not configured. Would send to {email_to}: {subject}")
        return

    message = EmailMessage()
    message["From"] = f"{settings.EMAILS_FROM_NAME} <{settings.EMAILS_FROM_EMAIL}>"
    message["To"] = email_to
    message["Subject"] = subject
    message.set_content(html_content, subtype="html")

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
        if settings.SMTP_TLS:
            server.starttls()
        if settings.SMTP_USER and settings.SMTP_PASSWORD:
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.send_message(message)

def send_reset_password_email(email_to: str, token: str):
    subject = "Password Reset - Open Bookie"
    link = f"http://localhost:8000/reset-password?token={token}"
    html_content = f"""
    <p>We received a request to reset your password for your Open Bookie account.</p>
    <p>Please click the link below to set a new password:</p>
    <p><a href="{link}">{link}</a></p>
    <p>If you didn't request this, you can safely ignore this email.</p>
    """
    send_email(email_to, subject, html_content)
