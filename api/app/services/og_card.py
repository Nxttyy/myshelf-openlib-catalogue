"""
Link-preview cards: the 1200×630 image chat apps and social sites show
under a shared link. Drawn with Pillow in the app's "Dora brand: light"
look: bone paper, near-black ink, vermilion accent, the title in Big
Shoulders Display, labels and text in Schibsted Grotesk. Shows the cover (or
the typographic jacket the app draws when there's none), title, author or
director, and the Dora logo (the book-spine mark beside DORA).

Pure drawing: callers hand in plain data and image bytes (routers/og.py
fetches them), and get JPEG bytes back.
"""

import io
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

W, H = 1200, 630
# Part of every card's fingerprint (services/share.py). Bump it when the
# drawing changes, so cached cards and the URLs pointing at them renew.
DESIGN_VERSION = 3

# web/src/styles/v2.css .th-brand:not(.th-night)
PAPER = "#F3EDE0"
INK = "#0E0D0B"
INK_SOFT = "#4F4A40"
INK_FAINT = "#787266"
ACCENT = "#E8673F"
HAIR = (14, 13, 11, 61)  # --hair-strong, rgba(14,13,11,.24)

FONTS = Path(__file__).resolve().parents[1] / "static" / "fonts"

# Same palettes, order and hash as web/src/lib/covers.ts, so a book without a
# cover image gets the jacket it has in the app: [background, ink, rule].
PALETTES = [
    ("#EDE6D6", "#1A1714", (26, 23, 20, 64)),      # paper
    ("#1B2230", "#EDE6D6", (237, 230, 214, 77)),   # ink
    ("#243B6B", "#EDE6D6", (237, 230, 214, 82)),   # blue
    ("#E0A23E", "#231A0E", (35, 26, 14, 77)),      # amber
    ("#6B2B27", "#F0E5D8", (240, 229, 216, 77)),   # oxblood
    ("#23402F", "#E7E2D0", (231, 226, 208, 77)),   # forest
    ("#141210", "#E9E2D2", (233, 226, 210, 71)),   # black
    ("#8FAFC0", "#15212A", (21, 33, 42, 71)),      # sky
    ("#C97B4A", "#211009", (33, 16, 9, 77)),       # clay
    ("#3A4250", "#E5E3DC", (229, 227, 220, 77)),   # slate
    ("#F2EBDD", "#3A2C1E", (58, 44, 30, 64)),      # cream
    ("#3D2A41", "#E9DCEC", (233, 220, 236, 77)),   # plum
]


@dataclass
class Jacket:
    """What the typographic jacket prints (lib/covers.ts CoverData)."""
    key: str
    title: str
    author: str
    year: str | None = None
    pages: int | None = None
    catalog: str = ""


@dataclass
class Card:
    title: str
    byline: str           # author or director
    label: str            # small caps line above the title
    jacket: Jacket
    cover: bytes | None = None


def _fnv1a(s: str) -> int:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)  # charCodeAt, for the ASCII ids we hash
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def jacket_style(key: str) -> tuple[tuple, int]:
    h = _fnv1a(key)
    return PALETTES[h % len(PALETTES)], (h >> 8) % 4


@lru_cache(maxsize=64)
def _font(name: str, size: int, weight: int) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(str(FONTS / name), size)
    font.set_variation_by_axes([weight])
    return font


def sans(size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    return _font("SchibstedGrotesk.ttf", size, weight)


def mono(size: int, weight: int = 500) -> ImageFont.FreeTypeFont:
    """The label face. The brand theme sets --font-mono to Schibsted too."""
    return _font("SchibstedGrotesk.ttf", size, max(400, weight))


def display(size: int) -> ImageFont.FreeTypeFont:
    """Big Shoulders Display 700: every title in the brand theme, uppercase."""
    return _font("BigShouldersDisplay.ttf", size, 700)


# ── Text ────────────────────────────────────────────────────────────────

def _width(text: str, font: ImageFont.FreeTypeFont, tracking: float = 0) -> float:
    return font.getlength(text) + tracking * max(0, len(text) - 1)


def wrap(text: str, font: ImageFont.FreeTypeFont, max_w: float, max_lines: int) -> list[str]:
    """Greedy word wrap; the last line gets an ellipsis if text is left over."""
    words = text.split()
    lines: list[str] = []
    while words and len(lines) < max_lines:
        line = words.pop(0)
        while words and font.getlength(line + " " + words[0]) <= max_w:
            line += " " + words.pop(0)
        lines.append(line)
    if lines and (words or font.getlength(lines[-1]) > max_w):
        last = lines[-1]
        while last and font.getlength(last + "…") > max_w:
            last = last[:-1].rstrip()
        lines[-1] = last + "…"
    return lines


TITLE_LH = 0.92  # .th-brand display line-height


def fit_title(text: str, max_w: float, max_h: float, sizes: range, max_lines: int = 3):
    """Largest size whose wrapped (uppercase, display) title fits the box
    without an ellipsis, else the smallest size, clipped."""
    text = text.upper()
    for size in sizes:
        font = display(size)
        lines = wrap(text, font, max_w, max_lines)
        if not lines[-1].endswith("…") and len(lines) * size * TITLE_LH <= max_h:
            return font, lines, size
    font = display(sizes[-1])
    return font, wrap(text, font, max_w, max_lines), sizes[-1]


def clip_tracked(text: str, font, tracking: float, max_w: float) -> str:
    """Cut letter-spaced text to max_w, with an ellipsis if it was cut."""
    if _width(text, font, tracking) <= max_w:
        return text
    while text and _width(text + "…", font, tracking) > max_w:
        text = text[:-1]
    return text.rstrip() + "…"


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, font, fill, tracking: float, anchor_right=False):
    """Text with letter-spacing, which Pillow doesn't do on its own."""
    x, y = xy
    if anchor_right:
        x -= _width(text, font, tracking)
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) + tracking


