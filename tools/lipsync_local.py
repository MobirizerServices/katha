#!/usr/bin/env python3
"""Free, offline lip-sync: Wav2Lip for the mouth motion, then composite only the
lips back over the original frame.

Why not just use Wav2Lip's own output? It rebuilds the whole lower face at 96x96
and upscales it back, so on a tight close-up the skin goes waxy and the detail
dies. The mouth *motion* it produces is right; the resolution is not. So we keep
the original frame everywhere and take nothing from Wav2Lip but the lips.

Locating the lips has to be done properly, and two obvious approaches both fail:
differencing the two clips picks up the whole frame, because the Wav2Lip pass
re-encodes everything and every pixel differs a little; and temporal variance
picks the hairline, because camera drift moves high-contrast edges more than a
mouth does. What works is asking a face-landmark model for the actual lip
contour, per frame, and following it as the head moves.

Setup (one time, ~530 MB, no account and no API):

    uv venv --python 3.12 <ENV>
    uv pip install --python <ENV>/bin/python torch torchvision "numpy==1.26.4" \\
        "librosa==0.9.2" opencv-python-headless tqdm scipy numba \\
        "setuptools<81" "mediapipe==0.10.14"
    git clone --depth 1 https://github.com/Rudrabha/Wav2Lip.git <DIR>
    curl -L -o <DIR>/checkpoints/wav2lip_gan.pth \\
      https://huggingface.co/camenduru/Wav2Lip/resolve/main/checkpoints/wav2lip_gan.pth
    curl -L -o <DIR>/face_detection/detection/sfd/s3fd.pth \\
      https://huggingface.co/camenduru/Wav2Lip/resolve/main/face_detection/detection/sfd/s3fd.pth

Three pins matter. setuptools<81 still ships pkg_resources, which librosa 0.9
imports and which Python 3.12 no longer provides. mediapipe must be 0.10.x: 1.0
dropped the legacy solutions API and its tasks API aborts on macOS reaching for
a Metal service. And Wav2Lip's own source needs two edits for modern torch,
applied automatically by patch_wav2lip() below.

Then point the generator at it:

    export KATHA_WAV2LIP_DIR=<DIR> KATHA_WAV2LIP_PY=<ENV>/bin/python
    python3 tools/generate_episode.py --beats ... --lipsync local
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

# Outer lip ring of mediapipe's 468-point face mesh.
LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291,
        409, 270, 269, 267, 0, 37, 39, 40, 185]


def wav2lip_dir() -> Path:
    d = os.environ.get("KATHA_WAV2LIP_DIR")
    if not d:
        sys.exit("set KATHA_WAV2LIP_DIR (see the setup block in tools/lipsync_local.py)")
    return Path(d)


def wav2lip_python() -> str:
    return os.environ.get("KATHA_WAV2LIP_PY") or sys.executable


def patch_wav2lip(root: Path) -> None:
    """Make the 2020 source run on today's torch. Idempotent.

    Two breakages: torch >= 2.6 defaults torch.load to weights_only=True, which
    refuses these checkpoints; and the device is hardcoded to cuda/cpu with no
    way to ask for anything else."""
    inf = root / "inference.py"
    t = inf.read_text()
    if "W2L_DEVICE" not in t:
        t = t.replace("device = 'cuda' if torch.cuda.is_available() else 'cpu'",
                      "import os as _os\ndevice = _os.environ.get('W2L_DEVICE','cpu')")
        t = t.replace("if device == 'cuda':", "if device not in ('cpu',):")
        inf.write_text(t)
    for f in (inf, root / "face_detection/detection/sfd/sfd_detector.py"):
        t = f.read_text()
        new = re.sub(r"torch\.load\(([^)]*?)\)",
                     lambda m: (m.group(0) if "weights_only" in m.group(1)
                                else f"torch.load({m.group(1)}, weights_only=False)"), t)
        if new != t:
            f.write_text(new)
    api = root / "face_detection/api.py"
    t = api.read_text()
    if "if 'cuda' in device:" in t:
        api.write_text(t.replace("if 'cuda' in device:", "if device not in ('cpu',):"))


def blend_lips(src: Path, w2l: Path, dest: Path) -> bool:
    """Composite the lips out of `w2l` onto the untouched frames of `src`."""
    import cv2
    import numpy as np
    import mediapipe as mp

    a, b = cv2.VideoCapture(str(src)), cv2.VideoCapture(str(w2l))
    fps = a.get(cv2.CAP_PROP_FPS) or 24
    W = int(a.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(a.get(cv2.CAP_PROP_FRAME_HEIGHT))
    mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False, max_num_faces=1, refine_landmarks=True,
        min_detection_confidence=0.4, min_tracking_confidence=0.4)
    tmp = dest.with_suffix(".raw.mp4")
    vw = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"mp4v"), fps, (W, H))

    n = hit = 0
    last = None
    while True:
        ra, fa = a.read()
        rb, fb = b.read()
        if not (ra and rb):
            break
        if fb.shape[:2] != (H, W):          # Wav2Lip may have run at half size
            fb = cv2.resize(fb, (W, H))
        res = mesh.process(cv2.cvtColor(fa, cv2.COLOR_BGR2RGB))
        pts = None
        if res.multi_face_landmarks:
            f = res.multi_face_landmarks[0].landmark
            pts = np.array([[int(f[i].x * W), int(f[i].y * H)] for i in LIPS], np.int32)
            last, hit = pts, hit + 1
        elif last is not None:
            pts = last                      # brief dropout: hold the last contour
        if pts is None:
            vw.write(fa)
            n += 1
            continue
        hull = cv2.convexHull(pts)
        m = np.zeros((H, W), np.uint8)
        cv2.fillConvexPoly(m, hull, 255)
        # grow past the lip line and feather, so the seam falls on flat cheek
        r = max(9, int(0.42 * np.sqrt(cv2.contourArea(hull) + 1)))
        m = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r)))
        k = (max(9, r // 2 * 2 + 1),) * 2
        mask = (cv2.GaussianBlur(m, k, 0).astype(np.float32) / 255.0)[..., None]
        vw.write(np.clip(fa * (1 - mask) + fb * mask, 0, 255).astype(np.uint8))
        n += 1
    vw.release(); a.release(); b.release()
    if n == 0:
        tmp.unlink(missing_ok=True)
        return False
    tmp.replace(dest)
    print(f"    ✓ {dest.name} lips composited ({hit}/{n} frames located)")
    return True


def sync(clip: Path, voice: Path, dest: Path, ffmpeg: str) -> bool:
    """clip + spoken track -> same clip with the mouth moving. False if it fails."""
    root = wav2lip_dir()
    ckpt = root / "checkpoints/wav2lip_gan.pth"
    if not ckpt.exists():
        print(f"    ! no Wav2Lip checkpoint at {ckpt}")
        return False
    patch_wav2lip(root)
    work = dest.parent / f".{dest.stem}"
    work.mkdir(parents=True, exist_ok=True)
    wav, raw = work / "voice.wav", work / "w2l.mp4"

    subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", str(voice),
                    "-ar", "16000", "-ac", "1", str(wav)], check=True)
    # Half resolution: Wav2Lip synthesises the mouth at 96x96 whatever the input
    # size, so this costs no lip detail and runs about four times faster.
    env = {**os.environ, "W2L_DEVICE": os.environ.get("W2L_DEVICE", "cpu"),
           "PATH": f"{Path(ffmpeg).parent}:{os.environ.get('PATH', '')}"}
    r = subprocess.run([wav2lip_python(), "inference.py",
                        "--checkpoint_path", str(ckpt), "--face", str(clip),
                        "--audio", str(wav), "--outfile", str(raw),
                        "--nosmooth", "--resize_factor", "2"],
                       cwd=root, env=env, capture_output=True, text=True)
    if not raw.exists() or raw.stat().st_size == 0:
        print(f"    ! Wav2Lip failed: {(r.stderr or r.stdout)[-200:]}")
        return False
    return blend_lips(clip, raw, dest)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: lipsync_local.py <clip.mp4> <voice.mp3> <out.mp4>")
    import imageio_ffmpeg
    ok = sync(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]),
              imageio_ffmpeg.get_ffmpeg_exe())
    sys.exit(0 if ok else 1)
