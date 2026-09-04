import { useState } from "react";
import { ALL_NAV_ITEMS } from "../nav";
import { useStore } from "../store";
import { Chip, Empty, Modal, PageHeader, Sev, Skeleton, StatusBadge } from "../ui";
import type { SeriesStatus } from "../api/types";

const TOKENS: [string, string][] = [
  ["--accent", "Primary action, progress, current"],
  ["--coin", "Anything about money"],
  ["--ok", "Success, live, matched"],
  ["--warn", "Needs attention, pending"],
  ["--danger", "Error, stuck, statutory"],
  ["--info", "Scheduled, running, informational"],
  ["--surface", "Panels"],
  ["--bg", "Workspace"],
];
const STATUSES: SeriesStatus[] = ["live", "sched", "qc", "draft", "arch"];

/** The admin's design system, rendered with the same CSS the modules use.
 *  Internal: admin only, and says so. */
export function Components() {
  const { showToast } = useStore();
  const [demo, setDemo] = useState(false);
  const [chip, setChip] = useState(false);
  const [toggle, setToggle] = useState(true);

  return (
    <>
      <PageHeader
        title="Components"
        subtitle="The admin’s design system: tokens, components, states. Everything here is live and the same CSS the views use."
        actions={<Sev level="warn">Internal · admin only</Sev>}
      />
      <div className="docs">
        <section>
          <h2>Tokens</h2>
          <p className="d">
            One token set; density changes row height and type size only. Status
            colours always pair with text or an icon, never colour alone.
          </p>
          <div className="swatches">
            {TOKENS.map(([name, use]) => (
              <div className="sw" key={name}>
                <i style={{ background: `var(${name})` }} />
                <b className="mono">{name}</b>
                <span className="muted">{use}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Buttons</h2>
          <p className="d">
            One primary per view. Destructive actions use the danger style and
            always confirm — typed confirmation when irreversible.
          </p>
          <div className="demo">
            <button className="btn p">Primary</button>
            <button className="btn s">Secondary</button>
            <button className="btn danger">Destructive</button>
            <button className="btn p" disabled title="Why it’s disabled goes in the title">
              Disabled
            </button>
          </div>
        </section>

        <section>
          <h2>Status, severity and chips</h2>
          <p className="d">
            Status chips are for lifecycle states; severity for attention; chips for
            filters (selected = accent tint + border).
          </p>
          <div className="demo">
            {STATUSES.map((s) => <StatusBadge key={s} status={s} />)}
            <Sev level="ok">ok</Sev>
            <Sev level="info">info</Sev>
            <Sev level="warn">warn</Sev>
            <Sev level="danger">danger</Sev>
            <Chip on={chip} onClick={() => setChip(!chip)}>
              {chip ? "Selected" : "Filter"}
            </Chip>
            <span className="rt">U/A 13+</span>
          </div>
        </section>

        <section>
          <h2>Form fields</h2>
          <p className="d">
            Label above, hint or error below; one column in drawers, two in modals.
          </p>
          <div className="frow">
            <label className="fld">
              Title
              <input defaultValue="Kaanch Ka Mahal" aria-label="Demo title" />
              <span className="hint tiny muted">Shown in the app exactly as typed.</span>
            </label>
            <label className="fld">
              Coins per episode
              <input defaultValue="3" aria-label="Demo coins" />
              <span className="error tiny" style={{ color: "var(--danger)" }}>Minimum 5 coins.</span>
            </label>
            <label className="fld">
              Language
              <select defaultValue="Hindi" aria-label="Demo language">
                <option>Hindi</option><option>Tamil</option><option>Telugu</option>
              </select>
            </label>
            <div className="fld">
              Toggle
              <div style={{ marginTop: 6 }}>
                <button type="button" className="tog" role="switch" aria-checked={toggle}
                        aria-label="Demo toggle" onClick={() => setToggle(!toggle)} />
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2>Table states</h2>
          <p className="d">
            Skeleton while loading, an empty state that says what to do, an error
            state with a retry, and a table with numbers right-aligned.
          </p>
          <div className="split">
            <div className="panel"><Skeleton rows={3} /></div>
            <div className="panel">
              <Empty title="No results" hint="Clear a filter or widen the date range." />
            </div>
          </div>
          <div className="panel" style={{ marginTop: 10 }}>
            <table className="table">
              <thead><tr><th>Series</th><th style={{ textAlign: "right" }}>Episodes</th></tr></thead>
              <tbody><tr><td>Kaanch Ka Mahal</td><td className="mono" style={{ textAlign: "right" }}>60</td></tr></tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Overlays and feedback</h2>
          <p className="d">
            Modals for decisions (Esc closes). Confirmations for destructive or money
            actions include a reason and, when irreversible, typed confirmation.
            Toasts confirm what changed in the same words as the button.
          </p>
          <div className="demo">
            <button className="btn s" onClick={() => setDemo(true)}>Open a modal</button>
            <button className="btn s" onClick={() => showToast("Saved · nothing actually changed (demo)")}>
              Toast
            </button>
            <button className="btn s" onClick={() => showToast("Something failed (demo)", "error")}>
              Error toast
            </button>
          </div>
        </section>

        <section>
          <h2>Keyboard</h2>
          <p className="d">
            Every module is reachable by <span className="kbd">g</span> + letter; the
            palette by <span className="kbd">⌘K</span>; Esc closes anything.
          </p>
          <table className="table">
            <tbody>
              <tr><td>Search and commands</td><td><span className="kbd">⌘K</span></td></tr>
              {ALL_NAV_ITEMS.filter((n) => n.kb).map((n) => (
                <tr key={n.view}><td>{n.label}</td><td><span className="kbd">{n.kb}</span></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      {demo ? (
        <Modal title="A decision" onClose={() => setDemo(false)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setDemo(false)}>Cancel</button>
                   <button className="btn p" onClick={() => setDemo(false)}>Confirm</button>
                 </>
               }>
          <p className="tiny">Modals hold one decision and its consequences, nothing else.</p>
        </Modal>
      ) : null}
    </>
  );
}
