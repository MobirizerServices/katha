import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, mutate } from "../api/client";
import type { Policy } from "../api/client";
import { Modal, PageHeader, fmtINR, fmtN } from "../ui";
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
  const { flags, toggleFlag, role, online, showToast } = useStore();
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

  useEffect(() => {
    void api.policy().then((p) => {
      setPolicy(p);
      setMinVer(p.min_app_version);
    });
    void api.packs().then(setPacks);
  }, []);

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
              <span className="muted tiny">prod</span>
              <button
                role="switch"
                aria-checked={f.enabled}
                aria-label={`${f.key} ${f.enabled ? "on" : "off"}`}
                className={f.enabled ? "sw on" : "sw"}
                disabled={!mayFlag}
                onClick={() => void flip(f.key, f.guarded)}
              >
                <i />
              </button>
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
