#!/usr/bin/env python3
"""Fetch a video from the Internet Archive and ingest it into Katha's HLS —
ONLY when the item's own metadata says it's public domain or Creative Commons.

Not everything on archive.org is free to use: much is uploaded without rights
(old Bollywood especially). This tool refuses any item that lacks a clear
PD/CC signal in its metadata, so you can't accidentally pull infringing content.
Override with --i-verified-rights ONLY after you've confirmed the rights
yourself and accept responsibility.

Usage:
  python tools/fetch_archive.py --id <archive-identifier> --slug S --episode N
  python tools/fetch_archive.py --plan plan.json      # [{id, slug, episode}, ...]

Find the identifier in the item URL: archive.org/details/<IDENTIFIER>.
Add --no-ingest to only download the file for review.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
import urllib.request
from pathlib import Path

META = "https://archive.org/metadata/{id}"
DL = "https://archive.org/download/{id}/{name}"
VIDEO_EXT = (".mp4", ".m4v", ".ogv", ".mpeg", ".mpg")


def _get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "katha-fetch"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def rights_ok(m: dict) -> tuple[bool, str]:
    """Return (usable, reason) from an item's metadata rights signals."""
    lic = (m.get("licenseurl") or "").lower()
    status = (m.get("possible-copyright-status") or "").lower()
    rights = (m.get("rights") or "").lower()
    if "creativecommons.org" in lic:
        return True, f"CC license: {m.get('licenseurl')}"
    if status == "public domain" or "public domain" in rights:
        return True, "marked public domain"
    return False, ("no public-domain / Creative-Commons signal in metadata "
                   f"(licenseurl={m.get('licenseurl')!r}, "
                   f"possible-copyright-status={m.get('possible-copyright-status')!r}, "
                   f"rights={m.get('rights')!r})")


def pick_video(files: list[dict]) -> str | None:
    """Largest downloadable video file in the item."""
    vids = [f for f in files if (f.get("name", "").lower().endswith(VIDEO_EXT))]
    if not vids:
        return None
    vids.sort(key=lambda f: int(f.get("size") or 0), reverse=True)
    return vids[0]["name"]


def _download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "katha-fetch"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as out:
        while chunk := resp.read(1 << 16):
            out.write(chunk)


def main() -> None:
    ap = argparse.ArgumentParser(description="Fetch a PD/CC video from Internet Archive → ingest.")
    ap.add_argument("--id")
    ap.add_argument("--slug")
    ap.add_argument("--episode")
    ap.add_argument("--plan")
    ap.add_argument("--out-dir")
    ap.add_argument("--no-ingest", action="store_true")
    ap.add_argument("--fit", choices=["cover", "contain"], default="cover")
    ap.add_argument("--i-verified-rights", action="store_true",
                    help="proceed even without a PD/CC signal — you take responsibility")
    args = ap.parse_args()

    if args.plan:
        jobs = json.loads(Path(args.plan).read_text())
    elif args.id and args.slug and args.episode:
        jobs = [{"id": args.id, "slug": args.slug, "episode": int(args.episode)}]
    else:
        sys.exit("give --plan, or --id + --slug + --episode")

    out_dir = Path(args.out_dir) if args.out_dir else Path(tempfile.mkdtemp(prefix="katha-ia-"))
    out_dir.mkdir(parents=True, exist_ok=True)

    downloaded: list[Path] = []
    for job in jobs:
        ident = job["id"]
        try:
            meta = _get_json(META.format(id=ident))
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ {ident} — metadata fetch failed: {e}", file=sys.stderr)
            continue
        if meta.get("is_dark"):
            print(f"  ✗ {ident} — item is darked/unavailable", file=sys.stderr)
            continue
        m = meta.get("metadata", {})
        ok, reason = rights_ok(m)
        if not ok and not args.i_verified_rights:
            print(f"  ✗ {ident} — REFUSED: {reason}\n"
                  f"      verify rights at archive.org/details/{ident}; if genuinely "
                  f"clear, re-run with --i-verified-rights", file=sys.stderr)
            continue
        name = pick_video(meta.get("files", []))
        if not name:
            print(f"  ✗ {ident} — no downloadable video file", file=sys.stderr)
            continue
        dest = out_dir / f"{job['slug']}_e{int(job['episode']):02d}.mp4"
        print(f"  … {ident} — {reason if ok else 'rights self-verified'}; downloading {name}")
        _download(DL.format(id=ident, name=urllib.request.quote(name)), dest)
        downloaded.append(dest)
        print(f"  ✓ {job['slug']} e{int(job['episode']):03d} → {dest.name}")

    if not downloaded:
        sys.exit("nothing downloaded")
    print(f"\n{len(downloaded)} clip(s) in {out_dir}")

    if args.no_ingest:
        print(f"skipping ingest (--no-ingest). Ingest with:\n"
              f"  python tools/ingest_media.py --source-dir {out_dir}")
        return
    import subprocess
    subprocess.run([sys.executable, str(Path(__file__).with_name("ingest_media.py")),
                    "--source-dir", str(out_dir), "--fit", args.fit], check=True)


if __name__ == "__main__":
    main()
