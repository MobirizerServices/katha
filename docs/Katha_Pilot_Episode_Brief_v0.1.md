# Katha — Pilot Episode Production Brief (v0.1)

| | |
|---|---|
| **Purpose** | One real, fully-owned 60–75 s micro-drama episode for the investor demo and as proof of production capability. Replaces the placeholder video in the demo build; drops into the §12.6 pipeline unchanged. |
| **Series** | *Kaanch Ka Mahal* ("The Glass Mansion") — Hindi family drama / in-laws saga. Matches the title used across the iOS, web and admin mockups and the seed catalogue. |
| **Episode** | E1 (the free-episode hook). Beat taken from the Writers' Room outline in the admin dashboard: *"The wedding photo has one face too many."* |
| **Tier / budget** | Tier C–D lean (PDD §23.3): single location, 2–3 actors, ½–1 shoot day. Target ₹40,000–1,20,000 all-in. |
| **Owner** | Head of Content (to appoint) · this brief is the studio/DP handoff. |
| **Rights** | Full buyout, all media/territories/languages in perpetuity, incl. marketing-clip and AI-dubbing rights (PDD §23.5, §34). No stock, no third-party music, no recognizable brands in frame. |

---

## 1. Why this episode

- Investors judge a content company on **owned content + a production process**, not on catalogue size. One episode you fully own beats a hundred you don't.
- E1 is the highest-leverage thing to shoot: it's the free hook every viewer sees, it exercises the paywall boundary (E10→E11) narratively, and a strong 60-second hook is the single best marketing clip you'll have.
- It de-risks the model: shooting it surfaces the real per-episode cost, crew needs and delivery-spec friction before you commission 25–30 series.

## 2. The story (E1 — lands premise in ≤30 s, ends on a cliffhanger)

*Meera, newly married, moves into her husband Kabir's grand Lucknow family home. Alone, she opens the wedding album — and in the group photo, standing beside Kabir, is a man she has never met, looking at her. The doorbell rings. Her mother-in-law, without a word, goes to answer it. Meera turns the page: the same man, in an older photo, holding a baby. The door opens. A man's voice: "So you're the new bahu." Meera looks up — it's him. Cut to black. "Kabir has no brother." E1 ends.*

Premise clear by ~0:25; hook lands at the cut. The free→paid cliff (E10→E11) is engineered later in the series, per the Writers' Room outline — the pilot only needs to make the viewer *need* E2.

### Shootable beat sheet (target 60–75 s)

| # | Time | Beat | Shot |
|---|---|---|---|
| 1 | 0:00–0:08 | Meera enters the empty drawing room, dupatta still on, taking in the grand house | Slow push-in, portrait 9:16, natural window light |
| 2 | 0:08–0:20 | She sits, opens the heavy wedding album; warm close-ups of photos | Insert shots of album + her face; establish intimacy |
| 3 | 0:20–0:32 | She freezes on the group photo — a stranger beside Kabir, looking at the camera | Push to ECU on the photo; a beat on her eyes |
| 4 | 0:32–0:42 | Doorbell. Mother-in-law crosses frame silently to answer | Wide; MIL's face unreadable |
| 5 | 0:42–0:55 | Meera turns the page — same man, older photo, holding a baby | Insert + reaction |
| 6 | 0:55–1:05 | Door opens off-screen. "So you're the new bahu." She looks up — it's him | Over-shoulder → her reaction → reveal |
| 7 | 1:05–1:12 | Hard cut to black. Title card: *"Kabir has no brother."* → E1 end card | Match the mockup end-card style |

## 3. Cast & location

- **Meera** (lead, 25–32): carries the episode on reactions. Cast a theatre/OTT actor who can do a lot with the eyes.
- **Mother-in-law** (50s): presence, not lines — one silent crossing.
- **The Stranger** (30s): one line, seen only in the final reveal. Can be a half-day booking.
- **Location**: one traditional/well-appointed Lucknow or Delhi-NCR home interior (drawing room + doorway). Owner permission in writing. No visible brand logos, no third-party art/posters on walls.

## 4. Delivery spec (must match PDD §7.2 so it flows through the pipeline)

- **Resolution/aspect**: 1080×1920, true vertical 9:16.
- **Frame rate**: 25 or 30 fps (pick one, keep consistent).
- **Codec/bitrate for master**: ≥ 8 Mbps H.264 **or** ≥ 5 Mbps HEVC.
- **Audio**: stereo AAC ≥ 192 kbps; dialogue clean; **loudness −16 LUFS ± 1**.
- **Safe zones**: keep faces/text clear of the player-control zones — bottom **22%**, right **12%**.
- **Subtitles**: deliver a Hindi transcript so AI subtitles + the English track can be generated (§22.4).
- **Duration**: 60–75 s. Hook must land before the cut.
- **Deliverables**: the graded master (`source.mp4`), the Hindi transcript, and a signed rights/appearance release for every person on screen.

## 5. Budget (Tier C–D, validate with the studio)

| Line | Low | High | Notes |
|---|---|---|---|
| Director/DP (½–1 day) | ₹12,000 | ₹35,000 | Small crew, one camera |
| Cast (3, incl. one lead) | ₹10,000 | ₹40,000 | Lead carries most of it |
| Location (home interior) | ₹5,000 | ₹20,000 | Half/full day |
| Light/sound/grip | ₹5,000 | ₹15,000 | Natural light keeps this low |
| Wardrobe/props/album | ₹3,000 | ₹8,000 | The album is the hero prop |
| Edit + grade + sound mix | ₹5,000 | ₹15,000 | Deliver to spec above |
| **Total** | **₹40,000** | **₹1,33,000** | Brackets PDD §17.1's ₹25–35k/episode floor once amortized over a real series |

## 6. How it enters Katha

1. Studio delivers the master + transcript + releases.
2. Upload through the admin **Media & QC** module → probe validates against §7.2 → transcode to the 4-rendition HLS ladder (the same one the placeholder generator already produces).
3. AI subtitles (Hindi→English) with human QC (§22.4); rating self-classified U/A per IT Rules.
4. Publish to the demo build as *Kaanch Ka Mahal* E1 — replacing the placeholder file at `media/kaanch-ka-mahal/e001/`.
5. The 60-second cut becomes clip-factory asset #1 (§24.2) for the investor deck and organic top-of-funnel.

## 7. What I can prepare next (say the word)

- A full **shooting script** with Hindi dialogue for the Stranger's line and any needed voice.
- A **one-page shot list / storyboard** the DP can shoot from.
- A **rights/appearance release** template and a studio deliverables checklist.
- Wiring the pipeline so the delivered master drops into `media/kaanch-ka-mahal/e001/` and regenerates the HLS ladder in one command.

---

*This is the one part of the demo I can't produce for you — it needs a camera, a cast and a location. Everything up to and after the shoot (script, spec, pipeline, publish) I can prepare so the shoot day is turnkey.*
