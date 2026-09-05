#!/usr/bin/env python3
"""Generate a Katha episode from a beat sheet — original content only.

The pipeline mirrors how the episode would actually be shot, which is what keeps
the same faces on screen for a minute:

  1. cast     one reference still per character, generated once and reused, so
              Meera is the same Meera in every shot.
  2. frames   one key frame per shot, conditioned on the cast stills, so framing
              AND faces are locked before a single second of video is bought.
  3. shots    each key frame animated into a clip by a video model.
  4. voice    dialogue lines spoken by ElevenLabs (skipped when the video model
              generates its own audio, e.g. Veo).
  5. assemble concatenate, lay the dialogue over the right shot, add an end card
              rendered locally, and write one portrait mp4.

Every stage is resumable: an artifact that already exists is never regenerated,
so a failure or a rate limit costs only the shots that had not finished.
The output is `{slug}_e{NN}.mp4`, exactly what tools/ingest_media.py consumes.

    python3 tools/generate_episode.py --beats tools/beats/kaanch-ka-mahal_e01.json --dry-run
    python3 tools/generate_episode.py --beats tools/beats/kaanch-ka-mahal_e01.json
    python3 tools/ingest_media.py --source-dir media/_gen/out

Backends (--video / --image), chosen by which account is funded:
    video: fal-hailuo (default, cheapest) | fal-kling | fal-wan | veo
    image: openai (default) | fal-flux | gemini

Only the project's own scripts and characters are ever sent to a model; no
third-party footage, likeness or script enters this pipeline (see the content
rules in docs/Katha_Content_Bible_v0.1.md).
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "media" / "_gen"

VIDEO_BACKENDS = {
    # name          endpoint                                              $/s    allowed durations
    "fal-hailuo": ("fal-ai/minimax/hailuo-02/standard/image-to-video", 0.045, (6, 10)),
    "fal-kling":  ("fal-ai/kling-video/v2.1/standard/image-to-video",  0.110, (5, 10)),
    "fal-wan":    ("fal-ai/wan/v2.2-a14b/image-to-video",              0.050, (5,)),
    "veo":        ("veo-3.1-fast-generate-preview",                    0.150, (4, 6, 8)),
}
NEGATIVE = ("on-screen text, subtitles, captions, watermark, logo, brand names, "
            "distorted hands, extra fingers, deformed face, warped features, "
            "cartoon, anime, illustration, plastic skin")
# ElevenLabs cannot list voices with a write-scoped key, so the voice per
# character is named here. Override with KATHA_VOICE_<CHARACTER>.
# All are stock premade voices (public ids, no library permission needed) driven
# through eleven_multilingual_v2, which speaks Hindi.
VOICES = {
    "meera":    "EXAVITQu4vr4xnSDxMaL",   # Sarah   — young, soft
    "sushila":  "XrExE9yKIg1WjnnlVkGX",   # Matilda — mature, warm-over-steel
    "kabir":    "JBFqnCBsd6RMkjVDRZzb",   # George  — warm male
    "arun":     "pNInz6obpgDQGcFmaJgB",   # Adam    — deep male
    "devendra": "pqHfZKP75CvOlQylNhV4",   # Bill    — older male
    "nisha":    "FGY2WhTYpPnrIDTdsKH5",   # Laura   — female, distinct from Meera
    "default":  "pNInz6obpgDQGcFmaJgB",
}
# Lip-sync backends: (endpoint, billing unit, rate, extra body fields).
# latentsync is the cheap one and the softest; Sync Labs' lipsync-2 is the
# quality option and barely dearer at these clip lengths.
LIPSYNC_BACKENDS = {
    "latentsync": ("fal-ai/latentsync",      "clip", 0.20,  {}),
    "sync2":      ("fal-ai/sync-lipsync/v2", "sec",  0.050, {"model": "lipsync-2"}),
    "sync2-pro":  ("fal-ai/sync-lipsync/v2", "sec",  0.083, {"model": "lipsync-2-pro"}),
}
VOICE_LEAD_S = 0.9          # beat of room tone before a line starts


def env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        sys.exit(f"set {name}")
    return v


def _req(url: str, *, data: bytes | None = None, headers: dict, timeout: int = 300) -> bytes:
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code} {url.rsplit('/', 2)[-1]}: {e.read().decode()[:500]}") from None


def jpost(url: str, body: dict, headers: dict, timeout: int = 300) -> dict:
    return json.loads(_req(url, data=json.dumps(body).encode(),
                           headers={**headers, "Content-Type": "application/json"},
                           timeout=timeout))


def jget(url: str, headers: dict, timeout: int = 120) -> dict:
    return json.loads(_req(url, headers=headers, timeout=timeout))


def data_uri(p: Path) -> str:
    mime = mimetypes.guess_type(p.name)[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"


def retry(label: str, fn, tries: int = 3, wait: int = 6):
    for attempt in range(1, tries + 1):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - any transient API failure
            print(f"    ! {label} attempt {attempt}/{tries}: {str(e)[:170]}")
            if attempt == tries:
                raise
            time.sleep(wait * attempt)


# ---------------------------------------------------------------- images ----

def _multipart(fields: dict[str, str], files: list[tuple[str, Path]]) -> tuple[bytes, str]:
    b = f"----katha{uuid.uuid4().hex}"
    out = bytearray()
    for k, v in fields.items():
        out += f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
    for k, p in files:
        mime = mimetypes.guess_type(p.name)[0] or "image/png"
        out += (f"--{b}\r\nContent-Disposition: form-data; name=\"{k}\"; "
                f"filename=\"{p.name}\"\r\nContent-Type: {mime}\r\n\r\n").encode()
        out += p.read_bytes() + b"\r\n"
    out += f"--{b}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={b}"


def image_openai(prompt: str, refs: list[Path], dest: Path) -> None:
    """gpt-image-1. With references it uses the edits endpoint, which is what
    carries a face from the cast sheet into every shot."""
    hdr = {"Authorization": f"Bearer {env('OPENAI_API_KEY')}"}
    if refs:
        body, ctype = _multipart(
            {"model": "gpt-image-1", "prompt": prompt, "size": "1024x1536",
             "input_fidelity": "high", "n": "1"},
            [("image[]", r) for r in refs])
        raw = _req("https://api.openai.com/v1/images/edits", data=body,
                   headers={**hdr, "Content-Type": ctype}, timeout=600)
        out = json.loads(raw)
    else:
        out = jpost("https://api.openai.com/v1/images/generations",
                    {"model": "gpt-image-1", "prompt": prompt,
                     "size": "1024x1536", "n": 1}, hdr, timeout=600)
    dest.write_bytes(base64.b64decode(out["data"][0]["b64_json"]))


def image_fal_flux(prompt: str, refs: list[Path], dest: Path) -> None:
    hdr = {"Authorization": f"Key {env('FAL_KEY')}"}
    model = "fal-ai/flux-pro/kontext" if refs else "fal-ai/flux/dev"
    body: dict = {"prompt": prompt, "image_size": "portrait_16_9", "num_images": 1}
    if refs:
        body["image_url"] = data_uri(refs[0])
    out = jpost(f"https://fal.run/{model}", body, hdr, timeout=600)
    dest.write_bytes(_req(out["images"][0]["url"], headers={}, timeout=300))


def image_gemini(prompt: str, refs: list[Path], dest: Path) -> None:
    parts: list[dict] = [{"text": prompt}]
    for r in refs:
        parts.append({"inline_data": {"mime_type": "image/png",
                                      "data": base64.b64encode(r.read_bytes()).decode()}})
    out = jpost("https://generativelanguage.googleapis.com/v1beta/models/"
                "gemini-3-pro-image:generateContent",
                {"contents": [{"parts": parts}],
                 "generationConfig": {"responseModalities": ["IMAGE"],
                                      "imageConfig": {"aspectRatio": "9:16"}}},
                {"x-goog-api-key": env("GEMINI_API_KEY")}, timeout=600)
    for p in out["candidates"][0]["content"]["parts"]:
        blob = p.get("inlineData") or p.get("inline_data")
        if blob:
            dest.write_bytes(base64.b64decode(blob["data"]))
            return
    raise RuntimeError("no image in response")


IMAGE_BACKENDS = {"openai": image_openai, "fal-flux": image_fal_flux, "gemini": image_gemini}


def to_9x16(p: Path) -> Path:
    """Crop a still to a true 9:16. The image models return 2:3 portraits; the
    video model inherits whatever it is given, so cropping HERE means the shot
    is composed for the frame the app actually plays, instead of losing the
    sides at assembly."""
    import subprocess as sp
    exe = ffmpeg()
    probe = sp.run([exe, "-i", str(p)], capture_output=True, text=True).stderr
    m = re.search(r", (\d{3,5})x(\d{3,5})", probe)
    if not m:
        return p
    w, h = int(m.group(1)), int(m.group(2))
    want = round(h * 9 / 16)
    if abs(w - want) <= 2:
        return p
    tmp = p.with_suffix(".crop.png")
    run([exe, "-y", "-hide_banner", "-loglevel", "error", "-i", str(p),
         "-vf", f"crop={want}:{h}:{(w - want) // 2}:0", str(tmp)])
    tmp.replace(p)
    return p


def gen_image(backend: str, prompt: str, refs: list[Path], dest: Path) -> Path:
    if dest.exists():
        print(f"    · {dest.name} (cached)")
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    retry(dest.name, lambda: IMAGE_BACKENDS[backend](prompt, refs, dest))
    to_9x16(dest)
    print(f"    ✓ {dest.name} ({dest.stat().st_size // 1024} KB)")
    return dest


# ----------------------------------------------------------------- video ----

def video_fal(model: str, prompt: str, frame: Path, seconds: int, dest: Path) -> None:
    """Submit to fal's queue, poll, then fetch the mp4."""
    hdr = {"Authorization": f"Key {env('FAL_KEY')}"}
    body: dict = {"prompt": prompt, "image_url": data_uri(frame), "duration": str(seconds)}
    if "hailuo" in model:
        body["resolution"] = "768P"
    if "kling" in model or "wan" in model:
        body["negative_prompt"] = NEGATIVE
    sub = jpost(f"https://queue.fal.run/{model}", body, hdr, timeout=180)
    rid, base = sub["request_id"], model.split("/")[0] + "/" + model.split("/")[1]
    status_url = f"https://queue.fal.run/{base}/requests/{rid}/status"
    result_url = f"https://queue.fal.run/{base}/requests/{rid}"
    waited = 0
    while True:
        time.sleep(10)
        waited += 10
        st = jget(status_url, hdr)
        if st.get("status") == "COMPLETED":
            break
        if st.get("status") == "FAILED":
            raise RuntimeError(f"fal reported FAILED: {str(st)[:300]}")
        if waited > 1200:
            raise RuntimeError("timed out after 20 min")
        if waited % 60 == 0:
            print(f"      … {waited}s ({st.get('status', '?')})")
    res = jget(result_url, hdr)
    url = (res.get("video") or {}).get("url") or res.get("url")
    if not url:
        raise RuntimeError(f"no video url: {str(res)[:300]}")
    dest.write_bytes(_req(url, headers={}, timeout=900))
    print(f"    ✓ {dest.name} ({dest.stat().st_size // 1024} KB, {waited}s)")


