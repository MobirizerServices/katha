import { PageHeader } from "../ui";
import { useStore } from "../store";
import { canAct } from "../auth/roles";
import { MOCK_PACKS } from "../api/mock";

export function Config() {
  const { flags, toggleFlag, role } = useStore();
  const mayFlag = canAct(role, "content"); // content ops + admin toggle flags

  return (
    <>
      <PageHeader
        title="Config & experiments"
        subtitle={
          <>
            Everything here reaches the app through <span className="mono">GET /v1/config</span>{" "}
            within 5 minutes. Every change is audited and reversible.
          </>
        }
        actions={<button className="btn s">Version history</button>}
      />

      <div className="panel">
        <h3>
          Feature flags
          <span className="sub">{flags.length} flags · prod</span>
        </h3>
        <div className="alerts">
          {flags.map((f) => (
            <div className="alert" key={f.key} style={{ alignItems: "center" }}>
              <span className="mono" style={{ minWidth: 250, fontWeight: 600 }}>
                {f.key}
              </span>
              <span className="muted" style={{ flex: 1, fontSize: 13 }}>
                {f.description}
              </span>
              <span className="tag">{f.env}</span>
              <button
                className="tog"
                role="switch"
                aria-checked={f.enabled}
                aria-label={`Toggle ${f.key}`}
                disabled={!mayFlag}
                onClick={() => toggleFlag(f.key)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>
          Coin packs
          <span className="sub">SKUs · IN storefront + web (UPI)</span>
        </h3>
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Storefront</th>
                <th className="num">Price</th>
                <th className="num">Coins</th>
                <th>Bonus</th>
                <th>Offer</th>
              </tr>
            </thead>
            <tbody>
              {MOCK_PACKS.map((p) => (
                <tr key={p[0]}>
                  <td>
                    <span className="mono">{p[0]}</span>
                  </td>
                  <td>{p[1]}</td>
                  <td className="num">{p[2]}</td>
                  <td className="num">{p[3]}</td>
                  <td>{p[4]}</td>
                  <td>{p[5]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny" style={{ padding: "10px 16px" }}>
          First 10 episodes free, then 30 coins each (~₹4.5). Series bundle unlocks all remaining
          locked episodes at a 25% discount. Web store adds +10% bonus coins.
        </p>
      </div>
    </>
  );
}
