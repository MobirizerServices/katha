#!/usr/bin/env python3
"""Generate placeholder dev videos + HLS ladders for docs/katha-catalog.json.

The catalogue is Katha's OWNED slate (tools/build_katha_catalog.py), so these
assets are safe to show in demos. Cover art comes from tools/generate_covers.py.

Output layout (mirrors the SAD §6.5 media layout, locally):
  media/{series_slug}/e{NNN}/source.mp4          mezzanine, 1080x1920
  media/{series_slug}/e{NNN}/hls/master.m3u8     4-rendition ladder, 2s segments
  media/{series_slug}/e{NNN}/hls/{1080p,720p,540p,360p}/...
  media/manifest.json                            paths + durations for seeding the API

Idempotent: episodes whose master.m3u8 already exists are skipped, so an
interrupted run can simply be restarted. Serve locally with:
  cd media && python3 -m http.server 8788
"""
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = Path(os.environ.get("KATHA_CATALOG", ROOT / "docs" / "katha-catalog.json"))
# Demo builds only ever play the free run and the first paid episodes, so
# generating all 786 would burn ~1.1 GB for nothing. Override with --all or
# KATHA_MAX_EPISODES=N.
MAX_EPISODES = int(os.environ.get("KATHA_MAX_EPISODES", "12"))
MEDIA = ROOT / "media"
FONT = "/System/Library/Fonts/Helvetica.ttc"

FFMPEG = os.environ.get("FFMPEG") or subprocess.run(
    [sys.executable, "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"],
    capture_output=True, text=True,
).stdout.strip() or "ffmpeg"

LADDER = [  # (name, w, h, maxrate_k)
    ("1080p", 1080, 1920, 6000),
    ("720p", 720, 1280, 2500),
    ("540p", 540, 960, 1400),
    ("360p", 360, 640, 700),
]


def episode_duration(ep: dict) -> int:
    """Deterministic 12-18s per episode. Bump to 60-120 for full-length assets.

    The E10 cliff runs 6s long on purpose: Content Bible 3.3 gives the turn air,
    and the paused frame under the paywall sheet is the sales asset.
    """
    return 12 + (ep["number"] % 7) + (6 if ep.get("is_cliff") else 0)


def build_episode(color, slug, title, ep):
    n, dur = ep["number"], episode_duration(ep)
    out = MEDIA / slug / f"e{n:03d}"
    if (out / "hls" / "master.m3u8").exists():
        return (slug, n, dur, "skipped")
    out.mkdir(parents=True, exist_ok=True)
    for name, *_ in LADDER:
        (out / "hls" / name).mkdir(parents=True, exist_ok=True)

    badge = "FREE" if ep["is_free"] else f"LOCKED - {ep['coin_price']} COINS"
    badge_color = "0x2FBF71" if ep["is_free"] else "0xF5C042"

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as tf:
        label = ep.get("title") or f"Episode {n}"
        tf.write(f"KATHA DEV BUILD\n\n{title}\n\nE{n} - {label}")
        titlefile = tf.name

    vf = (
        f"drawtext=fontfile={FONT}:textfile={titlefile}:fontcolor=white:fontsize=56:"
        f"line_spacing=18:x=(w-text_w)/2:y=560:borderw=3:bordercolor=black,"
        f"drawtext=fontfile={FONT}:text='{badge}':fontcolor={badge_color}:fontsize=44:"
        f"x=(w-text_w)/2:y=200:borderw=2:bordercolor=black,"
        f"drawtext=fontfile={FONT}:text='%{{pts\\:hms}}':fontcolor=white:fontsize=40:"
        f"x=(w-text_w)/2:y=h-240:borderw=2:bordercolor=black,"
        f"drawtext=fontfile={FONT}:text='TO BE CONTINUED...':fontcolor=yellow:fontsize=64:"
        f"x=(w-text_w)/2:y=1080:borderw=3:bordercolor=black:enable='gte(t,{dur - 3})'"
    )

    src = out / "source.mp4"
    mezz = [
        FFMPEG, "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", f"color=c={color}:s=1080x1920:r=30:d={dur}",
        "-f", "lavfi", "-t", str(dur), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", str(src),
    ]
    subprocess.run(mezz, check=True)
    os.unlink(titlefile)

    split = f"[0:v]split={len(LADDER)}" + "".join(f"[s{i}]" for i in range(len(LADDER))) + ";"
    split += ";".join(f"[s{i}]scale={w}:{h}[v{i}]" for i, (_, w, h, _) in enumerate(LADDER))
    hls = [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", "-i", str(src),
           "-filter_complex", split]
    for i in range(len(LADDER)):
        hls += ["-map", f"[v{i}]", "-map", "0:a"]
    hls += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-force_key_frames", "expr:gte(t,n_forced*2)", "-pix_fmt", "yuv420p"]
    for i, (_, _, _, rate) in enumerate(LADDER):
        hls += [f"-maxrate:v:{i}", f"{rate}k", f"-bufsize:v:{i}", f"{rate * 3 // 2}k"]
    hls += ["-c:a", "aac", "-b:a", "128k",
            "-f", "hls", "-hls_time", "2", "-hls_playlist_type", "vod",
            "-master_pl_name", "master.m3u8",
            "-var_stream_map", " ".join(f"v:{i},a:{i},name:{n}" for i, (n, *_) in enumerate(LADDER)),
            "-hls_segment_filename", str(out / "hls" / "%v" / "seg_%04d.ts"),
            str(out / "hls" / "%v" / "index.m3u8")]
    subprocess.run(hls, check=True)
    return (slug, n, dur, "ok")


