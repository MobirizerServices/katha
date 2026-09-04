"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import SeriesCard from "./SeriesCard";
import { useWallet } from "./WalletProvider";
import { api, type SeriesSummaryDTO } from "@/lib/api";
import { languageName, metaLine } from "@/lib/catalog";

/**
 * The signed-in viewer's list, read from /v1/me/list — the server is the only
 * copy. Each card can be removed and carries a reminder bell ("tell me when a
 * new episode drops", /v1/me/reminders). Guests are asked to sign in: a list
 * without an account would evaporate with the browser.
 */
export default function MyList() {
  const w = useWallet();
  const [list, setList] = useState<SeriesSummaryDTO[] | null>(null);
  const [reminders, setReminders] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!w.ready || !w.signed) return;
    let cancelled = false;
    api
      .myList()
      .then((r) => !cancelled && setList(r.series))
      .catch(() => !cancelled && setFailed(true));
    api
      .reminders()
      .then((r) => !cancelled && setReminders(r.slugs))
      .catch(() => { /* bells simply show as off until the server answers */ });
    return () => {
      cancelled = true;
    };
  }, [w.ready, w.signed]);

  if (!w.ready) return <p className="wrap muted" aria-busy="true" style={{ paddingTop: 30 }}>Loading…</p>;

  if (!w.signed) {
    return (
      <div className="empty" style={{ paddingTop: 110 }}>
        <h3>Sign in to keep a list</h3>
        <p>Your list and reminders follow your phone number across the web and the iPhone app.</p>
        <button className="btn p" style={{ display: "inline-flex" }} onClick={() => w.openSignIn("/mylist")}>
          Sign in with phone
        </button>
        <p style={{ marginTop: 14, fontSize: 12.5, color: "var(--text3)" }}>Free episodes play without an account.</p>
      </div>
    );
  }

  const remove = (slug: string) =>
    api
      .removeFromList(slug)
      .then((r) => setList(r.series))
      .catch(() => w.toast("Couldn't update your list — try again"));

  const toggleBell = (slug: string) => {
    const on = reminders.includes(slug);
    (on ? api.removeReminder(slug) : api.addReminder(slug))
      .then((r) => {
        setReminders(r.slugs);
        w.toast(on ? "Reminder off" : "We'll tell you when a new episode drops");
      })
      .catch(() => w.toast("Couldn't save the reminder — try again"));
  };

  return (
    <>
      <div className="wrap rowhead" style={{ paddingTop: 30 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>My list</h1>
      </div>
      {failed && (
        <p className="wrap muted" role="alert">
          Couldn&apos;t load your list. Check your connection and refresh.
        </p>
      )}
      {list === null && !failed && <p className="wrap muted" aria-busy="true">Loading your list…</p>}
      {list !== null && list.length === 0 && (
        <div className="empty">
          <h3>Your list is empty</h3>
          <p>Add a series from its page to keep it here.</p>
          <Link className="btn p sm" href="/browse" style={{ display: "inline-flex" }}>
            Browse series
          </Link>
        </div>
      )}
      {list !== null && list.length > 0 && (
        <div className="grid">
          {list.map((s) => {
            const on = reminders.includes(s.slug);
            return (
              <SeriesCard
                key={s.slug}
                slug={s.slug}
                title={s.title}
                meta={metaLine(languageName(s.primary_language), s.genres[0], s.episode_count)}
                cover={s.cover_url}
                badge={s.content_rating}
                actions={
                  <>
                    <button
                      className={`chip ${on ? "on" : ""}`}
                      aria-pressed={on}
                      aria-label={`${on ? "Stop reminders for" : "Remind me about"} ${s.title}`}
                      onClick={() => toggleBell(s.slug)}
                    >
                      {on ? "🔔 Reminding" : "🔕 Remind me"}
                    </button>
                    <button className="chip" aria-label={`Remove ${s.title} from my list`} onClick={() => remove(s.slug)}>
                      Remove
                    </button>
                  </>
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}
