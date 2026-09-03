# Real video for the demo — the copyright-clean way

Investors want the app to *feel* real, which means real human footage playing in
the real player. You get that without any rights exposure by feeding **licensed
or AI-generated** clips through the pipeline — never by scraping other apps or
YouTube (that's the exact liability the AI-content plan exists to avoid, and
it's a diligence red flag).

The app can't tell a licensed-stock clip from any other content: it transcodes
into the same `{slug}/e{NNN}/hls/master.m3u8` structure and streams through the
same signed-token player, paywall, coins, resume and swipe-to-next.

## Two clean sources

**1. Royalty-free stock (fast, free, commercial-safe)**
Pexels / Pixabay clips are free for commercial use, no attribution required, and
Pexels has a free API. Fetch + ingest in one step:

```bash
export PEXELS_API_KEY=…        # free at https://www.pexels.com/api/
# a plan maps a search query to each series/episode you want to fill:
cat > demo_plan.json <<'JSON'
[
  {"query": "woman city night emotional", "slug": "kaanch-ka-mahal", "episode": 1},
  {"query": "man suit office serious",     "slug": "ceo-sahab",       "episode": 1}
]
JSON
PEXELS_API_KEY=$PEXELS_API_KEY make fetch-stock PLAN=demo_plan.json
```

**2. AI-generated clips (most on-brand — your eventual pipeline, pulled forward)**
Generate a few vertical hero clips with Runway / Pika / Kling / Veo / Sora, drop
the MP4s in a folder named `{slug}_e{NN}.mp4`, and ingest:

```bash
make ingest SRC=~/katha-ai-clips        # folder of kaanch-ka-mahal_e01.mp4, …
```

Recommended demo mix: **AI hero clips** for the 2–3 flagship series (looks like
*your* show, and answers "can they actually make AI video?"), **stock** for the
rest so the whole catalogue feels alive.

## Direct ingest options (`tools/ingest_media.py`)

```bash
python tools/ingest_media.py --file clip.mp4 --slug kaanch-ka-mahal --episode 1
python tools/ingest_media.py --source-dir ~/clips          # {slug}_e{NN}.mp4
python tools/ingest_media.py --map jobs.json               # [{slug,episode,file}]
```

- `--fit cover` (default) crops to fill the vertical frame; `--fit contain`
  letterboxes to keep the whole frame.
- `--encrypt` AES-128-encrypts the HLS segments (protected origin); it prints
  the key-delivery step you'd wire before encrypted playback works.
- Output is the standard 1080×1920 mezzanine + a 4-rendition ladder (1080/720/
  540/360, 2 s segments), idempotent per episode.

Validate anything you ingest by pointing the app at it (`make api`) and playing
the episode, or decode the master directly:

```bash
ffmpeg -i media/<slug>/e001/hls/master.m3u8 -t 1 -f null -
```
