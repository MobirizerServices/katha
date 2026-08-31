#!/usr/bin/env python3
"""Generate placeholder dev videos + HLS ladders for every episode in docs/seed-catalog.json.

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
CATALOG = ROOT / "docs" / "seed-catalog.json"
MEDIA = ROOT / "media"
FONT = "/System/Library/Fonts/Helvetica.ttc"

FFMPEG = os.environ.get("FFMPEG") or subprocess.run(
    [sys.executable, "-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"],
    capture_output=True, text=True,
).stdout.strip() or "ffmpeg"

# one distinct background per series so QA can tell them apart at a glance
SERIES_COLORS = ["0x1B2A4A", "0x3A1B4A", "0x4A1B1B", "0x1B4A2E", "0x4A3A1B", "0x2E2E3E"]

LADDER = [  # (name, w, h, maxrate_k)
    ("1080p", 1080, 1920, 6000),
    ("720p", 720, 1280, 2500),
    ("540p", 540, 960, 1400),
    ("360p", 360, 640, 700),
]


def episode_duration(ep_no: int) -> int:
    """Deterministic 12-18s per episode. Bump to 60-120 for full-length assets."""
    return 12 + (ep_no % 7)


def build_episode(series_idx, slug, title, ep):
    n, dur = ep["number"], episode_duration(ep["number"])
    out = MEDIA / slug / f"e{n:03d}"
    if (out / "hls" / "master.m3u8").exists():
        return (slug, n, dur, "skipped")
    out.mkdir(parents=True, exist_ok=True)
    for name, *_ in LADDER:
        (out / "hls" / name).mkdir(parents=True, exist_ok=True)

    color = SERIES_COLORS[series_idx % len(SERIES_COLORS)]
    badge = "FREE" if ep["is_free"] else f"LOCKED - {ep['coin_price']} COINS"
    badge_color = "0x2FBF71" if ep["is_free"] else "0xF5C042"

    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as tf:
        tf.write(f"KATHA DEV BUILD\n\n{title}\n\nEpisode {n}")
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
    jobs = []
    for idx, s in enumerate(catalog["series"]):
        for ep in s["episodes"]:
            jobs.append((idx, s["slug"], s["title"], ep))

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

    manifest = {"base_note": "Serve with: cd media && python3 -m http.server 8788", "series": []}
    for idx, s in enumerate(catalog["series"]):
        eps = [{
            "number": ep["number"],
            "is_free": ep["is_free"],
            "coin_price": ep["coin_price"],
            "duration_ms": episode_duration(ep["number"]) * 1000,
            "source": f"{s['slug']}/e{ep['number']:03d}/source.mp4",
            "hls_master": f"{s['slug']}/e{ep['number']:03d}/hls/master.m3u8",
        } for ep in s["episodes"]]
        manifest["series"].append({"slug": s["slug"], "title": s["title"], "episodes": eps})
    (MEDIA / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Done: {done} ok, {failed} failed. Manifest at media/manifest.json", flush=True)


if __name__ == "__main__":
    main()