def video_veo(model: str, prompt: str, frame: Path, seconds: int, dest: Path) -> None:
    api = "https://generativelanguage.googleapis.com/v1beta"
    hdr = {"x-goog-api-key": env("GEMINI_API_KEY")}
    op = jpost(f"{api}/models/{model}:predictLongRunning", {
        "instances": [{"prompt": prompt, "image": {"inlineData": {
            "mimeType": "image/png",
            "data": base64.b64encode(frame.read_bytes()).decode()}}}],
        "parameters": {"aspectRatio": "9:16", "resolution": "1080p",
                       "durationSeconds": str(seconds),
                       "personGeneration": "allow_adult",
                       "negativePrompt": NEGATIVE}}, hdr, timeout=180)
    waited = 0
    while True:
        time.sleep(10)
        waited += 10
        st = jget(f"{api}/{op['name']}", hdr)
        if st.get("done"):
            break
        if waited > 900:
            raise RuntimeError("timed out after 15 min")
    if "error" in st:
        raise RuntimeError(str(st["error"])[:300])
    s = (st["response"].get("generateVideoResponse", {}).get("generatedSamples")
         or st["response"].get("generatedSamples"))
    uri = (s[0].get("video") or {}).get("uri") or s[0].get("uri")
    dest.write_bytes(_req(uri, headers=hdr, timeout=900))
    print(f"    ✓ {dest.name} ({dest.stat().st_size // 1024} KB, {waited}s)")


