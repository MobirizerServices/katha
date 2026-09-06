#!/usr/bin/env python3
"""Build a series' cover art from frames the episode pipeline already generated.

The placeholder generator writes a gradient arc with the title baked into it,
which is fine for a demo row and wrong the moment a title has real footage. This
composes the poster, the billboard, the square and the Open Graph card out of
chosen key frames instead — no image model, no credit, no network.

Media lives outside git, so a media regen silently restores the placeholders.
That is the reason this is a committed tool rather than a handful of ffmpeg
commands in a terminal: the choice of frames is a creative decision worth
keeping.

    python3 tools/make_cover.py --slug kaanch-ka-mahal \\
        --poster e01:s13 --wide e02:s05 --wide-y 330

`--poster` and `--wide` name an episode work directory and a key frame inside
it, e.g. ``e02:s05`` reads media/_gen/{slug}_e02/frames/s05.png.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "media" / "_gen"
MEDIA = ROOT / "media"

# Key frames are 9:16 already, so the poster is a straight lift and the
# landscape crops take a band out of the middle. A little unsharp buys back what
# the upscale costs; the grade matches the series' look.
GRADE = "eq=contrast=1.04:saturation=1.03"


def ffmpeg() -> str:
    for c in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if Path(c).exists():
            return c
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit("no ffmpeg found")


def frame(slug: str, spec: str) -> Path:
    try:
        ep, shot = spec.split(":")
    except ValueError:
        sys.exit(f"--poster/--wide want EPISODE:SHOT, e.g. e01:s13 (got {spec!r})")
    p = GEN / f"{slug}_{ep}" / "frames" / f"{shot}.png"
    if not p.exists():
        sys.exit(f"no such frame: {p}")
    return p


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"ffmpeg failed:\n{r.stderr[-600:]}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--poster", required=True, help="frame for 9:16 and 1:1, e.g. e01:s13")
    ap.add_argument("--wide", required=True, help="frame for 16:9 and the OG card")
    ap.add_argument("--wide-y", type=int, default=330,
                    help="top of the horizontal band, in source pixels — raise it "
                         "until faces are in the band, not torsos (default 330)")
    ap.add_argument("--poster-y", type=int, default=200, help="top of the 1:1 crop")
    args = ap.parse_args()

    out = MEDIA / args.slug
    if not out.is_dir():
        sys.exit(f"no media directory for {args.slug}")
    ff = ffmpeg()
    poster, wide = frame(args.slug, args.poster), frame(args.slug, args.wide)

    jobs = [
        (poster, f"scale=1080:1920:flags=lanczos,unsharp=5:5:0.5:5:5:0.0,{GRADE}",
         "cover_9x16.jpg"),
        (poster, f"crop=864:864:0:{args.poster_y},scale=1080:1080:flags=lanczos,"
                 f"unsharp=5:5:0.5:5:5:0.0,{GRADE}", "cover_1x1.jpg"),
        (wide, f"crop=864:486:0:{args.wide_y},scale=1920:1080:flags=lanczos,"
               f"unsharp=5:5:0.9:5:5:0.0,{GRADE}", "cover_16x9.jpg"),
        (wide, f"crop=864:454:0:{args.wide_y + 16},scale=1200:630:flags=lanczos,"
               f"unsharp=5:5:0.9:5:5:0.0,{GRADE}", "og_1200x630.jpg"),
    ]
    for src, vf, name in jobs:
        dest = out / name
        run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
             "-vf", vf, "-q:v", "2", str(dest)])
        print(f"  ✓ {name} ({dest.stat().st_size // 1024} KB) from {src.parent.parent.name}/{src.name}")
    # cover_version() keys off the poster's mtime, so clients pick these up
    # without a cache purge — but the API holds it for 60 seconds.
    print(f"\n  covers written to {out}")
    print("  the API caches the cover version for 60s; wait a minute before checking a client")


if __name__ == "__main__":
    main()