def short_title(t: str) -> str:
    """Cover.tsx shortTitle: no subtitle after a colon, no "(Series)"."""
    s = re.sub(r"\s*\([^)]*\)\s*", " ", re.sub(r":.*$", "", t)).strip()
    return s or t


# ── Cover ───────────────────────────────────────────────────────────────

def _open(data: bytes | None) -> Image.Image | None:
    if not data:
        return None
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception:
        return None
    # Open Library answers a missing cover with a 1×1 pixel.
    return img if img.width >= 40 and img.height >= 40 else None


def draw_jacket(j: Jacket, w: int, h: int) -> Image.Image:
    """The four typographic layouts from Cover.tsx, at w×h."""
    (bg, ink, rule), layout = jacket_style(j.key)
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img, "RGBA")
    u = w / 100
    title = short_title(j.title)
    label = mono(round(7 * u), 500)
    track = 7 * u * 0.16
    label_ink = ink + "99"  # 60% opacity

    def title_block(x, y_bottom, max_w, size, lines_max, align="left", y_top=None):
        font = sans(round(size * u), 600)
        lines = wrap(title, font, max_w, lines_max)
        lh = size * u * 0.98
        y = (y_top if y_top is not None else y_bottom - lh * len(lines))
        for line in lines:
            lx = x + (max_w - font.getlength(line)) / 2 if align == "center" else x
            d.text((lx, y), line, font=font, fill=ink)
            y += lh
        return lh * len(lines)

    pad_x, pad_y = 8 * u, 7 * u
    inner_w = w - 2 * pad_x
    if layout == 0:
        # top label, big title bottom-left, author under a rule
        tracked(d, (pad_x, pad_y), "DORA", label, label_ink, track)
        if j.year:
            tracked(d, (w - pad_x, pad_y), j.year, label, label_ink, track, anchor_right=True)
        author_font = mono(round(8 * u))
        author_y = h - pad_y - 8 * u
        rule_y = author_y - 6 * u
        d.rectangle([pad_x, rule_y, w - pad_x, rule_y + max(1, 0.8 * u)], fill=rule)
        title_block(pad_x, rule_y - 7 * u, inner_w, 17, 4)
        d.text((pad_x, author_y), clip_tracked(j.author.upper(), author_font, 0, inner_w), font=author_font, fill=ink + "CC")
    elif layout == 1:
        # centered modernist: author top, title center, catalog number bottom
        a = clip_tracked(j.author.upper(), label, track, inner_w)
        tracked(d, ((w - _width(a, label, track)) / 2, 8 * u), a, label, ink + "BF", track)
        d.rectangle([pad_x, 8 * u + 13 * u, w - pad_x, 8 * u + 13 * u + max(1, 0.8 * u)], fill=rule)
        font = sans(round(19 * u), 600)
        n = len(wrap(title, font, inner_w, 4))
        title_block(pad_x, 0, inner_w, 19, 4, "center", y_top=h / 2 - n * 19 * u * 0.98 / 2)
        c = f"№ {j.catalog}"
        tracked(d, ((w - _width(c, label, track)) / 2, h - 8 * u - 8 * u), c, label, ink + "80", track)
    elif layout == 2:
        # swiss grid: huge initial, title runs down, surname on the baseline
        d.text((pad_x - 2 * u, pad_y - 6 * u), title[0], font=sans(round(42 * u), 600), fill=ink)
        rule_y = pad_y + 36 * u
        d.rectangle([pad_x, rule_y, w - pad_x, rule_y + max(1, 0.8 * u)], fill=rule)
        last = clip_tracked((j.author.split() or [""])[-1].upper(), label, track, inner_w)
        surname_y = h - pad_y - 8 * u
        tracked(d, (pad_x, surname_y), last, label, label_ink, track)
        title_block(pad_x, surname_y - 6 * u, inner_w, 13, 3)
    else:
        # framed: thin inset border, title mid, two rules
        m = 6 * u
        d.rectangle([m, m, w - m, h - m], outline=rule, width=max(1, round(0.8 * u)))
        p = m + 7 * u
        tracked(d, (p, p), clip_tracked(j.author.upper(), label, track, w - 2 * p), label, label_ink, track)
        font = sans(round(15 * u), 600)
        n = len(wrap(title, font, w - 2 * p, 4))
        title_block(p, 0, w - 2 * p, 15, 4, y_top=h / 2 - n * 15 * u * 0.98 / 2)
        bottom = h - p - 7 * u
        d.rectangle([p, bottom - 5 * u, w - p, bottom - 5 * u + max(1, 0.8 * u)], fill=rule)
        if j.year:
            tracked(d, (p, bottom), f"EST {j.year}", label, label_ink, track)
        if j.pages:
            tracked(d, (w - p, bottom), f"{j.pages}P", label, label_ink, track, anchor_right=True)
    return img


