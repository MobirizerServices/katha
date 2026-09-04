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


# Licenses under which a clip may be cropped, re-encoded and streamed inside a
# PAID product. Exact-match on the canonical URL path: BY-NC forbids commercial
# use, ND forbids the re-encode, and "any creativecommons.org URL" admitted both.
ALLOWED_LICENSES = {
    "publicdomain/zero/1.0": "CC0",
    "publicdomain/mark/1.0": "Public Domain Mark",
    "licenses/by/4.0": "CC BY 4.0",
    "licenses/by/3.0": "CC BY 3.0",
    "licenses/by/2.0": "CC BY 2.0",
    "licenses/by-sa/4.0": "CC BY-SA 4.0",
    "licenses/by-sa/3.0": "CC BY-SA 3.0",
}
MAX_DOWNLOAD_BYTES = 2 * 1024 ** 3      # a mis-tagged 30 GB master must not be pulled whole


def _license_key(url: str) -> str | None:
    """'https://creativecommons.org/licenses/by-nc/4.0/' → 'licenses/by-nc/4.0'."""
    u = (url or "").strip().lower()
    for host in ("https://creativecommons.org/", "http://creativecommons.org/"):
        if u.startswith(host):
            return u[len(host):].strip("/")
    return None


def rights_ok(m: dict) -> tuple[bool, str]:
    """Return (usable, reason). Only an EXACT allow-listed license, or an exact
    public-domain status, passes — substring matches accepted "not public
    domain" and BY-NC-ND before."""
    key = _license_key(m.get("licenseurl") or "")
    if key is not None:
        if key in ALLOWED_LICENSES:
            return True, f"{ALLOWED_LICENSES[key]} ({m.get('licenseurl')})"
        return False, (f"license {m.get('licenseurl')!r} is not usable in a paid product "
                       f"(allowed: {', '.join(sorted(ALLOWED_LICENSES.values()))})")
    status = (m.get("possible-copyright-status") or "").strip().lower()
    rights = (m.get("rights") or "").strip().lower()
    if status in ("public domain", "publicdomain") or rights in ("public domain", "publicdomain"):
        return True, "marked public domain (exact status)"
    return False, ("no public-domain / allow-listed Creative-Commons signal in metadata "
                   f"(licenseurl={m.get('licenseurl')!r}, "
                   f"possible-copyright-status={m.get('possible-copyright-status')!r}, "
                   f"rights={m.get('rights')!r})")


def pick_video(files: list[dict]) -> str | None:
    """Largest downloadable video file in the item that fits the size cap."""
    vids = [f for f in files if (f.get("name", "").lower().endswith(VIDEO_EXT))
            and int(f.get("size") or 0) <= MAX_DOWNLOAD_BYTES]
    if not vids:
        return None
    vids.sort(key=lambda f: int(f.get("size") or 0), reverse=True)
    return vids[0]["name"]


def _download(url: str, dest: Path) -> None:
    """Stream to disk with a hard byte cap (metadata sizes are self-reported)."""
    req = urllib.request.Request(url, headers={"User-Agent": "katha-fetch"})
    with urllib.request.urlopen(req, timeout=120) as resp, open(dest, "wb") as out:
        declared = int(resp.headers.get("Content-Length") or 0)
        if declared > MAX_DOWNLOAD_BYTES:
            raise RuntimeError(f"{declared} bytes exceeds the {MAX_DOWNLOAD_BYTES} cap")
        total = 0
        while chunk := resp.read(1 << 16):
            total += len(chunk)
            if total > MAX_DOWNLOAD_BYTES:
                raise RuntimeError(f"download exceeded the {MAX_DOWNLOAD_BYTES} byte cap")
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
        try:
            _download(DL.format(id=ident, name=urllib.request.quote(name)), dest)
        except RuntimeError as e:
            dest.unlink(missing_ok=True)
            print(f"  ✗ {ident} — {e}", file=sys.stderr)
            continue
        # Provenance next to the clip: what was fetched, under which rights,
        # so a later question ("may we stream this?") has an answer on disk.
        dest.with_suffix(".rights.json").write_text(json.dumps({
            "source": f"https://archive.org/details/{ident}", "file": name,
            "rights": reason if ok else "self-verified with --i-verified-rights",
            "licenseurl": m.get("licenseurl"),
            "possible_copyright_status": m.get("possible-copyright-status"),
            "fetched_at": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc).isoformat(timespec="seconds"),
        }, indent=2))
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
