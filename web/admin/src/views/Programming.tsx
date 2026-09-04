import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mutate } from "../api/client";
import type { ProgrammingRow } from "../api/client";
import { Empty, IsoTime, Modal, PageHeader, Skeleton, StatusBadge } from "../ui";
import type { SeriesStatus } from "../api/types";
import { useStore } from "../store";
import { canAct } from "../auth/roles";

const DAY = 864e5;

export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;           // Monday = 0
  return new Date(x.getTime() - dow * DAY);
}

function sameDay(iso: string, day: Date): boolean {
  const t = new Date(iso);
  return t.getFullYear() === day.getFullYear() && t.getMonth() === day.getMonth()
    && t.getDate() === day.getDate();
}

/** datetime-local → ISO with an explicit offset (the server insists on one). */
export function toIso(local: string): string {
  return new Date(local).toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function toBadge(status: string): SeriesStatus {
  const map: Record<string, SeriesStatus> = {
    live: "live", scheduled: "sched", draft: "draft", archived: "arch",
  };
  return map[status] ?? "live";
}

/** The release calendar: this week's drops, and every series with its
 *  scheduled moment. Scheduling flips status through the lifecycle rule. */
export function Programming() {
  const { role, online, showToast } = useStore();
  const [rows, setRows] = useState<ProgrammingRow[] | null>(null);
  const [anchor, setAnchor] = useState(() => weekStart(new Date()));
  const [scheduling, setScheduling] = useState<ProgrammingRow | null>(null);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    void api.programming().then((r) => setRows(r.series));
  }, []);
  useEffect(load, [load]);

  const may = canAct(role, "content") && online;
  const days = Array.from({ length: 7 }, (_, i) => new Date(anchor.getTime() + i * DAY));
  const today = new Date();

  async function run(label: string, fn: () => Promise<Awaited<ReturnType<typeof mutate.setSchedule>>>) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if ("offline" in res) return showToast(`Offline — ${label} not applied`, "error");
    if (res.error) return showToast(`${label} refused: ${res.error}`, "error");
    showToast(`${label} · status now ${String(res.status)} · audited`);
    setScheduling(null);
    setWhen("");
    load();
  }

  return (
    <>
      <PageHeader
        title="Programming"
        subtitle="This week's drops and every series' release moment. Scheduling marks a series scheduled; Publish now makes it live in the apps on core-api's next request."
        actions={
          <>
            <button className="btn s" onClick={() => setAnchor(new Date(anchor.getTime() - 7 * DAY))}>
              ‹ Prev week
            </button>
            <button className="btn s" onClick={() => setAnchor(weekStart(new Date()))}>Today</button>
            <button className="btn s" onClick={() => setAnchor(new Date(anchor.getTime() + 7 * DAY))}>
              Next week ›
            </button>
          </>
        }
      />

      <div className="panel">
        <header>
          <h3>Week of {anchor.toLocaleDateString("en-IN", { day: "numeric", month: "long" })}</h3>
          <span className="muted">release times shown in your local zone</span>
        </header>
        <div className="pad" style={{ padding: 14 }}>
          <div className="cal">
            {days.map((day) => {
              const evs = (rows ?? []).filter((r) => r.release_at && sameDay(r.release_at, day));
              return (
                <div key={day.toISOString()}
                     className={sameDay(day.toISOString(), today) ? "day today" : "day"}>
                  <b>{day.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}</b>
                  {evs.map((r) => (
                    <div key={r.slug} className="ev">
                      <Link to={`/catalog/${r.slug}`}>{r.title}</Link>
                      <div className="tiny muted">
                        {new Date(r.release_at).toLocaleTimeString("en-IN",
                          { hour: "2-digit", minute: "2-digit" })} · {r.language}
                      </div>
                    </div>
                  ))}
                  {evs.length === 0 ? <div className="tiny muted">no drop</div> : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {rows === null ? (
        <Skeleton rows={6} />
      ) : rows.length === 0 ? (
        <Empty title="No series" hint="Draft a series in the catalog and schedule it here." />
      ) : (
        <div className="panel" style={{ marginTop: 16 }}>
          <table className="table">
            <thead>
              <tr><th>Series</th><th>Language</th><th>Status</th><th>Release</th>
                  <th aria-label="actions"></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug}>
                  <td><Link to={`/catalog/${r.slug}`}><b>{r.title}</b></Link>
                      <small className="muted mono"> {r.slug}</small></td>
                  <td>{r.language}</td>
                  <td><StatusBadge status={toBadge(r.status)} /></td>
                  <td>
                    {r.release_at ? (
                      <>
                        <span className="mono">{r.release_at}</span>
                        <div className="tiny muted">
                          by {r.scheduled_by} · <IsoTime iso={r.scheduled_at} />
                        </div>
                      </>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn s" disabled={!may || busy}
                            aria-label={`Schedule ${r.title}`}
                            onClick={() => { setWhen(""); setScheduling(r); }}>
                      Schedule…
                    </button>{" "}
                    {r.release_at ? (
                      <button className="btn s" disabled={!may || busy}
                              aria-label={`Unschedule ${r.title}`}
                              onClick={() => void run("Unscheduled",
                                () => mutate.setSchedule(r.slug, ""))}>
                        Unschedule
                      </button>
                    ) : null}{" "}
                    {r.status !== "live" ? (
                      <button className="btn p" disabled={!may || busy}
                              aria-label={`Publish ${r.title}`}
                              onClick={() => void run("Published",
                                () => mutate.setStatus(r.slug, "live"))}>
                        Publish now
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scheduling ? (
        <Modal title={`Schedule · ${scheduling.title}`} onClose={() => setScheduling(null)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setScheduling(null)}>Cancel</button>
                   <button className="btn p" disabled={busy || !when}
                           onClick={() => void run("Scheduled",
                             () => mutate.setSchedule(scheduling.slug, toIso(when)))}>
                     Schedule
                   </button>
                 </>
               }>
          <p className="tiny">
            The series shows as scheduled until you publish it. Followers are notified
            with "Notify drop" from the series page, not automatically.
          </p>
          <label>
            Release (your local time)
            <input type="datetime-local" value={when} aria-label="Release at"
                   onChange={(e) => setWhen(e.target.value)} />
          </label>
        </Modal>
      ) : null}
    </>
  );
}
