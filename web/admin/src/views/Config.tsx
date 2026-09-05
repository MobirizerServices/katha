import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mutate } from "../api/client";
import type { Experiment, Policy } from "../api/client";
import { Modal, PageHeader, Sev, fmtINR, fmtN } from "../ui";
import { useStore } from "../store";
import { canAct } from "../auth/roles";

interface PackRow {
  sku: string;
  storefront: string;
  price_minor: number;
  currency: string;
  coins: number;
  bonus: number;
}

export function Config() {
  const { flags, toggleFlag, setFlagPct, role, online, showToast } = useStore();
  const mayFlag = canAct(role, "content");
  const mayFinance = canAct(role, "finance");
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [guardKey, setGuardKey] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [editPack, setEditPack] = useState<PackRow | null>(null);
  const [packTyped, setPackTyped] = useState("");
  const [packFields, setPackFields] = useState({ price_minor: 0, coins: 0, bonus: 0 });
  const [minVer, setMinVer] = useState("");
  const [rampKey, setRampKey] = useState<string | null>(null);
  const [rampPct, setRampPct] = useState(100);
  const [exps, setExps] = useState<Experiment[]>([]);
  const [expOpen, setExpOpen] = useState(false);
  const [expForm, setExpForm] = useState({ key: "", hypothesis: "",
                                          variants: "control:50,treatment:50" });

  useEffect(() => {
    void api.policy().then((p) => {
      setPolicy(p);
      setMinVer(p.min_app_version);
    });
    void api.packs().then(setPacks);
    void api.listExperiments().then((r) => setExps(r.experiments));
  }, []);

  async function saveRamp() {
    if (!rampKey) return;
    const flag = flags.find((f) => f.key === rampKey);
    const res = await setFlagPct(rampKey, rampPct,
                                 flag?.guarded ? rampKey : undefined);
    if (!("offline" in res) && !res.error) {
      showToast(`${rampKey} → ${rampPct}% of users`);
    }
    setRampKey(null);
  }

  async function saveExperiment(status: "running" | "stopped", key?: string,
                                variants?: { name: string; pct: number }[]) {
    const k = key ?? expForm.key.trim();
    const vars = variants ?? expForm.variants.split(",").map((part) => {
      const [name, pct] = part.split(":");
      return { name: (name ?? "").trim(), pct: Number(pct ?? 0) };
    });
    const res = await mutate.setExperiment(k, {
      hypothesis: expForm.hypothesis, variants: vars, status,
    });
    if ("offline" in res) return showToast("Offline — experiment unchanged", "error");
    if (res.error) return showToast(`Experiment not saved: ${res.error}`, "error");
    showToast(status === "running"
      ? `${k} running — assignments serve in /v1/config now`
      : `${k} stopped`);
    setExpOpen(false);
    setExps((await api.listExperiments()).experiments);
  }

  async function flip(key: string, guarded?: boolean) {
    if (guarded) {
      setGuardKey(key);
      setTyped("");
      return;
    }
    await toggleFlag(key);
  }

  async function confirmGuarded() {
    if (!guardKey || typed !== guardKey) return;
    await toggleFlag(guardKey, guardKey);
    setGuardKey(null);
  }

  async function savePack() {
    if (!editPack || packTyped !== editPack.sku) return;
    const res = await mutate.setPack(editPack.sku, packFields);
    if ("offline" in res) return showToast("Offline — pack unchanged", "error");
    if (res.error) return showToast(`Pack not changed: ${res.error}`, "error");
    showToast(`${editPack.sku} updated · core-api sells the new values now`);
    setEditPack(null);
    setPacks(await api.packs());
  }

  async function saveMinVersion() {
    const res = await mutate.setMinVersion(minVer.trim());
    if ("offline" in res) return showToast("Offline — value unchanged", "error");
    if (res.error) return showToast(`Not saved: ${res.error}`, "error");
    showToast(`Minimum app version → ${minVer.trim()}`);
  }

  return (
    <>
      <PageHeader
        title="Config & experiments"
        subtitle={
          <>
            Everything here reaches the app through <code>GET /v1/config</code> on its next
            request. Every change is audited and reversible.
          </>
        }
        actions={
          <Link className="btn s" to="/audit?q=config.">
            Version history
          </Link>
        }
      />

      <section className="panel">
        <header>
          <h3>Feature flags</h3>
          <span className="muted">{flags.length} flags · prod</span>
        </header>
        <ul className="flags">
          {flags.map((f) => (
            <li key={f.key}>
              <div style={{ flex: 1 }}>
                <code>{f.key}</code>
                {f.guarded ? <span className="sev sev-warn" title="Needs a typed confirmation"> guarded</span> : null}
                <div className="muted">{f.description}</div>
                {f.owner ? (
                  <div className="tiny muted">owner: {f.owner} · review by {f.review_by}</div>
                ) : null}
              </div>
              {typeof f.pct === "number" && f.pct < 100 ? (
                <Sev level="warn">{f.pct}%</Sev>
              ) : null}
              <button className="btn s" disabled={!mayFlag || !online}
                      onClick={() => { setRampKey(f.key); setRampPct(f.pct ?? 100); }}>
                Ramp…
              </button>
              {/* `tog` is the design system's switch (Components → Form
                  fields); the old `sw` class had no CSS at all. */}
              <button
                type="button"
                role="switch"
                aria-checked={f.enabled}
                aria-label={`${f.key} ${f.enabled ? "on" : "off"}`}
                className="tog"
                disabled={!mayFlag}
                onClick={() => void flip(f.key, f.guarded)}
              />
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <header><h3>Values</h3><span className="muted">typed config</span></header>
        <div className="acct">
          <label>
            Minimum app version (force update below this)
            <span style={{ display: "flex", gap: 8 }}>
              <input value={minVer} onChange={(e) => setMinVer(e.target.value)}
                     style={{ maxWidth: 160 }} />
              <button className="btn s" disabled={!canAct(role, "") || !online || !minVer.trim()}
                      onClick={() => void saveMinVersion()}>
                Save
              </button>
            </span>
          </label>
          {policy ? (
            <dl className="kv" style={{ marginTop: 12 }}>
              <dt>Pricing profile</dt>
              <dd>
                first {policy.pricing.free_episode_count} free ·{" "}
                {policy.pricing.episode_coin_price} coins/episode · bundle −
                {policy.pricing.bundle_discount_pct}%
              </dd>
              <dt>Dual approval above</dt>
              <dd>{fmtN(policy.dual_approval_threshold)} coins</dd>
              <dt>Coin value</dt>
              <dd>{fmtINR(policy.coin_rupee_rate)} per coin</dd>
            </dl>
          ) : null}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <header>
          <h3>Coin packs</h3>
          <span className="muted">SKUs · IN storefront + web (UPI)</span>
        </header>
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th><th>Storefront</th><th style={{ textAlign: "right" }}>Price</th>
              <th style={{ textAlign: "right" }}>Coins</th>
              <th style={{ textAlign: "right" }}>Bonus</th><th aria-label="edit"></th>
            </tr>
          </thead>
          <tbody>
            {packs.map((p) => (
              <tr key={p.sku}>
                <td className="mono">{p.sku}</td>
                <td>{p.storefront}</td>
                <td style={{ textAlign: "right" }}>{fmtINR(p.price_minor / 100)}</td>
                <td style={{ textAlign: "right" }} className="mono">{fmtN(p.coins)}</td>
                <td style={{ textAlign: "right" }} className="mono">
                  {p.bonus ? `+${fmtN(p.bonus)}` : "—"}
                </td>
                <td>
                  <button className="btn s" disabled={!mayFinance || !online}
                          onClick={() => {
                            setEditPack(p);
                            setPackTyped("");
                            setPackFields({ price_minor: p.price_minor, coins: p.coins,
                                            bonus: p.bonus });
                          }}>
                    Edit…
                  </button>
                </td>
              </tr>
            ))}
            {packs.length === 0 ? (
              <tr><td colSpan={6} className="muted">Pack list needs the server.</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <header>
          <h3>Experiments</h3>
          <span className="muted">
            assignments by stable user hash · served in /v1/config
          </span>
        </header>
        {exps.length === 0 ? (
          <p className="tiny muted" style={{ padding: "12px 14px" }}>
            No experiments registered. The classic first test: 8 vs 10 vs 12
            free episodes.
          </p>
        ) : (
          <table className="table">
            <thead><tr><th>Key</th><th>Hypothesis</th><th>Variants</th>
                       <th>Status</th><th aria-label="actions"></th></tr></thead>
            <tbody>
              {exps.map((x) => (
                <tr key={x.key}>
                  <td className="mono">{x.key}</td>
                  <td className="tiny">{x.hypothesis || "—"}</td>
                  <td className="tiny mono">
                    {x.variants.map((v) => `${v.name} ${v.pct}%`).join(" · ")}
                  </td>
                  <td><Sev level={x.status === "running" ? "ok" : "info"}>{x.status}</Sev></td>
                  <td style={{ textAlign: "right" }}>
                    {x.status === "running" ? (
                      <button className="btn s" disabled={!mayFlag || !online}
                              onClick={() => void saveExperiment("stopped", x.key, x.variants)}>
                        Stop
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ padding: "0 14px 14px" }}>
          <button className="btn s" disabled={!mayFlag || !online}
                  onClick={() => setExpOpen(true)}>
            New experiment…
          </button>
        </div>
      </section>

      {rampKey ? (
        <Modal title={`Rollout · ${rampKey}`} onClose={() => setRampKey(null)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setRampKey(null)}>Cancel</button>
                   <button className="btn p" onClick={() => void saveRamp()}>
                     Set rollout
                   </button>
                 </>
               }>
          <p className="tiny">
            Percentage rollout (#056): the flag reads true for a stable {rampPct}%
            of signed-in users. Anonymous callers only see it at 100%.
          </p>
          <label>
            Percent of users (0–100)
            <input type="number" min={0} max={100} value={rampPct}
                   aria-label="Rollout percent"
                   onChange={(e) => setRampPct(Number(e.target.value))} />
          </label>
        </Modal>
      ) : null}

      {expOpen ? (
        <Modal title="New experiment" onClose={() => setExpOpen(false)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setExpOpen(false)}>Cancel</button>
                   <button className="btn p" disabled={!expForm.key.trim()}
                           onClick={() => void saveExperiment("running")}>
                     Start running
                   </button>
                 </>
               }>
          <label>
            Key (a-z, 0-9, dots/hyphens)
            <input value={expForm.key} aria-label="Experiment key"
                   onChange={(e) => setExpForm({ ...expForm, key: e.target.value })}
                   placeholder="free-count" />
          </label>
          <label>
            Hypothesis
            <input value={expForm.hypothesis} aria-label="Hypothesis"
                   onChange={(e) => setExpForm({ ...expForm, hypothesis: e.target.value })}
                   placeholder="8 free episodes converts better than 10" />
          </label>
          <label>
            Variants (name:pct, comma-separated; ≤100 total)
            <input value={expForm.variants} aria-label="Variants"
                   onChange={(e) => setExpForm({ ...expForm, variants: e.target.value })} />
          </label>
        </Modal>
      ) : null}

      {guardKey ? (
        <Modal title={`Guarded flag · ${guardKey}`} onClose={() => setGuardKey(null)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setGuardKey(null)}>Cancel</button>
                   <button className="btn danger" disabled={typed !== guardKey}
                           onClick={() => void confirmGuarded()}>
                     Flip it
                   </button>
                 </>
               }>
          <p className="tiny">
            This switch changes money or safety behavior for every user instantly.
            Type the flag key to confirm.
          </p>
          <label>
            Flag key
            <input value={typed} onChange={(e) => setTyped(e.target.value)}
                   placeholder={guardKey} />
          </label>
        </Modal>
      ) : null}

      {editPack ? (
        <Modal title={`Edit pack · ${editPack.sku}`} onClose={() => setEditPack(null)}
               footer={
                 <>
                   <button className="btn s" onClick={() => setEditPack(null)}>Cancel</button>
                   <button className="btn p" disabled={packTyped !== editPack.sku}
                           onClick={() => void savePack()}>
                     Save pack
                   </button>
                 </>
               }>
          <div className="frow">
            <label>
              Price (paise)
              <input type="number" value={packFields.price_minor}
                     onChange={(e) => setPackFields({ ...packFields, price_minor: Number(e.target.value) })} />
            </label>
            <label>
              Coins
              <input type="number" value={packFields.coins}
                     onChange={(e) => setPackFields({ ...packFields, coins: Number(e.target.value) })} />
            </label>
            <label>
              Bonus
              <input type="number" value={packFields.bonus}
                     onChange={(e) => setPackFields({ ...packFields, bonus: Number(e.target.value) })} />
            </label>
          </div>
          <p className="tiny muted">
            Live immediately in the store and IAP verification. Type the SKU to confirm.
          </p>
          <label>
            SKU
            <input value={packTyped} onChange={(e) => setPackTyped(e.target.value)}
                   placeholder={editPack.sku} />
          </label>
        </Modal>
      ) : null}
    </>
  );
}
