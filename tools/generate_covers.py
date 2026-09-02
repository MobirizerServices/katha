#!/usr/bin/env python3
"""Generate placeholder key art for every Katha series — v2, art-directed.

Four assets per series, consumed across the surfaces:
  media/{slug}/cover_9x16.jpg    1080x1920  poster/thumb (iOS cards, paywall, web)
  media/{slug}/cover_16x9.jpg    1920x1080  banner/billboard (feed hero, admin, web)
  media/{slug}/cover_1x1.jpg     1200x1200  square thumb (search, rich pushes, social)
  media/{slug}/og_1200x630.jpg   1200x630   link-preview banner (web og:image)

v2 upgrades over the flat gradients: a genre-keyed procedural motif layer
(blooms for romance, shards for revenge/thrillers, skylines for the CEO
sagas, arches for period/myth, arcs for sports), film grain, vignette and a
legibility scrim under the type lockup. Palettes stay anchored to each
series' `cover_hue` so the app's gradient fallbacks still harmonise.

Sources: docs/katha-catalog.json + any panel-created drafts found in the
shared dev DB (admin_kv `series:` rows). Titles render in Latin
transliteration only (local Pillow lacks Raqm; Indic shaping would be wrong).

These are DESIGN PLACEHOLDERS, watermarked as such — real key art is
shot/illustrated per the Sourcing Playbook step 7.

Run:  python3 tools/generate_covers.py
"""
import hashlib
import json
import math
import os
import random
import sqlite3
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "docs" / "katha-catalog.json"
MEDIA = ROOT / "media"
DEV_DB = "/tmp/katha_shared.db"

BOLD = "/System/Library/Fonts/Avenir Next Condensed.ttc"
BODY = "/System/Library/Fonts/Avenir Next.ttc"
# The product display face (bundled in the app + used on the site) — art and
# UI speak one voice. Falls back to Avenir Condensed if the file is missing.
ANTON = str(ROOT / "ios" / "KathaApp" / "Fonts" / "Anton-Regular.ttf")
if not Path(ANTON).exists():
    ANTON = BOLD

LANG_LABEL = {"hi": "HINDI", "ta": "TAMIL", "te": "TELUGU"}
GOLD = (245, 192, 66)


def font(path, size, index=0):
    return ImageFont.truetype(path, int(size), index=index)


def hue_to_rgb(hexstr):
    v = int(str(hexstr).replace("0x", "").replace("#", ""), 16)
    return (v >> 16 & 255, v >> 8 & 255, v & 255)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rotate_hue(rgb, deg):
    import colorsys
    h, l, s = colorsys.rgb_to_hls(*[c / 255 for c in rgb])
    h = (h + deg / 360) % 1
    return tuple(int(c * 255) for c in colorsys.hls_to_rgb(h, l, s))


def palette(base):
    """base hue → (deep ground, mid, accent, warm highlight)."""
    deep = tuple(int(c * 0.22) for c in base)
    mid = tuple(min(255, int(c * 1.15 + 30)) for c in base)
    accent = rotate_hue(tuple(min(255, int(c * 1.35 + 30)) for c in base), 24)
    high = mix(accent, (255, 236, 200), 0.45)
    return deep, mid, accent, high


def diag_gradient(size, c_top, c_bot):
    w, h = size
    img = Image.new("RGB", (2, 2))
    img.putpixel((0, 0), c_top)
    img.putpixel((1, 0), mix(c_top, c_bot, 0.45))
    img.putpixel((0, 1), mix(c_top, c_bot, 0.6))
    img.putpixel((1, 1), c_bot)
    return img.resize((w, h), Image.BILINEAR)


def grain(size, rng, alpha=16):
    tile = Image.frombytes("L", (256, 256), os.urandom(256 * 256))
    layer = Image.new("L", size)
    for x in range(0, size[0], 256):
        for y in range(0, size[1], 256):
            layer.paste(tile, (x, y))
    return Image.merge("RGBA", (layer, layer, layer,
                                layer.point(lambda v: alpha)))


