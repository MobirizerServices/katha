import Link from "next/link";
import type { CSSProperties } from "react";
import { coverUrl, jsonLdString } from "@/lib/catalog";
import SiteFooter from "@/components/SiteFooter";
import PitchForm, { PARTNERS_EMAIL } from "@/components/PitchForm";
import {
  SERIES,
  COIN_PACKS,
  FREE_EPISODES,
  EPISODE_COIN_PRICE,
  BUNDLE_DISCOUNT_PCT,
  coinsToRupees,
  fmt,
} from "@/lib/catalog";

const featured = SERIES.slice(0, 6);
const hero = SERIES[0];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Katha",
      url: "https://katha.example",
      logo: "https://katha.example/icon.png",
      contactPoint: [
        { "@type": "ContactPoint", contactType: "customer support", email: "help@katha.example" },
        { "@type": "ContactPoint", contactType: "grievance officer", email: "grievance@katha.example" },
      ],
    },
    {
      "@type": "MobileApplication",
      name: "Katha",
      operatingSystem: "iOS 17 or later",
      applicationCategory: "EntertainmentApplication",
      offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
    },
    {
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: "How do coins work?",
          acceptedAnswer: {
            "@type": "Answer",
            text: `The first ${FREE_EPISODES} episodes of every series are free. After that each episode costs ${EPISODE_COIN_PRICE} coins, about ₹${coinsToRupees(
              EPISODE_COIN_PRICE
            )}. Coins are bought in packs and never expire while your account exists; bonus coins are spent before bought coins.`,
          },
        },
        {
          "@type": "Question",
          name: "Can I get a refund?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Purchases made through the App Store are refunded by Apple under Apple's policy. Coins bought on the Katha website can be refunded within 7 days if they are unspent.",
          },
        },
        {
          "@type": "Question",
          name: "Which languages are available?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Hindi, Tamil and Telugu at launch, with more Indian languages following. Most series carry English subtitles.",
          },
        },
      ],
    },
  ],
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLd) }} />

      {/* ---- hero ---- */}
      <section className="wrap hero" id="get">
        <div>
          <h1 className="h">
            Stories in 2 minutes.
            <br />
            In your language. No ads.
          </h1>
          <p className="h-hi">
            Micro-dramas in Hindi, Tamil and Telugu — 1–2 minute episodes that end on a cliffhanger.
          </p>
          <p className="sub">
            Watch the first {FREE_EPISODES} episodes of every series free. Unlock the rest for about ₹
            {coinsToRupees(EPISODE_COIN_PRICE)} each with coins. No subscription, nothing to cancel, and
            never an ad.
          </p>
          <div className="ctas">
            <a className="btn store" href="#" aria-label="Download on the App Store">
              <span style={{ fontSize: 26 }}></span>
              <span>
                <small>Download on the</small>App Store
              </span>
            </a>
            <Link className="btn s" href="#series">
              Watch a free episode
            </Link>
          </div>
          <div className="trust">
            <span>
              <i className="dot" />First {FREE_EPISODES} episodes free
            </span>
            <span>
              <i className="dot" />No ads, ever
            </span>
            <span>
              <i className="dot" />Works on 4G
            </span>
            <span>
              <i className="dot" />Parental lock
            </span>
          </div>
        </div>
        <div className="herophones" aria-hidden="true">
          <div className="phone">
            <div className="screen">
              <div className="poster-fill" style={{ "--c1": hero.c1, "--c2": hero.c2 } as CSSProperties} />
              <div className="pt">
                <h3>{hero.title}</h3>
                <p>
                  {hero.genres[0]} · {hero.language} · {hero.episodeCount} episodes
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---- featured series ---- */}
      <section className="band" id="series">
        <div className="wrap">
          <h2 className="sec">Trending this week</h2>
          <p className="lead2" style={{ margin: "0 0 28px" }}>
            Every series starts free. Watch episode 1 right here in your browser.
          </p>
          <div className="cards">
            {featured.map((s) => (
              <Link key={s.slug} className="pcard" href={`/series/${s.slug}`}>
                <div
                  className="poster"
                  style={{
                    "--c1": s.c1,
                    "--c2": s.c2,
                    backgroundImage: `linear-gradient(to top, rgba(0,0,0,.7), transparent 55%), url(${coverUrl(s.slug)})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  } as CSSProperties}>
                  <span className="badge">Free · {FREE_EPISODES} eps</span>
                  <span className="t">{s.title}</span>
                </div>
                <div className="m">
                  <b>{s.title}</b>
                  {s.genres[0]} · {s.language} · {s.episodeCount} episodes
                </div>
                <span className="play">▶ Watch E1 free</span>
              </Link>
            ))}
          </div>
          <p className="note">
            New series every week in every language. Key art is generated placeholder artwork until studio finals land.
          </p>
        </div>
      </section>

      {/* ---- how coins work ---- */}
      <section className="band alt" id="how">
        <div className="wrap">
          <h2 className="sec">Pay only for what you watch</h2>
          <p className="lead2">
            No subscription. Coins are a simple way to unlock the episodes you actually want to see.
          </p>
          <div className="steps">
            <div className="step">
              <h3>Watch {FREE_EPISODES} episodes free</h3>
              <p>Every series opens with {FREE_EPISODES} free episodes — about 15 minutes of story. No login needed.</p>
              <div className="ex">
                <span className="coin" style={{ background: "var(--ok)" }} />
                Episodes 1–{FREE_EPISODES} · ₹0
              </div>
            </div>
            <div className="step">
              <h3>Unlock the next one</h3>
              <p>
                Hooked? The next episode costs {EPISODE_COIN_PRICE} coins — about ₹{coinsToRupees(EPISODE_COIN_PRICE)}. Unlock
                one at a time, or the whole series at once and save {BUNDLE_DISCOUNT_PCT}%.
              </p>
              <div className="ex">
                <span className="coin" />
                {EPISODE_COIN_PRICE} coins ≈ ₹{coinsToRupees(EPISODE_COIN_PRICE)} per episode
              </div>
            </div>
            <div className="step">
              <h3>Buy coins, keep them forever</h3>
              <p>
                Coins come in packs from ₹99. They never expire while your account exists, and bonus coins
                are used first.
              </p>
              <div className="ex">
                <span className="coin" />
                ₹199 → 1,300 coins · finishes a series and the next
              </div>
            </div>
          </div>

          <div style={{ marginTop: 44 }}>
            <table className="pr" aria-label="Coin packs">
              <thead>
                <tr>
                  <th>Pack</th>
                  <th>Price</th>
                  <th>Coins</th>
                  <th>On the web (+10%)</th>
                  <th>Roughly</th>
                </tr>
              </thead>
              <tbody>
                {COIN_PACKS.map((p) => (
                  <tr key={p.sku} className={p.highlight ? "hi" : undefined}>
                    <td>
                      {p.name}
                      {p.tag && (
                        <span className={`tag ${p.highlight ? "acc" : "gold"}`} style={{ marginLeft: 6 }}>
                          {p.tag}
                        </span>
                      )}
                    </td>
                    <td className="num">₹{fmt(p.priceInr)}</td>
                    <td className="num">{fmt(p.coins)}</td>
                    <td className="num">{fmt(p.coins + Math.round(p.coins * 0.1))}</td>
                    <td>{Math.floor((p.coins - EPISODE_COIN_PRICE) / EPISODE_COIN_PRICE)}+ episodes</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">
              Prices include GST. In the app, payment is handled by Apple. On the Katha website every pack
              adds a +10% bonus and is paid by UPI — for example the ₹199 Popular pack gives 1,300 + 130 =
              1,430 coins.
            </p>
          </div>
        </div>
      </section>

      {/* ---- why katha ---- */}
      <section className="band">
        <div className="wrap">
          <h2 className="sec">Made for the two minutes you actually have</h2>
          <p className="lead2">
            Micro-dramas are full stories told in 1–2 minute episodes, in Indian languages, without ads.
          </p>
          <div className="why">
            <div>
              <h3>Originals in your language</h3>
              <p>Written and shot in Hindi, Tamil and Telugu — not dubbed leftovers.</p>
            </div>
            <div>
              <h3>Every episode ends on a hook</h3>
              <p>One to two minutes, then a turn you didn&rsquo;t see coming. Swipe up and the next one plays.</p>
            </div>
            <div>
              <h3>Never an ad</h3>
              <p>Not before, not between, not inside. You pay a few rupees for an episode and that&rsquo;s it.</p>
            </div>
            <div>
              <h3>Built for 4G, not fibre</h3>
              <p>Fast start on crowded networks, data saver on mobile data, small downloads.</p>
            </div>
            <div>
              <h3>Ratings and a parental lock</h3>
              <p>Every series carries a U/A rating and descriptors. A PIN gates 16+ and adult titles.</p>
            </div>
            <div>
              <h3>Subtitles and dubs</h3>
              <p>Most series come in all three launch languages, with English subtitles.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---- faq ---- */}
      <section className="band alt" id="faq">
        <div className="wrap" style={{ maxWidth: 860 }}>
          <h2 className="sec">Questions people ask</h2>
          <div className="faq">
            <details>
              <summary>How do coins work?</summary>
              <p>
                The first {FREE_EPISODES} episodes of every series are free. After that each episode costs {EPISODE_COIN_PRICE} coins,
                about ₹{coinsToRupees(EPISODE_COIN_PRICE)}. You buy coins in packs; they never expire while your account
                exists, and bonus coins are spent before purchased coins.
              </p>
            </details>
            <details>
              <summary>Can I get a refund?</summary>
              <p>
                Purchases made through the App Store are refunded by Apple under Apple&rsquo;s policy. Coins
                bought on this website can be refunded within 7 days if they are unspent.
              </p>
            </details>
            <details>
              <summary>Which languages are available?</summary>
              <p>
                Hindi, Tamil and Telugu at launch, with more Indian languages following. Most series carry
                English subtitles.
              </p>
            </details>
            <details>
              <summary>Which devices does it work on?</summary>
              <p>iPhone running iOS 17 or later. You can also watch the free episodes of any series on this website.</p>
            </details>
            <details>
              <summary>Is there a parental lock?</summary>
              <p>Yes. Set a 4-digit PIN and it is required before any series rated U/A 16+ or A plays. Katha is for viewers 18 and older.</p>
            </details>
          </div>
        </div>
      </section>

      {/* ---- work with us: studios, brands, creators ---- */}
      <div id="business">
        <section className="band alt" id="pitch-intro">
          <div className="wrap">
            <h2 className="sec">Make the next binge.</h2>
            <p className="lead2">
              Katha commissions Indian-language micro-dramas from studios, places brands inside stories instead
              of between them, and pays creators for the audiences they bring.
            </p>
            <div className="trust" style={{ marginTop: 0, marginBottom: 32 }}>
              <span><i className="dot" />Every series in 3 languages within 24 hours</span>
              <span><i className="dot" />Greenlight decisions in 10 working days</span>
              <span><i className="dot" />Payment on delivery, not on performance</span>
            </div>
            <div className="aud">
              <article id="studios">
                <h3>Studios and production houses</h3>
                <p>We commission 50–100 episode vertical series in Hindi, Tamil and Telugu, and license finished catalogues for dubbing.</p>
                <ul>
                  <li>Budget tiers from lean single-location series to star-led tentpoles</li>
                  <li>Six-week concept-to-master schedule on core titles</li>
                  <li>We handle subtitles, dubs, marketing clips and distribution</li>
                  <li>Rights buyout with sequel options; payment on delivery</li>
                </ul>
                <a className="btn p" href="#pitch">Pitch a series</a>
              </article>
              <article id="brands">
                <h3>Brands and agencies</h3>
                <p>Your product as a character in a story people chose to watch — not an interruption they skip.</p>
                <ul>
                  <li>Branded micro-drama series (5–20 episodes) written around your brief</li>
                  <li>Integrations inside existing hits; sponsored premieres</li>
                  <li>Ad-free environment: 100% of attention is on the story</li>
                  <li>Reported on completion, replays, saves and brand recall</li>
                </ul>
                <a className="btn p" href="#pitch">Talk to us</a>
              </article>
              <article id="creators">
                <h3>Creators</h3>
                <p>Share the series you love and earn on every first purchase your audience makes.</p>
                <ul>
                  <li>20% of first purchases for 90 days after install</li>
                  <li>Early access to premieres and cast collaborations</li>
                  <li>Ready-made clips with your own link, in your language</li>
                  <li>Monthly payouts by UPI; transparent dashboard</li>
                </ul>
                <a className="btn p" href="#pitch">Join the creator program</a>
              </article>
            </div>
          </div>
        </section>

        <section className="band">
          <div className="wrap">
            <h2 className="sec">What we commission</h2>
            <p className="lead2">
              Four budget tiers, one quality bar. Every series is shot vertical, delivered to our technical spec,
              and released in three languages.
            </p>
            <div className="tiers">
              <div className="tier"><b>Tentpole</b><span>Star-led · 60–100 episodes</span><p>One a month. Recognizable lead, premiere event, marketing anchor for the whole slate.</p></div>
              <div className="tier"><b>Core original</b><span>60 episodes · 8–10 shoot days</span><p>The bulk of what we make. Romance, family drama, revenge, thriller, fantasy and comedy.</p></div>
              <div className="tier"><b>Lean original</b><span>45–60 episodes · 3–5 shoot days</span><p>Single location, small cast, AI-assisted post. Fast, frequent, experimental.</p></div>
              <div className="tier"><b>Licensed catalogue</b><span>Finished series · dubbed</span><p>Chinese, Korean and Turkish micro-dramas we adapt and dub for Indian audiences.</p></div>
            </div>
            <div style={{ marginTop: 48 }}>
              <h2 className="sec" style={{ fontSize: 28 }}>How a series gets made with us</h2>
              <div className="process">
                <div><b>Pitch</b><p>A one-page premise, tropes, language and budget tier. We reply within 10 working days.</p></div>
                <div><b>Greenlight</b><p>Outline and pilot cut tested with real viewers in the target language.</p></div>
                <div><b>Produce</b><p>Your crew, our spec and QC. Six weeks for a core title.</p></div>
                <div><b>Launch</b><p>Subtitles and dubs within 24 hours; clip factory and paid campaigns from day one.</p></div>
                <div><b>Get paid</b><p>On delivery and acceptance. Bonus for titles that pass 3× payback.</p></div>
              </div>
            </div>
          </div>
        </section>

        <section className="band alt" id="pitch">
          <div className="wrap" style={{ maxWidth: 860 }}>
            <h2 className="sec">Tell us what you want to make</h2>
            <p className="lead2">
              Studios, brands and creators use the same form — it opens in your mail app addressed to{" "}
              <a href={`mailto:${PARTNERS_EMAIL}`}>{PARTNERS_EMAIL}</a>. We reply within three working days.
            </p>
            <PitchForm />
          </div>
        </section>
      </div>

      <SiteFooter />
    </>
  );
}
