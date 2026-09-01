import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { api } from "../api/client";
import { PageHeader } from "../ui";
import { PERMISSION_MATRIX, ROLE_NAMES, ROLE_ORDER } from "../auth/roles";
import type { MatrixRow } from "../auth/roles";

function cellStyle(v: string): CSSProperties {
  if (v === "yes") return { color: "var(--ok)", fontWeight: 700 };
  if (v === "no") return { color: "var(--text3)" };
  return { color: "var(--warn)", fontWeight: 600 };
}
function cellText(v: string): string {
  if (v === "yes") return "✓";
  if (v === "no") return "–";
  return v;
}

/** Server matrix → the render shape; falls back to the static copy offline. */
function fromServer(matrix: { capability: string; roles: string[];
                              notes?: Record<string, string> }[]): MatrixRow[] {
  return matrix.map((row) => ({
    cap: row.capability,
    cells: ROLE_ORDER.map((r) =>
      row.notes?.[r] ? row.notes[r] : row.roles.includes(r) ? "yes" : "no"),
  }));
}

export function Access() {
  const [rows, setRows] = useState<MatrixRow[]>(PERMISSION_MATRIX);
  const [live, setLive] = useState(false);

  useEffect(() => {
    void api.matrix().then((m) => {
      if (m) {
        setRows(fromServer(m.matrix));
        setLive(true);
      }
    });
  }, []);

  return (
    <>
      <PageHeader
        title="Roles & access"
        subtitle={
          live
            ? "Served by admin-api from the same table the routes enforce — this page cannot drift from reality."
            : "Google Workspace SSO with enforced 2FA. Roles map from IdP groups. Sensitive actions re-authenticate; money actions above thresholds need two people."
        }
      />
      <div className="panel">
        <h3>Permission matrix</h3>
        <div className="tablewrap">
          <table className="t">
            <thead>
              <tr>
                <th>Capability</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} style={{ textAlign: "center" }}>
                    {ROLE_NAMES[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.cap}>
                  <td>{row.cap}</td>
                  {row.cells.map((c, i) => (
                    <td key={i} style={{ textAlign: "center", ...cellStyle(c) }}>
                      {cellText(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