def cover_image(card: Card, w: int, h: int) -> Image.Image:
    img = _open(card.cover)
    if img is None:
        return draw_jacket(card.jacket, w, h)
    return ImageOps.fit(img, (w, h), Image.LANCZOS)


def paste_cover(base: Image.Image, cover: Image.Image, x: int, y: int, radius: int = 6) -> None:
    """A soft shadow under, a spine crease near the left edge, rounded corners."""
    w, h = cover.size
    shadow = Image.new("L", (w + 120, h + 120), 0)
    ImageDraw.Draw(shadow).rounded_rectangle([60, 70, 60 + w, 70 + h], radius, fill=90)
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    base.paste(Image.new("RGB", shadow.size, "#3A2C1E"), (x - 60, y - 60), shadow)

    # Drawn on its own layer: ImageDraw replaces RGBA pixels, it doesn't blend.
    light = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(light)
    crease = max(4, w // 40)
    d.rectangle([0, 0, crease - 1, h], fill=(0, 0, 0, 22))
    d.line([(crease, 0), (crease, h)], fill=(0, 0, 0, 46), width=max(1, w // 300))
    for i in range(crease * 3):
        d.line([(crease + 1 + i, 0), (crease + 1 + i, h)], fill=(255, 255, 255, int(40 * (1 - i / (crease * 3)))))
    face = Image.alpha_composite(cover.convert("RGBA"), light)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius, fill=255)
    base.paste(face, (x, y), mask)


# ── Logo ────────────────────────────────────────────────────────────────

# BrandMark from web/src/components/Logo.tsx (9 pages), in its
# "-8 -2 104 104" viewBox: a spine, a fan of page wedges around (32, 50), and
# the middle page in the accent, nudged out and tipped as if being turned.
def _mark_shapes():
    import math
    n, gap, r0, r1, stem, sw = 9, 6, 14, 38, 15, 1.6
    da = (180 - gap * (n - 1)) / n

    def pt(r, a):
        t = math.radians(a)
        return (32 + r * math.cos(t), 50 + r * math.sin(t))

    def wedge(a):
        steps = 12
        outer = [pt(r1, a + da * i / steps) for i in range(steps + 1)]
        inner = [pt(r0, a + da - da * i / steps) for i in range(steps + 1)]
        return outer + inner

    pages, lit, a = [], None, -90
    for i in range(n):
        if i == n // 2:
            lit = wedge(a)
        else:
            pages.append(wedge(a))
        a += da + gap
    # the lit page: rotate(-8° about 32,50), then translate(6, -1)
    c, s_ = math.cos(math.radians(-8)), math.sin(math.radians(-8))
    lit = [(32 + (x - 32) * c - (y - 50) * s_ + 6, 50 + (x - 32) * s_ + (y - 50) * c - 1) for x, y in lit]
    spine = (32 - stem + sw / 2, 12 + sw / 2, 32 + 0.8, 12 + 76 - sw / 2)
    return spine, pages, lit, sw


def draw_mark(size: int, ink: str = INK, acc: str = ACCENT) -> Image.Image:
    """The mark at size×size px (overflow included), 4× supersampled."""
    ss = 4
    k = size * ss / 104
    img = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    spine, pages, lit, sw = _mark_shapes()
    tr = lambda pts: [((x + 8) * k, (y + 2) * k) for x, y in pts]  # noqa: E731
    w = max(1, round(sw * k))
    x0, y0, x1, y1 = spine
    d.rounded_rectangle([(x0 + 8) * k, (y0 + 2) * k, (x1 + 8) * k, (y1 + 2) * k], radius=1.5 * k, fill=ink)
    for poly, color in [*((p, ink) for p in pages), (lit, acc)]:
        pts = tr(poly)
        d.polygon(pts, fill=color)
        d.line(pts + pts[:1], fill=color, width=w, joint="curve")
    return img.resize((size, size), Image.LANCZOS)


def draw_logo(size: int, ink: str = INK, acc: str = ACCENT) -> Image.Image:
    """Logo.tsx at `size`: the mark at 1.5×size beside DORA in Big Shoulders
    Display 700, 1.3×size, letter-spaced .04em, gap .32×size."""
    mark = draw_mark(round(size * 1.5), ink, acc)
    font = display(round(size * 1.3))
    word, track = "DORA", size * 1.3 * 0.04
    tw = _width(word, font, track)
    gap = round(size * 0.32)
    img = Image.new("RGBA", (mark.width + gap + round(tw) + 2, mark.height), (0, 0, 0, 0))
    img.paste(mark, (0, 0), mark)
    asc, desc = font.getmetrics()
    top, bottom = font.getbbox("DORA")[1], font.getbbox("DORA")[3]
    y = (mark.height - (bottom - top)) / 2 - top
    tracked(ImageDraw.Draw(img), (mark.width + gap, y), word, font, ink, track)
    return img


def _footer(base: Image.Image, x: int, y: int, right: int, site: str) -> None:
    """Hairline, logo on the left, the site's address on the right."""
    d = ImageDraw.Draw(base, "RGBA")
    d.line([(x, y), (right, y)], fill=HAIR, width=2)
    logo = draw_logo(26)
    base.paste(logo, (x - 2, y + 20), logo)
    tracked(d, (right, y + 30), site.upper(), mono(17, 500), INK_FAINT, 1.6, anchor_right=True)


def _encode(img: Image.Image) -> bytes:
    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=88, optimize=True, progressive=True)
    return out.getvalue()


# ── Cards ───────────────────────────────────────────────────────────────

def entry_card(card: Card, site: str) -> bytes:
    """A book or film: the cover large on the left, words on the right."""
    base = Image.new("RGB", (W, H), PAPER)
    cw, ch = 334, 500
    cx, cy = 92, (H - ch) // 2
    paste_cover(base, cover_image(card, cw, ch), cx, cy)

    d = ImageDraw.Draw(base, "RGBA")
    x = cx + cw + 76
    right = W - 84
    max_w = right - x
    top, bottom = cy + 6, cy + ch

    footer_y = bottom - 74
    byline_font = sans(31)
    byline = wrap(card.byline, byline_font, max_w, 1)[0] if card.byline else ""
    room = footer_y - top - 50 - (60 if byline else 20) - 30
    font, lines, size = fit_title(card.title, max_w, room, range(104, 55, -4))
    # label, title and byline sit as one block, centred above the footer
    block = 50 + len(lines) * size * TITLE_LH + (22 + 38 if byline else 0)
    y = top + max(0, (footer_y - 30 - top - block) / 2)
    tracked(d, (x, y), card.label.upper(), mono(19, 500), INK_FAINT, 2.2)
    y += 50
    for line in lines:
        d.text((x, y), line, font=font, fill=INK)
        y += size * TITLE_LH
    if byline:
        d.text((x, y + 22), byline, font=byline_font, fill=INK_SOFT)

    _footer(base, x, footer_y, right, site)
    return _encode(base)


def photo_card(photo: bytes, card: Card, site: str) -> bytes | None:
    """Someone's photo from their note, big, with the book beside it.
    None if the photo can't be read (e.g. HEIC), so the caller can fall back."""
    img = _open(photo)
    if img is None:
        return None
    base = Image.new("RGB", (W, H), PAPER)
    pw = 660
    base.paste(ImageOps.fit(img, (pw, H), Image.LANCZOS, centering=(0.5, 0.42)), (0, 0))

    d = ImageDraw.Draw(base, "RGBA")
    x, right = pw + 64, W - 64
    max_w = right - x
    cw, ch = 104, 156
    paste_cover(base, cover_image(card, cw, ch), x, 58, radius=4)

    tracked(d, (x, 58 + ch + 34), card.label.upper(), mono(17, 500), INK_FAINT, 2)
    footer_y = H - 58 - 74
    byline_font = sans(25)
    byline = wrap(card.byline, byline_font, max_w, 1)[0] if card.byline else ""
    title_top = 58 + ch + 72
    room = footer_y - title_top - (48 if byline else 16)
    font, lines, size = fit_title(card.title, max_w, room, range(64, 35, -3), max_lines=3)
    y = title_top
    for line in lines:
        d.text((x, y), line, font=font, fill=INK)
        y += size * TITLE_LH
    if byline:
        d.text((x, y + 14), byline, font=byline_font, fill=INK_SOFT)

    _footer(base, x, footer_y, right, site)
    return _encode(base)
