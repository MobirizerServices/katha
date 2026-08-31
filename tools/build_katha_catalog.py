#!/usr/bin/env python3
"""Build docs/katha-catalog.json - the OWNED launch catalogue.

Source of truth is docs/Katha_Content_Bible_v0.1.md; this file is its
machine-readable form, used to seed dev/staging and to drive
tools/generate_placeholder_media.py.

Unlike docs/seed-catalog.json (third-party metadata, test-only), everything
here is original to Katha and safe to ship in demos, decks and screenshots.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "katha-catalog.json"

PRICING = {"free_episode_count": 10, "episode_coin_price": 30, "bundle_discount_pct": 25}

# slug -> the one line that goes on the poster and in the drop push
TAGLINES = {
    "kaanch-ka-mahal": "Kabir has no brother.",
    "ceo-sahab": "One year. One signature. One lie.",
    "dilli-6-ka-raaz": "Some shutters stay shut for a reason.",
    "saat-pheron-ka-sauda": "Ninety days. Nobody planned for day ninety-one.",
    "raja-ki-beti": "She remembers a siege she was never at.",
    "neend-se-pehle": "Tonight the caller describes her own accident.",
    "kabir-ka-kanoon": "He typed the lie. Now he unmakes it.",
    "nizam-ka-sauda": "Nine days to make a forgery true.",
    "kadhal-kanakku": "Her signature. Someone else's hand.",
    "vetri-vaasal": "They have never let a woman on the mat.",
    "sunday-sambar": "Whoever cooks Sunday keeps the recipe.",
    "prema-pariksha": "Her student is buying the college.",
    "rajahmundry-rani": "For one season, he is still alive.",
    "nalugu-ghantalu": "The same four hours, until he asks the right question."
}

# slug, title, native, meaning, lang, genres, tropes, tier, eps, drop, rating, descriptors, hue, synopsis
SERIES = [
    ("kaanch-ka-mahal", "Kaanch Ka Mahal", "काँच का महल", "The Glass Mansion", "hi",
     ["Family Drama"], ["in-laws saga", "hidden identity"], "B", 60, "drip", "U/A 13+",
     ["family conflict", "mild peril"], "0x1B2A4A",
     "Meera, newly married into a Lucknow haveli, finds a stranger standing beside her husband in every wedding photograph. The family insists no such man exists. He is at the door."),
    ("ceo-sahab", "CEO Sahab", "सीईओ साहब", None, "hi",
     ["Romance"], ["secret billionaire", "contract marriage"], "A", 72, "drip", "U/A 13+",
     ["mild language"], "0x3A1B4A",
     "To save her father's shuttered printing press, a proofreader signs a one-year marriage contract with the man she believes is her boss's driver."),
    ("dilli-6-ka-raaz", "Dilli 6 Ka Raaz", "दिल्ली 6 का राज़", "The Secret of Dilli 6", "hi",
     ["Thriller/Crime"], ["hidden identity", "second chance"], "B", 60, "drip", "U/A 16+",
     ["crime", "violence"], "0x4A1B1B",
     "A Chandni Chowk locksmith opens a shutter that has been sealed for thirty years and finds the tools of his own father's unsolved crime."),
    ("saat-pheron-ka-sauda", "Saat Pheron Ka Sauda", "सात फेरों का सौदा", "The Bargain of Seven Vows", "hi",
     ["Romance"], ["contract marriage", "in-laws saga"], "B", 60, "binge", "U/A 13+",
     ["family conflict"], "0x1B4A2E",
     "A wedding planner marries her most difficult client for ninety days so his grandmother can die happy. The grandmother recovers."),
    ("raja-ki-beti", "Raja Ki Beti", "राजा की बेटी", "The King's Daughter", "hi",
     ["Fantasy/Mythology"], ["reincarnation", "hidden identity"], "B", 54, "drip", "U/A 13+",
     ["historical violence"], "0x4A3A1B",
     "A Jaipur museum guide begins remembering a fort's 1743 siege from inside it, as the descendant of the man who lost it quietly buys the fort back."),
    ("neend-se-pehle", "Neend Se Pehle", "नींद से पहले", "Before Sleep", "hi",
     ["Horror"], ["time-slip", "second chance"], "C", 48, "binge", "U/A 16+",
     ["frightening scenes"], "0x2E2E3E",
     "A night-shift radio host in Bhopal takes calls from a listener who describes tomorrow's accidents. Tonight, he describes hers."),
    ("kabir-ka-kanoon", "Kabir Ka Kanoon", "कबीर का कानून", "Kabir's Law", "hi",
     ["Revenge"], ["underdog revenge"], "C", 48, "binge", "U/A 13+",
     ["legal themes"], "0x1B3A4A",
     "A court stenographer who typed the lie that jailed his brother spends four years learning the law well enough to unmake it."),
    ("nizam-ka-sauda", "Nizam Ka Sauda", "निज़ाम का सौदा", "The Nizam's Bargain", "hi",
     ["Thriller/Crime"], ["hidden identity", "underdog revenge"], "C", 48, "binge", "U/A 13+",
     ["crime"], "0x4A2A1B",
     "An Old City antiques dealer sells a forged farman to the wrong buyer and has nine days to produce the real one."),
    ("kadhal-kanakku", "Kadhal Kanakku", "காதல் கணக்கு", "Love Arithmetic", "ta",
     ["Romance"], ["workplace", "second chance"], "B", 60, "drip", "U/A 7+",
     [], "0x3A2A5A",
     "A Coimbatore auditor is sent to close her ex-fiance's failing mill and finds her own forged signature in its books."),
    ("vetri-vaasal", "Vetri Vaasal", "வெற்றி வாசல்", "The Gate of Victory", "ta",
     ["Sports"], ["underdog revenge"], "A", 66, "drip", "U/A 13+",
     ["sports injury", "gambling reference"], "0x1B4A44",
     "A Madurai jallikattu family's daughter takes her banned brother's place in a kabaddi league that has never let a woman on the mat."),
    ("sunday-sambar", "Sunday Sambar", "சண்டே சாம்பார்", None, "ta",
     ["Comedy"], ["in-laws saga"], "C", 42, "binge", "U/A 7+",
     [], "0x4A4020",
     "Four siblings inherit their mother's Mylapore mess and her rule: the recipe passes to whoever can cook Sunday lunch without the others walking out."),
    ("prema-pariksha", "Prema Pariksha", "ప్రేమ పరీక్ష", "The Test of Love", "te",
     ["Romance"], ["secret billionaire", "hidden identity"], "B", 60, "drip", "U/A 7+",
     ["academic pressure"], "0x2A1B4A",
     "A Vizag coaching-centre teacher tutors a repeat-year student who is thirty-one, brilliant, and quietly buying the college that employs her."),
    ("rajahmundry-rani", "Rajahmundry Rani", "రాజమండ్రి రాణి", "The Queen of Rajahmundry", "te",
     ["Family Drama"], ["in-laws saga", "underdog revenge"], "B", 60, "drip", "U/A 13+",
     ["family conflict", "bereavement"], "0x1B3A2A",
     "A widow keeps her late husband's Godavari boat business alive by pretending, for one season, that he is alive too."),
    ("nalugu-ghantalu", "Nalugu Ghantalu", "నాలుగు గంటలు", "Four Hours", "te",
     ["Thriller/Crime"], ["time-slip"], "C", 48, "binge", "U/A 16+",
     ["peril", "medical scenes"], "0x3A1B2A",
     "A Hyderabad ambulance driver relives the same four hours until he stops trying to save the patient and starts trying to find who put her there."),
]

# Real episode titles for the three titles outlined in the bible (E1-E12).
EP_TITLES = {
    "kaanch-ka-mahal": ["One face too many", "The seventh plate", "The damp page", "The umbrella",
                        "The missing key", "The back seat", "One room too many", "The cleared loan",
                        "The wax impression", "His first son", "The signature", "A woman with her name"],
    "vetri-vaasal": ["Coffee", "His number", "From the stands", "The lock", "The kit bag",
                     "Two points", "The bus stand", "Friday", "The wrong name", "Filed in her name",
                     "The old form", "The empty chair"],
    "prema-pariksha": ["Which batch", "Paid in cash", "A hundred", "The proposal", "The power cut",
                       "The whitened name", "The scholarship", "Dated last month", "Same thing",
                       "The topper's photograph", "The blank line", "Before the gate"],
}

# The 16 acquisition slots (bible section 6) - briefs, not titles. Not renderable series.
SLOTS = [
    ("A1", "hi", "Romance", "Contract marriage; urban; female lead 22-30", "Workplace harassment played as romance", "1-2.5L"),
    ("A2", "hi", "Romance", "Second chance; small-town; a child in the story", "An adoption plot that turns on caste", "1-2.5L"),
    ("A3", "hi", "Family Drama", "Joint family, property dispute, strong matriarch", "Dowry violence without accountability", "1.5-3L"),
    ("A4", "hi", "Family Drama", "Two sisters, one inheritance", None, "1.5-3L"),
    ("A5", "hi", "Comedy", "Multi-generation household; <=45 eps", "Body or appearance humour", "1-2L"),
    ("A6", "hi", "Fantasy/Mythology", "Reincarnation or time-slip; costume-capable", "Depiction of named deities", "2-4L"),
    ("A7", "hi", "Revenge", "Female-led corporate revenge", "On-screen sexual violence", "1.5-3L"),
    ("A8", "ta", "Romance", "Coastal or Kongu-belt setting; college or workplace", "Stalking framed as persistence", "1-2.5L"),
    ("A9", "ta", "Family Drama", "Mother-daughter spine; food or a family business as the world", None, "1.5-3L"),
    ("A10", "ta", "Fantasy/Mythology", "Village folklore with one supernatural rule", "Named temple interiors", "2-4L"),
    ("A11", "ta", "Comedy", "Workplace ensemble; <=45 eps", None, "1-2L"),
    ("A12", "te", "Romance", "Secret-identity romance; Hyderabad or Vizag", "Class humiliation as comedy", "1-2.5L"),
    ("A13", "te", "Romance", "Age-gap or second marriage, handled with dignity", None, "1-2.5L"),
    ("A14", "te", "Family Drama", "Agricultural family; land and water", "Caste-coded villainy", "1.5-3L"),
    ("A15", "te", "Thriller/Crime", "Single location, ~45 eps, high tension", "Police procedural needing uniform clearance", "1.5-3L"),
    ("A16", "te", "Comedy", "Two-hander romantic comedy", None, "1-2L"),
]

LANG_NAME = {"hi": "Hindi", "ta": "Tamil", "te": "Telugu"}


def build():
    series = []
    for (slug, title, native, meaning, lang, genres, tropes, tier, eps, drop,
         rating, descriptors, hue, synopsis) in SERIES:
        titles = EP_TITLES.get(slug, [])
        episodes = []
        for n in range(1, eps + 1):
            free = n <= PRICING["free_episode_count"]
            episodes.append({
                "number": n,
                "title": titles[n - 1] if n <= len(titles) else f"Episode {n}",
                "is_free": free,
                "coin_price": 0 if free else PRICING["episode_coin_price"],
                # E10 runs long on purpose - the cliff needs air (bible 3.3)
                "is_cliff": n == PRICING["free_episode_count"],
            })
        paid = eps - PRICING["free_episode_count"]
        series.append({
            "slug": slug,
            "title": title,
            "title_native": native,
            "title_meaning": meaning,
            "tagline": TAGLINES[slug],
            "synopsis": synopsis,
            "primary_language": lang,
            "language_name": LANG_NAME[lang],
            "genres": genres,
            "tropes": tropes,
            "budget_tier": tier,
            "release_mode": drop,
            "content_rating": rating,
            "rating_descriptors": descriptors,
            "episode_count": eps,
            "free_episode_count": PRICING["free_episode_count"],
            "cover_hue": hue,
            "ownership": "katha_original_full_buyout",
            "status": "seed_demo",
            "pricing": {
                "episode_coin_price": PRICING["episode_coin_price"],
                "bundle_coin_price": round(paid * PRICING["episode_coin_price"]
                                           * (1 - PRICING["bundle_discount_pct"] / 100)),
                "bundle_discount_pct": PRICING["bundle_discount_pct"],
            },
            "episodes": episodes,
        })

    catalogue = {
        "_meta": {
            "purpose": "Katha's OWNED launch catalogue. Every title, character and place name is "
                       "original to Katha - safe for demos, decks, screenshots and staging seeds. "
                       "Replaces docs/seed-catalog.json (third-party metadata, schema testing only).",
            "source_of_truth": "docs/Katha_Content_Bible_v0.1.md",
            "generated_by": "tools/build_katha_catalog.py",
            "pricing_profile": PRICING,
            "series_count": len(series),
            "total_episodes": sum(s["episode_count"] for s in series),
            "slate_note": "14 Katha originals below + 16 acquisition slots (see acquisition_slots) "
                          "= the 30-title soft-launch slate of PDD 7.3 / 23.2.",
        },
        "series": series,
        "acquisition_slots": [
            {"slot": s, "language": lang, "language_name": LANG_NAME[lang], "genre": g,
             "must_have": must, "must_not_have": mustnot, "landed_cost_band_inr": band,
             "status": "unfilled"}
            for (s, lang, g, must, mustnot, band) in SLOTS
        ],
    }
    OUT.write_text(json.dumps(catalogue, indent=2, ensure_ascii=False))
    langs = {}
    for s in series:
        langs[s["language_name"]] = langs.get(s["language_name"], 0) + 1
    print(f"Wrote {OUT.relative_to(ROOT)}")
    print(f"  {len(series)} owned series, {catalogue['_meta']['total_episodes']} episodes")
    print(f"  languages: {langs}")
    print(f"  + {len(SLOTS)} acquisition slots")


if __name__ == "__main__":
    build()
