#!/usr/bin/env python3
"""Ingest real source videos into Katha's HLS structure — the Secure-upload →
Transcoding path from the platform architecture.

Drop licensed-stock or AI-generated PORTRAIT clips in and this validates and
transcodes each into the exact per-episode layout the app already streams, so
nothing downstream changes. This is the copyright-clean way to put real video
in a demo: the clip flows THROUGH the pipeline, never around it — the app can't
tell it from any other content, and there's no scraped-rights liability.

Output (identical to tools/generate_placeholder_media.py):
  media/{slug}/e{NNN}/source.mp4                normalized 1080x1920 mezzanine
  media/{slug}/e{NNN}/hls/master.m3u8           4-rendition ladder, 2s segments
  media/{slug}/e{NNN}/hls/{1080p,720p,540p,360p}/...

Pick a source:
  --file F --slug S --episode N        one clip → one episode
  --map map.json                       [{"slug","episode","file"}, ...]
  --source-dir DIR                     files named {slug}_e{NN}.mp4 auto-map

Options:
  --fit cover|contain    crop-to-fill (default, fills the vertical frame) or
                         letterbox to 1080x1920 (preserves the whole frame)
  --encrypt              AES-128-encrypt the HLS segments (protected origin);
                         writes a key + prints the key-delivery TODO
  --media-dir DIR        output root (default: the repo's media/)
  --force                re-ingest even if master.m3u8 already exists

Idempotent by default. ffmpeg/ffprobe come from imageio-ffmpeg when present.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
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

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MEDIA = ROOT / "media"

LADDER = [  # (name, w, h, maxrate_k) — portrait, mirrors the placeholder ladder
    ("1080p", 1080, 1920, 6000),
    ("720p", 720, 1280, 2500),
    ("540p", 540, 960, 1400),
    ("360p", 360, 640, 700),
]


def _tool(name: str) -> str:
    """Resolve ffmpeg/ffprobe: env override → imageio-ffmpeg → PATH."""
    env = os.environ.get(name.upper())
    if env:
        return env
    if name == "ffmpeg":
        got = subprocess.run(
            [sys.executable, "-c",
             "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"],
            capture_output=True, text=True).stdout.strip()
        if got:
            return got
    return name


FFMPEG = _tool("ffmpeg")


def probe(src: Path) -> dict:
    """Validate the source is a real, playable video. Returns {duration, w, h}.

    Uses ffmpeg (not ffprobe) so the tool needs nothing beyond the ffmpeg that
    imageio-ffmpeg already provides: `ffmpeg -i FILE` prints stream metadata to
    stderr, which we parse."""
    r = subprocess.run([FFMPEG, "-hide_banner", "-i", str(src)],
                       capture_output=True, text=True)
    err = r.stderr
    vmatch = re.search(r"Stream #\d+:\d+.*: Video: .*?, (\d+)x(\d+)", err)
    if vmatch is None:
        raise ValueError(f"no readable video stream in {src.name}")
    dmatch = re.search(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)", err)
    dur = 0.0
    if dmatch:
        h, m, s = dmatch.groups()
        dur = int(h) * 3600 + int(m) * 60 + float(s)
    if dur <= 0:
        raise ValueError(f"zero-length or unreadable video: {src.name}")
    return {"duration": dur, "width": int(vmatch.group(1)),
            "height": int(vmatch.group(2))}


def _vf(fit: str) -> str:
    """Scale/crop or scale/pad the source into a 1080x1920 portrait frame."""
    if fit == "contain":
        return ("scale=1080:1920:force_original_aspect_ratio=decrease,"
                "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1")
    return ("scale=1080:1920:force_original_aspect_ratio=increase,"
            "crop=1080:1920,setsar=1")


def ingest_one(src: Path, slug: str, episode: int, *, media_dir: Path,
               fit: str = "cover", encrypt: bool = False, force: bool = False) -> dict:
    slug, episode = check_job(slug, episode)
    out = media_dir / slug / f"e{episode:03d}"
    if not out.resolve().is_relative_to(media_dir.resolve()):
        raise ValueError(f"refusing to write outside {media_dir}: {out}")
    master = out / "hls" / "master.m3u8"
    if master.exists() and not force:
        return {"slug": slug, "episode": episode, "status": "skipped (exists)"}

    info = probe(src)
    for name, _, _, _ in LADDER:
        (out / "hls" / name).mkdir(parents=True, exist_ok=True)

    # 1) normalized mezzanine — the 'master' the architecture stores in the origin.
    mezz = out / "source.mp4"
    subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
         "-vf", _vf(fit), "-c:v", "libx264", "-preset", "medium", "-crf", "20",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
         str(mezz)], check=True)

    # 2) HLS ladder from the mezzanine (identical shape to the placeholder output).
    n = len(LADDER)
    split = f"[0:v]split={n}" + "".join(f"[v{i}in]" for i in range(n)) + ";"
    scales = ";".join(
        f"[v{i}in]scale={w}:{h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h}[v{i}]" for i, (_, w, h, _) in enumerate(LADDER))
    cmd = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(mezz),
           "-filter_complex", split + scales]
    for i in range(n):
        cmd += ["-map", f"[v{i}]", "-map", "0:a"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-g", "48",
            "-keyint_min", "48", "-sc_threshold", "0"]
    for i, (_, _, _, rate) in enumerate(LADDER):
        cmd += [f"-maxrate:v:{i}", f"{rate}k", f"-bufsize:v:{i}", f"{rate * 3 // 2}k"]
    cmd += ["-c:a", "aac", "-b:a", "128k",
            "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod",
            "-master_pl_name", "master.m3u8",
            "-var_stream_map", " ".join(f"v:{i},a:{i}" for i in range(n))]
    if encrypt:
        keyinfo = _write_hls_key(out)
        cmd += ["-hls_key_info_file", str(keyinfo)]
    cmd += ["-hls_segment_filename", str(out / "hls" / "%v" / "seg_%04d.ts"),
            str(out / "hls" / "%v" / "index.m3u8")]
    subprocess.run(cmd, check=True)

    return {"slug": slug, "episode": episode, "status": "ok",
            "duration": round(info["duration"], 1), "encrypted": encrypt}


def _write_hls_key(out: Path) -> Path:
    """Generate an AES-128 key + key-info file for HLS encryption. The key URI
    points at a placeholder the app must serve behind entitlement (key delivery
    is the integration step — see the printed TODO)."""
    import secrets
    keydir = out / "hls"
    key = keydir / "enc.key"
    key.write_bytes(secrets.token_bytes(16))
    iv = secrets.token_hex(16)
    keyinfo = keydir / "enc.keyinfo"
    # URI the player fetches · local key path for packaging · IV
    keyinfo.write_text(f"key/{out.parent.name}/{out.name}\n{key}\n{iv}\n")
    return keyinfo


def _load_jobs(args) -> list[tuple[Path, str, int]]:
    jobs: list[tuple[Path, str, int]] = []
    if args.file:
        if not (args.slug and args.episode):
            sys.exit("--file requires --slug and --episode")
        jobs.append((Path(args.file), *check_job(args.slug, args.episode)))
    elif args.map:
        for row in json.loads(Path(args.map).read_text()):
            jobs.append((Path(row["file"]), *check_job(row.get("slug"), row.get("episode"))))
    elif args.source_dir:
        pat = re.compile(r"^(?P<slug>[a-z0-9-]+)_e(?P<ep>\d{1,3})\.(mp4|mov|m4v)$", re.I)
        for f in sorted(Path(args.source_dir).iterdir()):
            m = pat.match(f.name)
            if m:
                jobs.append((f, m["slug"], int(m["ep"])))
        if not jobs:
            sys.exit("no files matched {slug}_e{NN}.mp4 in --source-dir")
    else:
        sys.exit("give one of --file / --map / --source-dir (see --help)")
    return jobs


def main() -> None:
    ap = argparse.ArgumentParser(description="Ingest real clips into Katha HLS.")
    ap.add_argument("--file")
    ap.add_argument("--slug")
    ap.add_argument("--episode")
    ap.add_argument("--map")
    ap.add_argument("--source-dir")
    ap.add_argument("--fit", choices=["cover", "contain"], default="cover")
    ap.add_argument("--encrypt", action="store_true")
    ap.add_argument("--media-dir", default=str(DEFAULT_MEDIA))
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    media_dir = Path(args.media_dir)
    jobs = _load_jobs(args)
    results = []
    for src, slug, ep in jobs:
        if not src.is_file():
            results.append({"slug": slug, "episode": ep, "status": f"missing: {src}"})
            print(f"  ✗ {slug} e{ep:03d} — missing {src}", file=sys.stderr)
            continue
        try:
            r = ingest_one(src, slug, ep, media_dir=media_dir, fit=args.fit,
                           encrypt=args.encrypt, force=args.force)
            results.append(r)
            print(f"  ✓ {slug} e{ep:03d} — {r['status']}")
        except (ValueError, subprocess.CalledProcessError) as e:
            results.append({"slug": slug, "episode": ep, "status": f"error: {e}"})
            print(f"  ✗ {slug} e{ep:03d} — {e}", file=sys.stderr)

    ok = sum(1 for r in results if r["status"] in ("ok", "skipped (exists)"))
    print(f"\ningested {ok}/{len(results)} episode(s) → {media_dir}")
    if args.encrypt:
        print("NOTE: --encrypt wrote AES-128 keys. Serve them behind entitlement: "
              "add a GET /media/key/{slug}/{ep} route that checks the same stream "
              "token before returning enc.key. Until then encrypted HLS won't play.")
    if any(r["status"].startswith("error") or r["status"].startswith("missing")
           for r in results):
        sys.exit(1)


if __name__ == "__main__":
    main()
