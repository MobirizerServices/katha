#!/usr/bin/env python3
"""Fetch royalty-free PORTRAIT clips from Pexels and ingest them into Katha's
HLS structure — the copyright-clean way to fill a demo with real video.

Pexels clips are free for commercial use with no attribution required, so this
gives a real-video demo with zero rights exposure. Needs a free API key:
  https://www.pexels.com/api/  →  export PEXELS_API_KEY=...

Usage:
  # one search → one episode
  PEXELS_API_KEY=… python tools/fetch_stock.py --query "woman city night" \
      --slug kaanch-ka-mahal --episode 1

  # a plan file: [{"query","slug","episode"}, ...] — one clip each
  PEXELS_API_KEY=… python tools/fetch_stock.py --plan demo_plan.json

Downloads the best portrait rendition to a temp file, then hands it to
tools/ingest_media.py (so the output is identical to any other content). Add
--no-ingest to only download the MP4s (named {slug}_e{NN}.mp4) for review first.
"""
from __future__ import annotations

import argparse
import json
import re
import os
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path


SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,39}$")


def check_job(slug: str, episode) -> tuple[str, int]:
    """Validate a (slug, episode) from a plan/map/CLI before it becomes a path:
    a slug like "../../../Users/x/.ssh/y" would otherwise write outside media/."""
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        raise SystemExit(f"invalid slug {slug!r}: a-z, 0-9 and hyphens, 2-40 chars")
    try:
        ep = int(episode)
    except (TypeError, ValueError):
        raise SystemExit(f"invalid episode {episode!r} for {slug}") from None
    if not (1 <= ep <= 999):
        raise SystemExit(f"episode {ep} out of range for {slug} (1-999)")
    return slug, ep

API = "https://api.pexels.com/videos/search"


def _search_portrait(query: str, key: str) -> dict | None:
    """Return the best portrait video file for a query, or None."""
    url = f"{API}?query={urllib.parse.quote(query)}&orientation=portrait&per_page=5"
    req = urllib.request.Request(url, headers={"Authorization": key})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    for video in data.get("videos", []):
        # Prefer a portrait file around 1080 wide; fall back to the largest.
        files = sorted(
            (f for f in video.get("video_files", [])
             if (f.get("height") or 0) > (f.get("width") or 0)),  # portrait only
            key=lambda f: abs((f.get("width") or 0) - 1080))
        if files:
            return {"url": files[0]["link"], "id": video.get("id"),
                    "user": (video.get("user") or {}).get("name", "")}
    return None


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "katha-fetch"})
    with urllib.request.urlopen(req, timeout=60) as resp, open(dest, "wb") as out:
        while chunk := resp.read(1 << 16):
            out.write(chunk)


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch royalty-free clips → ingest.")
    ap.add_argument("--query")
    ap.add_argument("--slug")
    ap.add_argument("--episode")
    ap.add_argument("--plan", help="JSON: [{query, slug, episode}, ...]")
    ap.add_argument("--out-dir", default=None,
                    help="keep the downloaded MP4s here (default: a temp dir)")
    ap.add_argument("--no-ingest", action="store_true",
                    help="download only; run tools/ingest_media.py yourself")
    ap.add_argument("--fit", choices=["cover", "contain"], default="cover")
    args = ap.parse_args()

    key = os.environ.get("PEXELS_API_KEY")
    if not key:
        sys.exit("set PEXELS_API_KEY (free at https://www.pexels.com/api/)")

    if args.plan:
        jobs = json.loads(Path(args.plan).read_text())
    elif args.query and args.slug and args.episode:
        jobs = [{"query": args.query, "slug": args.slug, "episode": int(args.episode)}]
    else:
        sys.exit("give --plan, or --query + --slug + --episode")

    out_dir = Path(args.out_dir) if args.out_dir else Path(tempfile.mkdtemp(prefix="katha-stock-"))
    out_dir.mkdir(parents=True, exist_ok=True)

    downloaded: list[Path] = []
    for job in jobs:
        job["slug"], job["episode"] = check_job(job.get("slug"), job.get("episode"))
        hit = _search_portrait(job["query"], key)
        if hit is None:
            print(f"  ✗ {job['slug']} e{int(job['episode']):03d} — no portrait clip for "
                  f"“{job['query']}”", file=sys.stderr)
            continue
        dest = out_dir / f"{job['slug']}_e{int(job['episode']):02d}.mp4"
        _download(hit["url"], dest)
        downloaded.append(dest)
        print(f"  ✓ {job['slug']} e{int(job['episode']):03d} — Pexels #{hit['id']} "
              f"by {hit['user']} → {dest.name}")

    if not downloaded:
        sys.exit("nothing downloaded")
    print(f"\n{len(downloaded)} clip(s) in {out_dir}")

    if args.no_ingest:
        print("skipping ingest (--no-ingest). Ingest later with:")
        print(f"  python tools/ingest_media.py --source-dir {out_dir}")
        return

    # Hand off to the ingest/transcode pipeline.
    import subprocess
    subprocess.run([sys.executable, str(Path(__file__).with_name("ingest_media.py")),
                    "--source-dir", str(out_dir), "--fit", args.fit], check=True)


if __name__ == "__main__":
    main()
