import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mutate } from "../api/client";
import type { ModerationItem } from "../api/client";
import { Empty, IsoTime, Modal, PageHeader, Sev, Skeleton } from "../ui";
import { useStore } from "../store";
import { canAct } from "../auth/roles";

const RATINGS = ["U", "U/A 7+", "U/A 13+", "U/A 16+", "A"];

/** One queue: rating decisions from the last 30 days and grievances that
 *  talk about content. A person confirms or marks reviewed; both audited. */
export function Moderation() {
  const { role, online, showToast } = useStore();
  const [items, setItems] = useState<ModerationItem[] | null>(null);
  const [tab, setTab] = useState<"open" | "reviewed">("open");
  const [reviewing, setReviewing] = useState<ModerationItem | null>(null);
  const [confirming, setConfirming] = useState<ModerationItem | null>(null);
  const [note, setNote] = useState("");
  const [rating, setRating] = useState("U/A 13+");
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    void api.moderation().then((r) => setItems(r.items));
  }, []);
  useEffect(load, [load]);

  const may = canAct(role, "content,qc") && online;
  const shown = (items ?? []).filter((i) => (tab === "open") === !i.reviewed);

  async function markReviewed() {
    if (!reviewing) return;
    const res = await mutate.modReviewed(reviewing.id, note.trim());
    if ("offline" in res) return showToast("Offline — not marked", "error");
    if (res.error) return showToast(`Not marked: ${res.error}`, "error");
    showToast(`${reviewing.title} reviewed · audited`);
    setReviewing(null);
    setNote("");
    load();
  }

  async function confirmRating() {
    if (!confirming) return;
    const res = await mutate.setRating(String(confirming.slug), rating, reason.trim());
    if ("offline" in res) return showToast("Offline — rating unchanged", "error");
    if (res.error) return showToast(`Rating not changed: ${res.error}`, "error");
    showToast(`Rated ${rating} · accountable to you in the audit log`);
    setConfirming(null);
    setReason("");
    load();
  }

  return (
    <>
      <PageHeader
        title="Moderation & ratings"
        subtitle="AI suggests; a person decides. Rating changes from the last 30 days and grievances about content wait here until someone looks."
        actions={items ? (
          <span className="pill">{items.filter((i) => !i.reviewed).length} open</span>
        ) : undefined}
      />

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "open"}
                className={tab === "open" ? "tab on" : "tab"} onClick={() => setTab("open")}>
          Open
        </button>
        <button role="tab" aria-selected={tab === "reviewed"}
                className={tab === "reviewed" ? "tab on" : "tab"}
                onClick={() => setTab("reviewed")}>
          Reviewed
        </button>
      </div>

      {items === null ? (
        <Skeleton rows={4} />
      ) : shown.length === 0 ? (
        <Empty title={tab === "open" ? "Nothing to review" : "Nothing reviewed yet"}
               hint="New rating decisions and content grievances appear here as they happen." />
      ) : (
        <ul className="approvals">
          {shown.map((it) => (
            <li key={it.id} className="aprow">
              <div style={{ flex: 1 }}>
                <Sev level={it.kind === "rating" ? "info" : "warn"}>
                  {it.kind === "rating" ? `rating ${it.rating}` : `grievance · ${it.status}`}
                </Sev>{" "}
                <b>{it.title}</b>
                <div className="muted tiny">{it.detail}</div>
                <div className="tiny muted">
                  <IsoTime iso={it.at} />
                  {it.by ? ` · by ${it.by}` : ""}
                  {" · "}<Link to={it.to}>open</Link>
                  {it.reviewed ? (
                    <> · reviewed by {it.reviewed.by}
                      {it.reviewed.note ? ` — ${it.reviewed.note}` : ""}</>
                  ) : null}
                </div>
              </div>
              {!it.reviewed ? (
                <div style={{ display: "flex", gap: 8 }}>
                  {it.kind === "rating" ? (
                    <button className="btn s" disabled={!may}
                            onClick={() => { setRating(String(it.rating)); setReason("");
                                             setConfirming(it); }}>
                      Confirm rating…
                    </button>
                  ) : null}
                  <button className="btn p" disabled={!may}
                          onClick={() => { setNote(""); setReviewing(it); }}>
                    Mark reviewed…
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {reviewing ? (
        <Modal title={`Reviewed · ${reviewing.title}`} onClose={() => setReviewing(null)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setReviewing(null)}>Cancel</button>
                   <button className="btn p" onClick={() => void markReviewed()}>
                     Mark reviewed
                   </button>
                 </>
               }>
          <p className="tiny">Optional note for the next person — what you checked.</p>
          <label>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)}
                   aria-label="Review note" placeholder="e.g. watched E3, no takedown needed" />
          </label>
        </Modal>
      ) : null}

      {confirming ? (
        <Modal title={`Confirm rating · ${confirming.title}`} onClose={() => setConfirming(null)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setConfirming(null)}>Cancel</button>
                   <button className="btn p" disabled={!reason.trim()}
                           onClick={() => void confirmRating()}>
                     Save rating
                   </button>
                 </>
               }>
          <p className="tiny">
            IT Rules self-classification: who decided and why is recorded on the series.
          </p>
          <label>
            Rating
            <select value={rating} aria-label="Rating"
                    onChange={(e) => setRating(e.target.value)}>
              {RATINGS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label>
            Why (required)
            <input value={reason} onChange={(e) => setReason(e.target.value)}
                   aria-label="Rating reason" placeholder="e.g. confirmed after review of E41" />
          </label>
        </Modal>
      ) : null}
    </>
  );
}
