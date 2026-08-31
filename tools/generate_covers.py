#!/usr/bin/env python3
"""Generate placeholder cover art for every series in docs/katha-catalog.json.

Output (mirrors the PDD 7.1 art requirements):
  media/{slug}/cover_9x16.jpg   1080x1920  portrait key art (app, paywall)
  media/{slug}/cover_16x9.jpg   1920x1080  landscape (web hero, admin)

These are DESIGN PLACEHOLDERS for dev and demo, not shippable key art: real
covers are shot/illustrated per the Sourcing Playbook step 7. Titles render in
Latin transliteration only - the local Pillow has no Raqm/HarfBuzz, so
Devanagari/Tamil/Telugu shaping would come out wrong. Native-script key art is
a Design deliverable.

Run:  python3 tools/generate_covers.py
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "docs" / "katha-catalog.json"
MEDIA = ROOT / "media"

BOLD = "/System/Library/Fonts/Avenir Next Condensed.ttc"
BODY = "/System/Library/Fonts/Avenir Next.ttc"

LANG_LABEL = {"hi": "HINDI", "ta": "TAMIL", "te": "TELUGU"}


def font(path, size, index=0):
    return ImageFont.truetype(path, size, index=index)


def hue_to_rgb(hexstr):
    v = int(hexstr.replace("0x", ""), 16)
    return (v >> 16 & 255, v >> 8 & 255, v & 255)


def gradient(size, base):
    """Vertical gradient: base lightened at the top, near-black at the bottom."""
    w, h = size
    img = Image.new("RGB", (1, h))
    px = img.load()
    top = tuple(min(255, int(c * 1.9 + 34)) for c in base)
    bot = tuple(int(c * 0.34) for c in base)
    for y in range(h):
        t = (y / (h - 1)) ** 0.85
        px[0, y] = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
    return img.resize((w, h), Image.BILINEAR)


def wrap(draw, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def chip(draw, xy, text, fnt, fg=(255, 255, 255), bg=None, pad=(18, 10)):
    x, y = xy
    w = draw.textlength(text, font=fnt)
    h = fnt.size
    box = (x, y, x + w + pad[0] * 2, y + h + pad[1] * 2 + 4)
    if bg:
        draw.rounded_rectangle(box, radius=(box[3] - box[1]) // 2, fill=bg)
    else:
        draw.rounded_rectangle(box, radius=(box[3] - box[1]) // 2,
                               outline=(255, 255, 255, 120), width=2)
    draw.text((x + pad[0], y + pad[1]), text, font=fnt, fill=fg)
    return box[2] - box[0]


def draw_cover(s, size, portrait):
    w, h = size
    base = hue_to_rgb(s["cover_hue"])
    img = gradient(size, base).convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")

    # a soft off-centre glow so the flat gradient reads as art direction
    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = (int(w * 0.72), int(h * 0.3)) if portrait else (int(w * 0.78), int(h * 0.35))
    r = int(max(w, h) * 0.42)
    for i in range(28):
        a = int(5 + i * 0.7)
        rr = int(r * (1 - i / 30))
        gd.ellipse((cx - rr, cy - rr, cx + rr, cy + rr),
                   fill=(255, 245, 220, a))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")

    scale = w / 1080 if portrait else h / 1080
    m = int(72 * scale)

    # wordmark
    f_mark = font(BOLD, int(38 * scale), 1)
    d.text((m, m), "KATHA", font=f_mark, fill=(255, 255, 255, 200))
    d.line((m, m + int(52 * scale), m + int(96 * scale), m + int(52 * scale)),
           fill=(245, 192, 66), width=max(2, int(4 * scale)))

    # the tagline sits high, big and ghosted - it is the hook, and it stops
    # the top two-thirds of a placeholder reading as dead space
    f_tag = font(BOLD, int((72 if portrait else 60) * scale), 1)
    tag_lines = wrap(d, s["tagline"], f_tag, w - m * 2 if portrait else int(w * 0.55))
    ty = int(h * (0.22 if portrait else 0.24))
    for line in tag_lines:
        d.text((m, ty), line, font=f_tag, fill=(255, 255, 255, 90))
        ty += int(f_tag.size * 1.12)
    d.line((m, ty + int(24 * scale), m + int(140 * scale), ty + int(24 * scale)),
           fill=(245, 192, 66, 140), width=max(2, int(3 * scale)))

    # title block, bottom-anchored
    f_title = font(BOLD, int((116 if portrait else 96) * scale), 1)
    f_mean = font(BODY, int(34 * scale), 0)
    f_syn = font(BODY, int(30 * scale), 0)
    f_chip = font(BODY, int(26 * scale), 1)

    max_w = w - m * 2 if portrait else int(w * 0.62)
    lines = wrap(d, s["title"], f_title, max_w)
    lh = int(f_title.size * 1.02)

    syn = s["synopsis"]
    syn = syn if len(syn) < 150 else syn[:147].rsplit(" ", 1)[0] + "..."
    syn_lines = wrap(d, syn, f_syn, max_w)[:3]

    block_h = len(lines) * lh + int(56 * scale) + len(syn_lines) * int(f_syn.size * 1.45)
    y = h - m - block_h - int(70 * scale)

    for line in lines:
        d.text((m + 3, y + 3), line, font=f_title, fill=(0, 0, 0, 110))
        d.text((m, y), line, font=f_title, fill=(255, 255, 255))
        y += lh

    if s["title_meaning"]:
        d.text((m, y + int(8 * scale)), s["title_meaning"].upper(),
               font=f_mean, fill=(245, 192, 66))
        y += int(48 * scale)
    y += int(20 * scale)

    for line in syn_lines:
        d.text((m, y), line, font=f_syn, fill=(255, 255, 255, 200))
        y += int(f_syn.size * 1.45)

    # chips
    cy2 = h - m - int(52 * scale)
    x = m
    x += chip(d, (x, cy2), LANG_LABEL[s["primary_language"]], f_chip,
              fg=(20, 20, 25), bg=(255, 255, 255, 235)) + int(14 * scale)
    x += chip(d, (x, cy2), s["genres"][0].upper(), f_chip) + int(14 * scale)
    x += chip(d, (x, cy2), f"{s['episode_count']} EPISODES", f_chip) + int(14 * scale)
    chip(d, (x, cy2), "10 FREE", f_chip, fg=(18, 40, 26), bg=(47, 191, 113, 240))

    # rating, top right
    f_rate = font(BODY, int(28 * scale), 1)
    rw = d.textlength(s["content_rating"], font=f_rate)
    d.rounded_rectangle((w - m - rw - int(28 * scale), m - int(4 * scale),
                         w - m, m + int(44 * scale)),
                        radius=int(8 * scale), outline=(255, 255, 255, 150), width=2)
    d.text((w - m - rw - int(14 * scale), m + int(6 * scale)),
           s["content_rating"], font=f_rate, fill=(255, 255, 255, 220))

    # placeholder watermark - must never be mistaken for final key art
    f_wm = font(BODY, int(22 * scale), 0)
    d.text((m, h - int(34 * scale)), "PLACEHOLDER KEY ART - DEV BUILD",
           font=f_wm, fill=(255, 255, 255, 90))
    return img


def main():
    catalog = json.loads(CATALOG.read_text())
    n = 0
    for s in catalog["series"]:
        out = MEDIA / s["slug"]
        out.mkdir(parents=True, exist_ok=True)
        draw_cover(s, (1080, 1920), True).save(out / "cover_9x16.jpg", quality=88, optimize=True)
        draw_cover(s, (1920, 1080), False).save(out / "cover_16x9.jpg", quality=88, optimize=True)
        n += 2
        print(f"  {s['slug']}: cover_9x16.jpg + cover_16x9.jpg")
    print(f"Done: {n} covers in {MEDIA}")


if __name__ == "__main__":
    main()