def vignette(size, strength=105):
    w, h = size
    m = Image.new("L", (w // 4, h // 4), 0)
    d = ImageDraw.Draw(m)
    d.ellipse((-w // 8, -h // 8, w // 4 + w // 8, h // 4 + h // 8), fill=255)
    m = m.resize(size).filter(ImageFilter.GaussianBlur(min(size) // 6))
    dark = Image.new("RGBA", size, (0, 0, 0, strength))
    dark.putalpha(m.point(lambda v: int(strength * (1 - v / 255))))
    return dark


# --- genre motifs ------------------------------------------------------------

def motif_blooms(d, size, rng, pal):
    """Romance / family: overlapping translucent blooms + a flowing ribbon."""
    w, h = size
    _, mid, accent, high = pal
    for _ in range(9):
        r = rng.randint(int(min(w, h) * 0.12), int(min(w, h) * 0.34))
        x, y = rng.randint(0, w), rng.randint(0, int(h * 0.75))
        col = rng.choice([mid, accent, high])
        d.ellipse((x - r, y - r, x + r, y + r), fill=col + (rng.randint(60, 120),))
    pts = []
    y0 = h * rng.uniform(0.25, 0.45)
    for i in range(0, w + 40, 40):
        pts.append((i, y0 + math.sin(i / w * math.tau * 1.3) * h * 0.06))
    for off, a in ((0, 150), (14, 90)):
        d.line([(x, y + off) for x, y in pts], fill=high + (a,), width=6)


def motif_shards(d, size, rng, pal):
    """Revenge / thriller / crime: hard diagonal shards and a light beam."""
    w, h = size
    deep, mid, accent, high = pal
    for _ in range(7):
        x = rng.randint(-w // 3, w)
        top_w = rng.randint(int(w * 0.05), int(w * 0.22))
        skew = rng.randint(int(w * 0.15), int(w * 0.5))
        col = rng.choice([mid, accent, tuple(int(c * 0.6) for c in accent)])
        d.polygon([(x, 0), (x + top_w, 0), (x + top_w + skew, h), (x + skew, h)],
                  fill=col + (rng.randint(70, 130),))
    bx = rng.randint(int(w * 0.5), int(w * 0.85))
    d.polygon([(bx, 0), (bx + int(w * 0.05), 0), (bx - int(w * 0.18), h),
               (bx - int(w * 0.24), h)], fill=high + (80,))


def motif_skyline(d, size, rng, pal):
    """CEO / billionaire: night skyline bars with lit-window specks."""
    w, h = size
    deep, mid, accent, high = pal
    x = -rng.randint(0, 60)
    while x < w:
        bw = rng.randint(int(w * 0.05), int(w * 0.13))
        bh = rng.randint(int(h * 0.25), int(h * 0.62))
        col = mix(deep, mid, rng.uniform(0.25, 0.7))
        d.rectangle((x, h - bh, x + bw, h), fill=col + (220,))
        for _ in range(bh * bw // 12000):
            wx = rng.randint(x + 6, max(x + 7, x + bw - 8))
            wy = rng.randint(h - bh + 8, h - 12)
            d.rectangle((wx, wy, wx + 6, wy + 9), fill=high + (rng.randint(150, 240),))
        x += bw + rng.randint(8, 30)


def motif_arches(d, size, rng, pal):
    """Period / myth / fantasy: concentric arches, haveli geometry."""
    w, h = size
    _, mid, accent, high = pal
    cx = rng.randint(int(w * 0.3), int(w * 0.7))
    base_r = int(min(w, h) * 0.55)
    for i in range(6):
        r = base_r - i * int(base_r * 0.14)
        col = [mid, accent, high][i % 3]
        d.arc((cx - r, int(h * 0.42) - r, cx + r, int(h * 0.42) + r),
              180, 360, fill=col + (140 + i * 18,), width=max(10, r // 16))
    for _ in range(24):
        x, y = rng.randint(0, w), rng.randint(0, int(h * 0.5))
        d.ellipse((x, y, x + 4, y + 4), fill=high + (rng.randint(120, 220),))


def motif_arcs(d, size, rng, pal):
    """Sports / action: sweeping speed arcs."""
    w, h = size
    _, mid, accent, high = pal
    for i in range(8):
        r = int(max(w, h) * (0.35 + i * 0.11))
        col = [mid, accent, high][i % 3]
        d.arc((w - r * 2 + rng.randint(-60, 60), h - r + rng.randint(-80, 80),
               w + rng.randint(-40, 40), h + r),
              200, 330, fill=col + (110,), width=rng.randint(14, 34))


MOTIFS = [
    (("romance", "second chance", "marriage"), motif_blooms),
    (("revenge", "thriller", "crime", "betrayal"), motif_shards),
    (("billionaire", "ceo", "workplace", "business"), motif_skyline),
    (("period", "myth", "fantasy", "family"), motif_arches),
    (("sports", "action", "campus"), motif_arcs),
]


def pick_motif(slug, genres, tropes):
    """The slug's own theme outranks the genre: ceo-sahab is a romance, but
    its world is the boardroom — the skyline says so at a glance."""
    for hay in (slug.replace("-", " ").lower(),
                " ".join(genres + tropes).lower()):
        for keys, fn in MOTIFS:
            if any(k in hay for k in keys):
                return fn
    return motif_blooms


# --- composition -------------------------------------------------------------

def chip(d, xy, text, fnt, fg=(255, 255, 255), bg=None, pad=(18, 10)):
    x, y = xy
    w = d.textlength(text, font=fnt)
    box = (x, y, x + w + pad[0] * 2, y + fnt.size + pad[1] * 2 + 4)
    if bg:
        d.rounded_rectangle(box, radius=(box[3] - box[1]) // 2, fill=bg)
    else:
        d.rounded_rectangle(box, radius=(box[3] - box[1]) // 2,
                            outline=(255, 255, 255, 130), width=2)
    d.text((x + pad[0], y + pad[1]), text, font=fnt, fill=fg)
    return box[2] - box[0]


def wrap(d, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if d.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def draw_cover(s, size, layout):
    """layout: 'portrait' | 'banner' | 'square' | 'og'."""
    w, h = size
    rng = random.Random(int(hashlib.sha256(s["slug"].encode()).hexdigest()[:8], 16))
    pal = palette(hue_to_rgb(s["cover_hue"]))
    deep, mid, accent, high = pal

    img = diag_gradient(size, mix(mid, deep, 0.35), deep).convert("RGBA")
    motif = Image.new("RGBA", size, (0, 0, 0, 0))
    pick_motif(s["slug"], s["genres"], s.get("tropes", []))(ImageDraw.Draw(motif), size, rng, pal)
    img = Image.alpha_composite(img, motif.filter(ImageFilter.GaussianBlur(1)))

    # legibility scrim behind the lockup
    scrim = Image.new("RGBA", size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(scrim)
    if layout == "banner":
        for x in range(int(w * 0.62)):
            sd.line((x, 0, x, h), fill=(0, 0, 0, int(165 * (1 - x / (w * 0.62)))))
    else:
        for y in range(int(h * 0.55), h):
            t = (y - h * 0.55) / (h * 0.45)
            sd.line((0, y, w, y), fill=(0, 0, 0, int(185 * t)))
    img = Image.alpha_composite(img, scrim)
    img = Image.alpha_composite(img, vignette(size))
    img = Image.alpha_composite(img, grain(size, rng))
    d = ImageDraw.Draw(img, "RGBA")

    scale = (w / 1080) if layout == "portrait" else (h / 1080 if layout == "banner"
             else w / 1200)
    m = int(72 * scale)

    # v3 discipline: posters carry ONE lockup — the title, in the product's
    # display face. No eyebrow, no hook paragraph, no chip clutter: at rail
    # sizes those baked strings read as noise and flatten every screen. The
    # banner carries NO title at all — the app and site overlay their own,
    # and a second baked title was double-printing under it. Only the og card
    # (a link preview that must stand alone) keeps the fuller lockup.

    if layout == "banner":
        f_wm = font(BODY, 20 * scale, 0)
        d.text((w - m - d.textlength("PLACEHOLDER", font=f_wm), h - int(34 * scale)),
               "PLACEHOLDER", font=f_wm, fill=(255, 255, 255, 60))
        return img.convert("RGB")

    if layout == "og":
        f_eyebrow = font(BODY, 26 * scale, 1)
        d.text((m, m), "KATHA  ORIGINAL", font=f_eyebrow, fill=high + (235,))
        d.line((m, m + int(44 * scale), m + int(120 * scale), m + int(44 * scale)),
               fill=GOLD, width=max(2, int(4 * scale)))

    tsize = {"portrait": 150, "square": 110, "og": 96}[layout]
    f_title = font(ANTON, tsize * scale)
    f_mean = font(BODY, 30 * scale, 0)
    max_w = w - m * 2
    lines = wrap(d, s["title"].upper(), f_title, max_w)[:3]
    lh = int(f_title.size * 1.06)

    block = len(lines) * lh + int(56 * scale)
    show_meaning = layout != "square" and s.get("title_meaning")
    if show_meaning:
        block += int(46 * scale)
    if layout == "og":
        block += int(56 * scale)
    y = h - m - block

    d.line((m, y - int(26 * scale), m + int(120 * scale), y - int(26 * scale)),
           fill=GOLD + (220,), width=max(2, int(5 * scale)))
    for line in lines:
        d.text((m + 3, y + 4), line, font=f_title, fill=(0, 0, 0, 140))
        d.text((m, y), line, font=f_title, fill=(255, 255, 255))
        y += lh
    if show_meaning:
        d.text((m, y + int(8 * scale)), s["title_meaning"].upper(),
               font=f_mean, fill=GOLD)
        y += int(46 * scale)

    if layout == "og":
        f_chip = font(BODY, 25 * scale, 1)
        cy = h - m - int(46 * scale)
        x = m
        x += chip(d, (x, cy), LANG_LABEL.get(s["primary_language"], "HINDI"),
                  f_chip, fg=(20, 20, 25), bg=(255, 255, 255, 235)) + int(12 * scale)
        chip(d, (x, cy), f"{s['episode_count']} EPISODES", f_chip)

    f_wm = font(BODY, 19 * scale, 0)
    d.text((w - m - d.textlength("PLACEHOLDER", font=f_wm), h - int(32 * scale)),
           "PLACEHOLDER", font=f_wm, fill=(255, 255, 255, 60))
    return img.convert("RGB")


# --- sources -----------------------------------------------------------------

def kv_draft_series():
    """Panel-created drafts from the shared dev DB, if it exists."""
    if not Path(DEV_DB).exists():
        return []
    out = []
    try:
        db = sqlite3.connect(DEV_DB)
        rows = db.execute(
            "SELECT key, value FROM admin_kv WHERE key LIKE 'series:%'").fetchall()
    except sqlite3.Error:
        return []
    for key, raw in rows:
        try:
            v = json.loads(raw)
        except ValueError:
            continue
        slug = key.split(":", 1)[1]
        out.append({
            "slug": slug, "title": v.get("title", slug),
            "genres": v.get("genres") or ["Drama"], "tropes": v.get("tropes", []),
            "primary_language": v.get("language", "hi"),
            "content_rating": v.get("rating", "U/A 13+"),
            "episode_count": v.get("episode_count", 0),
            "free_episodes": v.get("free_episodes", 10),
            "tagline": v.get("synopsis") or "A new Katha original.",
            "title_meaning": "",
            "cover_hue": "0x" + hashlib.sha256(slug.encode()).hexdigest()[:6],
        })
    return out


ASSETS = [
    ("cover_9x16.jpg", (1080, 1920), "portrait"),
    ("cover_16x9.jpg", (1920, 1080), "banner"),
    ("cover_1x1.jpg", (1200, 1200), "square"),
    ("og_1200x630.jpg", (1200, 630), "og"),
]


def main():
    series = json.loads(CATALOG.read_text())["series"] + kv_draft_series()
    n = 0
    for s in series:
        s.setdefault("free_episodes", 10)
        out = MEDIA / s["slug"]
        out.mkdir(parents=True, exist_ok=True)
        for name, size, layout in ASSETS:
            draw_cover(s, size, layout).save(out / name, quality=88, optimize=True)
            n += 1
        print(f"  {s['slug']}: {', '.join(a[0] for a in ASSETS)}")
    print(f"Done: {n} assets for {len(series)} series in {MEDIA}")


if __name__ == "__main__":
    main()