def gen_video(backend: str, prompt: str, frame: Path, seconds: int, dest: Path) -> Path:
    if dest.exists():
        print(f"    · {dest.name} (cached)")
        return dest
    model = VIDEO_BACKENDS[backend][0]
    dest.parent.mkdir(parents=True, exist_ok=True)
    fn = video_veo if backend == "veo" else video_fal
    retry(dest.name, lambda: fn(model, prompt, frame, seconds, dest), tries=2, wait=20)
    return dest


# ----------------------------------------------------------------- voice ----

def gen_ambience(description: str, seconds: int, dest: Path) -> Path | None:
    """A bed of room tone / effects for one shot, from the beat sheet's own audio
    note. The video models return silent clips, so without this the episode plays
    as a silent film."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    brief = re.sub(r"\s+", " ", description.replace("No dialogue, no music.", "")
                   .replace("No dialogue.", "").replace("No music.", "")).strip()

    def call() -> None:
        raw = _req("https://api.elevenlabs.io/v1/sound-generation",
                   data=json.dumps({"text": brief,
                                    "duration_seconds": min(22, max(1, seconds)),
                                    "prompt_influence": 0.4}).encode(),
                   headers={"xi-api-key": env("ELEVENLABS_API_KEY"),
                            "Content-Type": "application/json"}, timeout=240)
        dest.write_bytes(raw)
    try:
        retry(dest.name, call, tries=2)
    except Exception as e:  # noqa: BLE001 - ambience is a nice-to-have, never fatal
        print(f"    ! ambience unavailable ({str(e)[:90]}) — shot stays silent")
        return None
    print(f"    ✓ {dest.name} ({dest.stat().st_size // 1024} KB)")
    return dest


def gen_voice(text: str, character: str, dest: Path) -> Path:
    if dest.exists():
        print(f"    · {dest.name} (cached)")
        return dest
    voice = os.environ.get(f"KATHA_VOICE_{character.upper()}",
                           VOICES.get(character, VOICES["default"]))
    dest.parent.mkdir(parents=True, exist_ok=True)

    def call() -> None:
        raw = _req(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
                   data=json.dumps({"text": text, "model_id": "eleven_multilingual_v2",
                                    "voice_settings": {"stability": 0.5,
                                                       "similarity_boost": 0.75}}).encode(),
                   headers={"xi-api-key": env("ELEVENLABS_API_KEY"),
                            "Content-Type": "application/json"}, timeout=180)
        dest.write_bytes(raw)
    retry(dest.name, call)
    print(f"    ✓ {dest.name} ({dest.stat().st_size // 1024} KB)")
    return dest


def fal_upload(p: Path, content_type: str) -> str:
    """Put a local file on fal's CDN and return its public URL. The lip-sync
    models take URLs, not inline data, and a base64 mp4 is far too big to post."""
    j = jpost("https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
              {"content_type": content_type, "file_name": p.name},
              {"Authorization": f"Key {env('FAL_KEY')}"})
    req = urllib.request.Request(j["upload_url"], data=p.read_bytes(),
                                 headers={"Content-Type": content_type}, method="PUT")
    with urllib.request.urlopen(req, timeout=900):
        pass
    return j["file_url"]


def pad_voice(voice: Path, seconds: int, dest: Path, lead: float = VOICE_LEAD_S) -> Path:
    """A dialogue track exactly as long as the shot, with the line starting after
    a beat of silence.

    Two jobs at once. The lip-sync model trims its output to the length of the
    audio it is given, so a 3s line against a 6s clip would throw half the shot
    away; padding to the full duration keeps the picture intact. And because the
    delay is baked in here, the mouth moves at the same instant the mixed line is
    heard — a later adelay in the mix would slide the two apart."""
    if dest.exists():
        return dest
    run([ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
         "-i", str(voice), "-f", "lavfi", "-t", str(seconds), "-i", "anullsrc=r=44100:cl=stereo",
         "-filter_complex",
         f"[0:a]aresample=44100,adelay={int(lead * 1000)}|{int(lead * 1000)}[v];"
         f"[1:a][v]amix=inputs=2:duration=first:dropout_transition=0,"
         f"atrim=0:{seconds},asetpts=N/SR/TB[a]",
         "-map", "[a]", "-c:a", "libmp3lame", "-q:a", "2", str(dest)])
    return dest


def lipsync(clip: Path, voice: Path, dest: Path, backend: str = "sync2") -> Path:
    """Move the character's mouth to the generated line.

    Without this the actor stares while a voice plays over the top, which is what
    made the first pilot read as a slideshow — the video models keep the mouth
    shut however plainly the motion prompt says "she speaks". Never fatal: if the
    model fails or finds no face, the shot falls back to the un-synced take.

    The model only repaints the face it can find, so a wide shot yields a mouth a
    few pixels across and the sync reads as mush. Frame dialogue tight."""
    if dest.exists():
        print(f"    · {dest.name} (cached)")
        return dest
    endpoint, _, _, extra = LIPSYNC_BACKENDS[backend]
    hdr = {"Authorization": f"Key {env('FAL_KEY')}"}

    def call() -> None:
        body = {"video_url": fal_upload(clip, "video/mp4"),
                "audio_url": fal_upload(voice, "audio/mpeg"), **extra}
        sub = jpost(f"https://queue.fal.run/{endpoint}", body, hdr, timeout=180)
        rid = sub["request_id"]
        base = "/".join(endpoint.split("/")[:2])
        waited = 0
        while True:
            time.sleep(10)
            waited += 10
            st = jget(f"https://queue.fal.run/{base}/requests/{rid}/status", hdr)
            if st.get("status") == "COMPLETED":
                break
            if st.get("status") == "FAILED":
                raise RuntimeError(f"lipsync FAILED: {str(st)[:250]}")
            if waited > 900:
                raise RuntimeError("lipsync timed out")
        res = jget(f"https://queue.fal.run/{base}/requests/{rid}", hdr)
        url = (res.get("video") or {}).get("url")
        if not url:
            raise RuntimeError(f"lipsync gave no url: {str(res)[:250]}")
        dest.write_bytes(_req(url, headers={}, timeout=900))
        print(f"    ✓ {dest.name} lip-synced ({waited}s)")

    try:
        retry(dest.name, call, tries=2)
    except Exception as e:  # noqa: BLE001 - a stiff mouth beats a missing shot
        print(f"    ! lip-sync unavailable ({str(e)[:90]}) — using un-synced take")
        return clip
    return dest


# -------------------------------------------------------------- assembly ----

def ffmpeg() -> str:
    for c in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"):
        if Path(c).exists():
            return c
    if subprocess.run(["which", "ffmpeg"], capture_output=True).returncode == 0:
        return "ffmpeg"
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def run(cmd: list[str]) -> None:
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"ffmpeg failed: {r.stderr[-600:]}")


def devanagari_font() -> str | None:
    for p in ("/System/Library/Fonts/Supplemental/DevanagariMT.ttc",
              "/System/Library/Fonts/Kohinoor.ttc",
              "/Library/Fonts/Kohinoor.ttc"):
        if Path(p).exists():
            return p
    return None


def end_card(line_hi: str, line_en: str, seconds: int, dest: Path) -> Path:
    """Rendered locally: image models cannot be trusted with Devanagari, and the
    hook line has to be exactly what the writers wrote."""
    if dest.exists():
        print(f"    · {dest.name} (cached)")
        return dest
    font = devanagari_font()
    esc = lambda s: s.replace(":", r"\:").replace("'", r"\'")  # noqa: E731
    hi = (f"drawtext=text='{esc(line_hi)}':fontcolor=white:fontsize=62:"
          f"x=(w-text_w)/2:y=(h-text_h)/2-70" + (f":fontfile={font}" if font else ""))
    en = (f"drawtext=text='{esc(line_en)}':fontcolor=0xC9A227:fontsize=40:"
          f"x=(w-text_w)/2:y=(h-text_h)/2+50")
    run([ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", f"color=c=black:s=1080x1920:d={seconds}:r=24",
         "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=stereo:d={seconds}",
         "-vf", f"{hi},{en}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-shortest", str(dest)])
    print(f"    ✓ {dest.name}")
    return dest


def has_audio(p: Path) -> bool:
    out = subprocess.run([ffmpeg(), "-i", str(p)], capture_output=True, text=True).stderr
    return "Stream" in out and "Audio:" in out


def lay_audio(clip: Path, ambience: Path | None, voice: Path | None, dest: Path,
              voice_predelayed: bool = False) -> Path:
    """Give a shot its soundtrack. The video models hand back silent clips, so
    the bed is the generated ambience and the dialogue rides on top of it,
    ducking the bed while the line plays."""
    if dest.exists():
        return dest
    if not ambience and not voice:
        return clip
    inputs = ["-i", str(clip)]
    parts, mix = [], []
    idx = 1
    if ambience:
        inputs += ["-i", str(ambience)]
        parts.append(f"[{idx}:a]volume={0.34 if voice else 0.6}[amb]")
        mix.append("[amb]")
        idx += 1
    if voice:
        inputs += ["-i", str(voice)]
        # A padded track already carries its own lead-in and is frame-aligned to
        # the lip-sync; delaying it again would slide the voice off the mouth.
        delay = "" if voice_predelayed else "adelay=1100|1100,"
        parts.append(f"[{idx}:a]{delay}volume=1.7[vo]")
        mix.append("[vo]")
        idx += 1
    if len(mix) == 2:
        parts.append(f"{''.join(mix)}amix=inputs=2:duration=longest:"
                     "dropout_transition=0,dynaudnorm=p=0.7[a]")
    else:
        parts.append(f"{mix[0]}anull[a]")
    run([ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", *inputs,
         "-filter_complex", ";".join(parts),
         "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
         "-shortest", str(dest)])
    return dest


def normalise(src: Path, dest: Path) -> Path:
    """Every clip to one format before concat: models return different sizes,
    frame rates and timebases, and a stream-copy concat drifts the audio."""
    if dest.exists():
        return dest
    silent = not has_audio(src)
    cmd = [ffmpeg(), "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    if silent:
        # The concat demuxer needs identical stream layouts in every part, so a
        # silent clip gets a real (empty) track rather than no track at all.
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    # Map explicitly: default stream selection has picked "no audio" here.
    cmd += ["-map", "0:v:0", "-map", "1:a:0" if silent else "0:a:0"]
    cmd += ["-vf", "scale=1080:1920:force_original_aspect_ratio=increase,"
                   "crop=1080:1920,setsar=1,fps=24",
            "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
            "-af", "aresample=async=1:first_pts=0", "-shortest", str(dest)]
    run(cmd)
    return dest


def assemble(clips: list[Path], dest: Path) -> Path:
    lst = dest.parent / "concat.txt"
    lst.write_text("".join(f"file '{c.resolve()}'\n" for c in clips))
    run([ffmpeg(), "-y", "-hide_banner", "-loglevel", "error",
         "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy",
         "-movflags", "+faststart", str(dest)])
    return dest


def duration(p: Path) -> float:
    """Read the duration from ffmpeg itself — the bundled imageio build ships no
    ffprobe, and requiring one would make the tool fail on a clean machine."""
    err = subprocess.run([ffmpeg(), "-i", str(p)], capture_output=True, text=True).stderr
    m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", err)
    if not m:
        return 0.0
    h, mnt, sec = m.groups()
    return int(h) * 3600 + int(mnt) * 60 + float(sec)


# ------------------------------------------------------------------ main ----

def main() -> None:
    ap = argparse.ArgumentParser(description="Generate a Katha episode from a beat sheet.")
    ap.add_argument("--beats", required=True)
    ap.add_argument("--video", choices=list(VIDEO_BACKENDS), default="fal-hailuo")
    ap.add_argument("--image", choices=list(IMAGE_BACKENDS), default="openai")
    ap.add_argument("--stage", choices=["cast", "frames", "shots", "assemble", "all"], default="all")
    ap.add_argument("--only", help="comma-separated shot ids, e.g. s04,s08")
    ap.add_argument("--lipsync", choices=list(LIPSYNC_BACKENDS), default="sync2",
                    help="lip-sync model (default sync2: sharper than latentsync)")
    ap.add_argument("--no-lipsync", action="store_true",
                    help="skip the lip-sync pass (cheaper; mouths stay still)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    beats = json.loads(Path(args.beats).read_text())
    slug, ep = beats["slug"], int(beats["episode"])
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,39}", slug):
        sys.exit(f"invalid slug {slug!r}")
    work = GEN / f"{slug}_e{ep:02d}"
    for d in ("cast", "frames", "shots", "voice", "cut"):
        (work / d).mkdir(parents=True, exist_ok=True)
    (GEN / "out").mkdir(parents=True, exist_ok=True)

    model, usd, allowed = VIDEO_BACKENDS[args.video]
    native_audio = args.video == "veo"
    wanted = set(args.only.split(",")) if args.only else None
    shots = [s for s in beats["shots"] if not wanted or s["id"] in wanted]

    def secs(s: dict) -> int:
        want = int(s.get("duration", 8))
        return min(allowed, key=lambda a: (abs(a - want), a))

    total = sum(secs(s) for s in shots)
    n_img = len(beats["characters"]) + len(shots)
    n_lines = sum(1 for s in shots if s.get("dialogue"))
    n_sync = 0 if (native_audio or args.no_lipsync) else n_lines
    print(f"\n{beats['title']} — {slug} E{ep:02d}")
    print(f"  {len(shots)} shots · {total}s video + {beats['end_card']['seconds']}s end card")
    print(f"  video: {model} ({'native audio' if native_audio else 'silent + ElevenLabs'})")
    print(f"  image: {args.image}")
    print(f"  dialogue: {n_lines} lines, {n_sync} lip-synced via {args.lipsync}")
    _, unit, rate, _ = LIPSYNC_BACKENDS[args.lipsync]
    sync_secs = sum(secs(x) for x in shots if x.get("dialogue"))
    sync_usd = 0.0 if not n_sync else (n_sync * rate if unit == "clip" else sync_secs * rate)
    print(f"  estimate: ~${total * usd + n_img * 0.04 + sync_usd:.2f}"
          f" (lip-sync {args.lipsync}: ${sync_usd:.2f})\n")
    if args.dry_run:
        for s in shots:
            who = ",".join(s["characters"]) or "insert"
            print(f"  {s['id']} beat {s['beat']} {secs(s)}s [{who}]{' 🗣' if s.get('dialogue') else ''}")
        return

    look = beats["look"]

    print("  [1/5] casting")
    cast = {cid: gen_image(args.image, f"{c['ref_prompt']} Style: {look}.", [],
                           work / "cast" / f"{cid}.png")
            for cid, c in beats["characters"].items()}

    if args.stage == "cast":
        return

    print("  [2/5] key frames")
    frames = {}
    for s in shots:
        refs = [cast[c] for c in s["characters"] if c in cast]
        lead = ("Use the attached reference photograph(s) for the people: keep the same "
                "faces, hair and clothing, unmistakably the same person. " if refs else "")
        frames[s["id"]] = gen_image(
            args.image,
            f"{lead}{s['frame_prompt']} Style: {look}. Vertical 9:16 cinematic film still. "
            f"No text, captions or watermark anywhere in the image.",
            refs, work / "frames" / f"{s['id']}.png")
    if args.stage == "frames":
        return

    print("  [3/5] shots")
    made = []
    for s in shots:
        prompt = f"{s['motion']}"
        if native_audio:
            prompt += f" Audio: {s['audio']}"
            if s.get("dialogue"):
                prompt += (f" The character speaks exactly this line in Hindi, once, calmly: "
                           f"\"{s['dialogue']['hi']}\". No other speech.")
        print(f"    {s['id']} ({secs(s)}s)")
        made.append((s, gen_video(args.video, prompt, frames[s["id"]], secs(s),
                                  work / "shots" / f"{s['id']}.mp4")))
    if args.stage == "shots":
        return

    print("  [4/5] sound + lip-sync")
    final_clips = []
    for s, clip in made:
        if not native_audio:
            amb = gen_ambience(s.get("audio", ""), secs(s), work / "voice" / f"{s['id']}_amb.mp3")
            vo, padded = None, False
            if s.get("dialogue"):
                raw = gen_voice(s["dialogue"]["hi"], s["dialogue"]["speaker"],
                                work / "voice" / f"{s['id']}.mp3")
                spoken = duration(raw)
                if spoken + VOICE_LEAD_S > secs(s):
                    print(f"    ! {s['id']}: line runs {spoken:.1f}s in a {secs(s)}s shot — "
                          "it will be cut short; shorten the line or lengthen the shot")
                vo = pad_voice(raw, secs(s), work / "voice" / f"{s['id']}_pad.mp3")
                padded = True
                if not args.no_lipsync:
                    clip = lipsync(clip, vo, work / "shots" / f"{s['id']}_ls.mp4",
                                   args.lipsync)
            clip = lay_audio(clip, amb, vo, work / "cut" / f"{s['id']}_snd.mp4",
                             voice_predelayed=padded)
        final_clips.append(normalise(clip, work / "cut" / f"{s['id']}.mp4"))
    if not final_clips:
        sys.exit("no clips")

    print("  [5/5] assembly")
    ec = beats["end_card"]
    card = end_card(ec["line_hi"], ec["line_en"], int(ec["seconds"]), work / "cut" / "zz_end.mp4")
    final = GEN / "out" / f"{slug}_e{ep:02d}.mp4"
    assemble(final_clips + [card], final)
    print(f"\n  ✓ {final}")
    print(f"    {duration(final):.1f}s · {final.stat().st_size // 1024 // 1024} MB")
    print(f"    ingest: python3 tools/ingest_media.py --source-dir {GEN / 'out'}\n")


if __name__ == "__main__":
    main()
