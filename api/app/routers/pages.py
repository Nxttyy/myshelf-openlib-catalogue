"""
Server-rendered pages. Everything else is the React app (web/), served by
main.py; this is only the phone's scan page, kept as a small standalone page so
a phone scanning for a desktop session doesn't download the whole app.
"""

from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates

router = APIRouter(tags=["Pages"])
templates = Jinja2Templates(directory="app/templates")

# Cache-busting suffix for /static/* links (see main.py's Cache-Control
# middleware). Bump this string whenever CSS/JS under app/static changes.
templates.env.globals["static_version"] = "1"


@router.get("/mobile-scan/{token}")
async def mobile_scan_page(request: Request, token: str):
    return templates.TemplateResponse(
        name="mobile_scan.html", request=request, context={"token": token}
    )
