import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, mutate } from "../api/client";
import type { AdminUser, LedgerTxn, UserLedger } from "../api/types";
import { Empty, IsoTime, Modal, PageHeader, Skeleton, fmtN } from "../ui";
import { ME, useStore } from "../store";
import { DUAL_APPROVAL, ROLE_NAMES, canAct } from "../auth/roles";

const REASONS = [
  "goodwill · playback problem",
  "goodwill · billing confusion",
  "refund correction",
  "abuse clawback",
  "other (note required)",
];

function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

function AdjustDialog({ user, onClose, onApplied }: { user: AdminUser; onClose: () => void;
                                                      onApplied: () => void }) {
  const { role, addApproval, addAudit, reloadApprovals, showToast } = useStore();
  const [dir, setDir] = useState<"Credit" | "Debit">("Credit");
  const [amount, setAmount] = useState(30);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [serverRef, setServerRef] = useState("");

  const needsApproval = amount > DUAL_APPROVAL.coinAdjustment;
  const invalid =
    !Number.isInteger(amount) || amount <= 0 || amount > 100_000 ||
    (reason.startsWith("other") && !note.trim());

  // One idempotency key per attempt; kept across an offline retry (the server
  // may have committed before the response was lost) and rotated otherwise.
  const keyRef = useRef(uid());

  async function submit() {
    if (invalid || busy) return;
    setBusy(true);
    const res = await mutate.adjust(
      user.id, dir === "Credit" ? amount : -amount, reason, note, keyRef.current);
    setBusy(false);
    if (!("offline" in res)) keyRef.current = uid();
    if (!("offline" in res) && res.error) {
      showToast(`Adjustment failed: ${res.error}`, "error");
      return;
    }
    if ("offline" in res) {
      // Sample-data mode: keep the local demo behavior, clearly non-authoritative.
      if (needsApproval) {
        addApproval({
          id: "apr_" + uid(), kind: "Coin adjustment",
          detail: `${dir} ${fmtN(amount)} coins · ${user.id} · ${reason}`,
          requestedBy: ME, when: "Just now", needs: "Finance or Admin",
          amount: dir === "Credit" ? amount : -amount, userId: user.id,
        });
        showToast("Offline — request queued locally only");
      } else {
        addAudit({ actor: ME, action: "wallet.adjust", entity: user.id,
                   change: `${dir} ${amount} · ${reason}` });
        showToast("Offline — nothing was written to the server", "error");
      }
      onClose();
      return;
    }
    if (res.status === "pending_approval") {
      showToast("Approval requested · Finance notified · nothing written yet");
      // the request exists on the server now: badge and inbox must say so
      void reloadApprovals();
      onClose();
      onApplied();
      return;
    }
    // Applied: show the server's own reference before closing (#026).
    const wallet = res.wallet as { total: number } | undefined;
    setServerRef(String(res.ref ?? ""));
    showToast(`Ledger entry written · ${dir.toLowerCase()} ${amount} coins · new balance ${fmtN(wallet?.total ?? 0)}`);
    onApplied();
  }

  const allowed = canAct(role, "support,finance");

  return (
    <Modal
      title={`Adjust coins · ${user.id}`}
      onClose={onClose}
      footer={
        serverRef ? (
          <button className="btn p" onClick={onClose}>Done</button>
        ) : (
          <>
            <button className="btn s" onClick={onClose}>Cancel</button>
            <button className="btn p" disabled={!allowed || invalid || busy}
                    onClick={() => void submit()}>
              {busy ? "Writing…" : needsApproval ? "Request approval" : "Write ledger entry"}
            </button>
          </>
        )
      }
    >
      {!allowed ? (
        <p className="muted">
          {ROLE_NAMES[role]} cannot make money adjustments. Support or Finance only.
        </p>
      ) : serverRef ? (
        <p>
          Written and reconciled. Server reference: <code className="mono">{serverRef}</code>
        </p>
      ) : (
        <>
          <div className="frow">
            <label>
              Direction
              <select value={dir} onChange={(e) => setDir(e.target.value as "Credit" | "Debit")}>
                <option>Credit</option>
                <option>Debit</option>
              </select>
            </label>
            <label>
              Coins
              <input type="number" min={1} max={100000} value={amount}
                     onChange={(e) => setAmount(Number(e.target.value))} />
            </label>
          </div>
          <label>
            Reason code
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
          <label>
            Note {reason.startsWith("other") ? "(required)" : "(optional)"}
            <input value={note} onChange={(e) => setNote(e.target.value)}
                   placeholder="Visible in the audit log" />
          </label>
          <p className="tiny muted">
            Above {DUAL_APPROVAL.coinAdjustment} coins: a second approver from Finance or Admin
            confirms before anything is written.
          </p>
        </>
      )}
    </Modal>
  );
}

