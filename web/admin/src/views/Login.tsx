import { useState } from "react";
import { useStore } from "../store";

/** The callback leaves failure notices in a 60s cookie — the SPA is
 *  hash-routed so fragments get eaten, and query strings would put the email
 *  in server logs. Read once, then clear. */
export function readAuthNote(): { kind: string; detail: string } | null {
  const raw = document.cookie.split("; ")
    .find((c) => c.startsWith("katha_admin_auth_note="));
  if (!raw) return null;
  document.cookie = "katha_admin_auth_note=; max-age=0; path=/";
  const val = decodeURIComponent(raw.split("=").slice(1).join("="));
  const i = val.indexOf(":");
  if (i < 0) return { kind: val, detail: "" };
  return { kind: val.slice(0, i), detail: val.slice(i + 1) };
}

export function Login() {
  const { identity, online } = useStore();
  const [notice] = useState(readAuthNote);
  const loginUrl = identity?.login ?? "/admin/v1/auth/login";

  return (
    <div className="loginwrap">
      <div className="logincard">
        <div className="brand" style={{ padding: 0, marginBottom: 14 }}>
          <span className="logo">▶</span>
          Katha Admin
        </div>
        <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Sign in to the back office</h1>
        <p className="muted" style={{ margin: "0 0 18px" }}>
          Access is tied to your identity — your role is decided by the server,
          and every action you take is recorded in the audit log.
        </p>

        {notice?.kind === "not_provisioned" ? (
          <div className="loginnote err" role="alert">
            <b>{notice.detail || "Your account"}</b> signed in fine but isn't
            provisioned for this panel. Ask an admin to add you under
            Roles &amp; access.
          </div>
        ) : null}
        {notice?.kind === "error" ? (
          <div className="loginnote err" role="alert">
            Sign-in failed: {notice.detail || "unknown error"}. Try again.
          </div>
        ) : null}
        {!online ? (
          <div className="loginnote">
            The admin server is unreachable right now — sign-in needs it up.
          </div>
        ) : null}

        <a className="btn big signin" href={loginUrl}>
          {identity?.devIdp ? "Sign in · dev identity provider" : "Sign in with Google"}
        </a>
        {identity?.devIdp ? (
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Dev IdP is active because no OIDC issuer is configured. Point
            KATHA_OIDC_ISSUER at Google Workspace for production sign-in.
          </p>
        ) : null}
      </div>
    </div>
  );
}