def main():
    catalog = json.loads(CATALOG.read_text())
    cap = None if "--all" in sys.argv else MAX_EPISODES
    jobs = []
    for s in catalog["series"]:
        eps = s["episodes"] if cap is None else s["episodes"][:cap]
        for ep in eps:
            jobs.append((s.get("cover_hue", "0x1B2A4A"), s["slug"], s["title"], ep))

    print(f"{len(jobs)} episodes to generate -> {MEDIA}", flush=True)
    done = failed = 0
    with ProcessPoolExecutor(max_workers=3) as ex:
        futures = [ex.submit(build_episode, *j) for j in jobs]
        for f in as_completed(futures):
            try:
                slug, n, dur, status = f.result()
                done += 1
                if done % 25 == 0 or done == len(jobs):
                    print(f"  {done}/{len(jobs)} done", flush=True)
            except Exception as e:
                failed += 1
                print(f"  FAILED: {e}", flush=True)

    manifest = {
        "base_note": "Serve with: cd media && python3 -m http.server 8788",
        "catalogue": str(CATALOG.relative_to(ROOT)),
        "episodes_generated_per_series": cap or "all",
        "series": [],
    }
    for s in catalog["series"]:
        gen = s["episodes"] if cap is None else s["episodes"][:cap]
        eps = [{
            "number": ep["number"],
            "title": ep.get("title") or f"Episode {ep['number']}",
            "is_free": ep["is_free"],
            "coin_price": ep["coin_price"],
            "is_cliff": ep.get("is_cliff", False),
            "duration_ms": episode_duration(ep) * 1000,
            "source": f"{s['slug']}/e{ep['number']:03d}/source.mp4",
            "hls_master": f"{s['slug']}/e{ep['number']:03d}/hls/master.m3u8",
        } for ep in gen]
        manifest["series"].append({
            "slug": s["slug"],
            "title": s["title"],
            "tagline": s.get("tagline"),
            "language": s["primary_language"],
            "genres": s["genres"],
            "content_rating": s["content_rating"],
            "episode_count": s["episode_count"],
            "episodes_available": len(eps),
            "cover_9x16": f"{s['slug']}/cover_9x16.jpg",
            "cover_16x9": f"{s['slug']}/cover_16x9.jpg",
            "episodes": eps,
        })
    (MEDIA / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Done: {done} ok, {failed} failed. Manifest at media/manifest.json", flush=True)


if __name__ == "__main__":
    main()