type Tab = "ledger" | "entitlements" | "timeline" | "devices" | "data";

/** #025: raw ledger references become doors — a pack opens Config, an
 * episode or bundle opens its series page (closing the drawer). */
function RefLink({ txn, onClose }: { txn: LedgerTxn; onClose: () => void }) {
  const ref = txn.reference_id;
  const ep = ref.match(/^([a-z0-9-]+):e\d+$/);
  const style = { color: "inherit" };
  if (ep) {
    return <Link className="mono" style={style} to={`/catalog/${ep[1]}`}
                 onClick={onClose}>{ref}</Link>;
  }
  if (txn.reference_type === "bundle" || txn.type === "unlock" && !ref.includes(":")) {
    return <Link className="mono" style={style} to={`/catalog/${ref}`}
                 onClick={onClose}>{ref}</Link>;
  }
  if (ref.startsWith("coins_")) {
    return <Link className="mono" style={style} to="/config"
                 onClick={onClose}>{ref}</Link>;
  }
  return <span className="mono">{ref}</span>;
}

function UserDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { role, online, showToast } = useStore();
  const [tab, setTab] = useState<Tab>("ledger");
  const [ledger, setLedger] = useState<UserLedger | null>(null);
  const [ents, setEnts] = useState<{ episode_id: string; source: string; created_at: string }[] | null>(null);
  const [timeline, setTimeline] = useState<{ ts: string; kind: string; type: string; detail: string; net: number }[] | null>(null);
  const [confirmErase, setConfirmErase] = useState("");
  const [busyTx, setBusyTx] = useState("");

  const loadLedger = useCallback(() => {
    void api.getUserLedger(user.id).then(setLedger);
  }, [user.id]);

  const [devices, setDevices] = useState<
    { ua: string; ip: string; first_seen: string; last_seen: string }[] | null>(null);

  useEffect(() => {
    loadLedger();
    void api.getEntitlements(user.id).then((r) => setEnts(r.entitlements));
    void api.getTimeline(user.id).then((r) => setTimeline(r.events));
    void api.listDevices(user.id).then((r) => setDevices(r.devices));
  }, [user.id, loadLedger]);

  async function signOutAll() {
    const res = await mutate.signoutDevices(user.id);
    if ("offline" in res) return showToast("Offline — nothing signed out", "error");
    if (res.error) return showToast(`Not signed out: ${res.error}`, "error");
    showToast("All devices signed out — every existing token is now invalid");
  }

  // Running balance, oldest → newest, rendered newest first (#024).
  const rows = useMemo(() => {
    if (!ledger) return [];
    const asc = [...ledger.transactions];
    let bal = 0;
    const withBal = asc.map((t) => {
      bal += t.amount_bought + t.amount_bonus;
      return { ...t, running: bal };
    });
    return withBal.reverse();
  }, [ledger]);

  async function refund(t: LedgerTxn) {
    if (busyTx) return;
    setBusyTx(t.id);
    const res = await mutate.refund(user.id, t.id);
    setBusyTx("");
    if ("offline" in res) return showToast("Offline — refund not sent", "error");
    if (res.error) return showToast(`Refund failed: ${res.error}`, "error");
    showToast(`Refunded ${fmtN(Number(res.coins))} coins against ${t.reference_id}`);
    loadLedger();
  }

  async function exportData() {
    const bundle = await api.exportUser(user.id);
    if (!bundle) return showToast("Export needs the server (admin role)", "error");
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${user.id}-export.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("Export downloaded · action audited");
  }

  async function erase() {
    const res = await mutate.erase(user.id);
    if ("offline" in res) return showToast("Offline — nothing erased", "error");
    if (res.error) return showToast(`Erase failed: ${res.error}`, "error");
    showToast("PII scrubbed · ledger retained · audited");
    onClose();
  }

  return (
    <Modal
      title={`Ledger · ${user.id}`}
      onClose={onClose}
      wide
      footer={<button className="btn s" onClick={onClose}>Close</button>}
    >
      <div className="tabs" role="tablist">
        {(["ledger", "entitlements", "timeline", "devices", "data"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t}
                  className={tab === t ? "tab on" : "tab"} onClick={() => setTab(t)}>
            {t === "data" ? "Data & erasure" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "ledger" ? (
        ledger === null ? (
          <Skeleton />
        ) : rows.length === 0 ? (
          <p className="tiny">No ledger entries for this user yet.</p>
        ) : (
          <div className="tablewrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th><th>Type</th><th>Reference</th>
                <th style={{ textAlign: "right" }}>Coins</th>
                <th style={{ textAlign: "right" }}>Balance</th>
                <th aria-label="actions"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const net = t.amount_bought + t.amount_bonus;
                return (
                  <tr key={t.id}>
                    <td><IsoTime iso={t.created_at} /></td>
                    <td>{t.type}</td>
                    <td><RefLink txn={t} onClose={onClose} /></td>
                    <td style={{ textAlign: "right" }} className="mono">
                      {net > 0 ? `+${fmtN(net)}` : fmtN(net)}
                    </td>
                    <td style={{ textAlign: "right" }} className="mono">{fmtN(t.running)}</td>
                    <td>
                      {t.type === "purchase" && canAct(role, "support,finance") ? (
                        <button className="btn s" disabled={!online || busyTx === t.id}
                                onClick={() => void refund(t)}>
                          {busyTx === t.id ? "…" : "Refund"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )
      ) : null}

      {tab === "entitlements" ? (
        ents === null ? (
          <Skeleton />
        ) : ents.length === 0 ? (
          <p className="tiny">No unlocked episodes. Refunding a purchase claws its coins back.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Episode</th><th>Source</th><th>When</th></tr></thead>
            <tbody>
              {ents.map((e) => (
                <tr key={e.episode_id}>
                  <td className="mono">{e.episode_id}</td>
                  <td>{e.source}</td>
                  <td><IsoTime iso={e.created_at} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      ) : null}

      {tab === "timeline" ? (
        timeline === null ? (
          <Skeleton />
        ) : timeline.length === 0 ? (
          <p className="tiny">Nothing yet — purchases, unlocks and admin actions land here.</p>
        ) : (
          <ul className="tl">
            {timeline.map((e, i) => (
              <li key={i}>
                <IsoTime iso={e.ts} />
                <b> {e.type}</b>
                <span className="muted"> {e.detail}</span>
                {e.net !== 0 ? (
                  <span className="mono">{e.net > 0 ? ` +${e.net}` : ` ${e.net}`}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "devices" ? (
        devices === null ? (
          <Skeleton />
        ) : (
          <>
            {devices.length === 0 ? (
              <p className="tiny">No devices observed yet — rows appear with
                authenticated traffic.</p>
            ) : (
              <table className="table">
                <thead><tr><th>Device</th><th>IP</th><th>First seen</th><th>Last seen</th></tr></thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.ua + d.first_seen}>
                      <td className="mono" title={d.ua}>{d.ua.slice(0, 42)}</td>
                      <td className="mono">{d.ip}</td>
                      <td><IsoTime iso={d.first_seen} /></td>
                      <td><IsoTime iso={d.last_seen} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="tiny muted">
              Tokens are stateless, so sign-out works account-wide: every token
              issued before now stops validating on the next request.
            </p>
            <button className="btn danger" disabled={!online || !canAct(role, "support")}
                    onClick={() => void signOutAll()}>
              Sign out all devices
            </button>
          </>
        )
      ) : null}

      {tab === "data" ? (
        <>
          <p className="tiny">
            DPDP tools: export everything we hold, or scrub PII while the money ledger
            (a legal record) is retained. Both actions are audited. Admin only.
          </p>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <button className="btn s" onClick={() => void exportData()}>Export data (JSON)</button>
          </div>
          <label>
            Type <b>{user.id}</b> to enable erasure
            <input value={confirmErase} onChange={(e) => setConfirmErase(e.target.value)}
                   placeholder={user.id} />
          </label>
          <button className="btn danger" disabled={confirmErase !== user.id || !online}
                  onClick={() => void erase()}>
            Erase personal data
          </button>
        </>
      ) : null}
    </Modal>
  );
}

export function Users() {
  const { role } = useStore();
  const [params] = useSearchParams();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(params.get("sort") ?? "recent");
  const [segment, setSegment] = useState(params.get("segment") ?? "");
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [adjustFor, setAdjustFor] = useState<AdminUser | null>(null);
  const [ledgerFor, setLedgerFor] = useState<AdminUser | null>(null);
  const debounce = useRef<number>(0);
  // Sequence guard: a slow answer for "me" must not overwrite results for
  // "meera", and "Load more" must not append a page from a previous filter.
  const seq = useRef(0);

  const load = useCallback(async (offset = 0) => {
    const my = ++seq.current;
    const page = await api.listUsers({ q, sort, segment, offset, limit: 50 });
    if (my !== seq.current) return;
    setTotal(page.total);
    setUsers((prev) => (offset === 0 ? page.users : [...(prev ?? []), ...page.users]));
    if (offset === 0) {
      const want = params.get("sel");
      setSelected(page.users.find((u) => u.id === want) ?? page.users[0] ?? null);
    }
  }, [q, sort, segment, params]);

  useEffect(() => {
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void load(0), 250);
    return () => window.clearTimeout(debounce.current);
  }, [load]);

  const maskPii = role === "finance";     // preview parity with the server's masking

  return (
    <>
      <PageHeader
        title="Users & wallet"
        subtitle="Look up by phone, Apple id, device or user id. Money actions need a reason code; above 500 coins they need a second approver."
      />

      {/* detailfirst: below 1100px the wallet moves above the 50-row lookup so
          selecting a user changes something you can see (ADM-34). */}
      <div className="split detailfirst">
        <div className="panel">
          <header>
            <h3>Lookup</h3>
            <span className="muted">{fmtN(total)} result{total === 1 ? "" : "s"}</span>
          </header>
          <div className="lk">
            <input
              placeholder="Phone, user id, name or device…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search users"
            />
          </div>
          <div className="frow" style={{ padding: "0 14px 8px" }}>
            <label>
              Sort
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="recent">Last active</option>
                <option value="balance">Balance</option>
                <option value="unlocked">Episodes unlocked</option>
              </select>
            </label>
            <label>
              Segment
              <select value={segment} onChange={(e) => setSegment(e.target.value)}>
                <option value="">Everyone</option>
                <option value="payers">Payers</option>
                <option value="members">Members</option>
                <option value="guests">Guests</option>
              </select>
            </label>
          </div>
          {users === null ? (
            <Skeleton rows={5} />
          ) : users.length === 0 ? (
            <Empty title="No matches" hint="Try a shorter query — search covers user id and phone." />
          ) : (
            <>
              <table className="table users">
                <thead>
                  <tr><th>User</th><th>Languages</th>
                      <th style={{ textAlign: "right" }}>Balance</th><th>Last active</th></tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}
                        tabIndex={0}
                        className={selected?.id === u.id ? "sel" : ""}
                        onClick={() => setSelected(u)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelected(u);
                          }
                        }}>
                      <td>
                        <b>{u.name !== "—" ? u.name : u.id}</b>
                        <small className="muted">
                          {" "}({u.payer === "—" ? "guest" : u.payer})
                          {/* the id is already the heading when there is no name */}
                          {u.name !== "—" ? ` · ${u.id}` : ""}
                        </small>
                        {u.flags.length > 0 ? (
                          <span style={{ display: "block", marginTop: 2 }}>
                            {u.flags.map((f) => (
                              <span key={f} className="sev sev-warn"
                                    style={{ marginRight: 6 }}>{f}</span>
                            ))}
                          </span>
                        ) : null}
                      </td>
                      <td>{u.languages}</td>
                      <td style={{ textAlign: "right" }} className="mono">
                        {fmtN(u.wallet.bought + u.wallet.bonus)}
                      </td>
                      <td>{typeof u.lastActive === "string" && u.lastActive.includes("T")
                        ? <IsoTime iso={u.lastActive} /> : u.lastActive}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length < total ? (
                <button className="btn s" style={{ margin: 12 }}
                        onClick={() => void load(users.length)}>
                  Load more ({fmtN(total - users.length)} left)
                </button>
              ) : null}
            </>
          )}
        </div>

        <div className="panel">
          <header><h3>Wallet &amp; account</h3></header>
          {selected ? (
            <div className="acct">
              <div className="coinrow">
                <div className="coinbox">
                  <div className="tiny">Bought coins</div>
                  <div className="n">{fmtN(selected.wallet.bought)}</div>
                </div>
                <div className="coinbox">
                  <div className="tiny">Bonus coins</div>
                  <div className="n">{fmtN(selected.wallet.bonus)}</div>
                </div>
                <div className="coinbox">
                  <div className="tiny">Episodes unlocked</div>
                  <div className="n">{fmtN(selected.wallet.unlocked)}</div>
                </div>
              </div>
              <p className="tiny" style={{ margin: "10px 0 16px" }}>
                Bonus coins are spent before bought coins. Coins never expire.
              </p>
              <dl className="kv">
                <dt>User id</dt>
                <dd className="mono">{selected.id}</dd>
                <dt>Phone</dt>
                <dd>{maskPii ? "•••• masked (finance)" : selected.phone}</dd>
                <dt>LTV</dt>
                <dd>{selected.wallet.ltv}</dd>
                <dt>Last active</dt>
                <dd>{typeof selected.lastActive === "string" && selected.lastActive.includes("T")
                  ? <IsoTime iso={selected.lastActive} /> : selected.lastActive}</dd>
                <dt>Payer</dt>
                <dd>{selected.payer}</dd>
              </dl>
              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button className="btn p" onClick={() => setAdjustFor(selected)}>
                  Adjust coins…
                </button>
                <button className="btn s" onClick={() => setLedgerFor(selected)}>
                  View ledger
                </button>
              </div>
            </div>
          ) : (
            <Empty title="Select a user" hint="Pick a result to see their wallet." />
          )}
        </div>
      </div>

      {adjustFor ? (
        <AdjustDialog user={adjustFor} onClose={() => setAdjustFor(null)}
                      onApplied={() => void load(0)} />
      ) : null}
      {ledgerFor ? <UserDialog user={ledgerFor} onClose={() => setLedgerFor(null)} /> : null}
    </>
  );
}
