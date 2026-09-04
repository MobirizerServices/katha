"use client";
import { useState } from "react";
import { useWallet } from "./WalletProvider";

export const PARTNERS_EMAIL = "partners@katha.example";
const KINDS = ["Studio or production house", "Brand or agency", "Creator", "Distributor or rights holder", "Something else"];

/** Build the mailto: link the pitch form opens — the form has no server of
 * its own yet, so the message travels in the viewer's mail app. */
export function pitchMailto(f: { name: string; company: string; email: string; kind: string; msg: string }): string {
  const subject = `Pitch from ${f.name}${f.company ? ` (${f.company})` : ""} — ${f.kind}`;
  const body = `${f.msg}\n\n—\n${f.name}\n${f.company}\n${f.email}`;
  return `mailto:${PARTNERS_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** "Tell us what you want to make": studios, brands and creators use one form. */
export default function PitchForm() {
  const w = useWallet();
  const [f, setF] = useState({ name: "", company: "", email: "", kind: KINDS[0], msg: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!f.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) {
      setError("Your name and a working email are needed so we can reply.");
      return;
    }
    setError(null);
    window.location.href = pitchMailto({ ...f, name: f.name.trim(), email: f.email.trim() });
    w.toast(`Opening your mail app — or write to ${PARTNERS_EMAIL}`);
  };

  return (
    <form className="formgrid" id="pitchform" noValidate onSubmit={submit} aria-label="Tell us what you want to make">
      <label className="field">
        Your name
        <input type="text" name="name" required autoComplete="name" value={f.name} onChange={set("name")} />
      </label>
      <label className="field">
        Company or channel
        <input type="text" name="company" autoComplete="organization" value={f.company} onChange={set("company")} />
      </label>
      <label className="field">
        Email
        <input type="email" name="email" required autoComplete="email" value={f.email} onChange={set("email")} />
      </label>
      <label className="field">
        You are a
        <select name="kind" value={f.kind} onChange={set("kind")}>
          {KINDS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label className="field full">
        What do you have in mind?
        <textarea
          name="msg"
          value={f.msg}
          onChange={set("msg")}
          placeholder="A premise, a brand brief, a catalogue, your channel — a few lines is enough."
        />
      </label>
      {error && (
        <p className="full" role="alert" style={{ color: "var(--danger, #e5484d)", fontSize: 13, margin: 0 }}>
          {error}
        </p>
      )}
      <div className="field full" style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <span>
          Or write to <a href={`mailto:${PARTNERS_EMAIL}`}>{PARTNERS_EMAIL}</a>
        </span>
        <button className="btn p" type="submit">
          Send
        </button>
      </div>
    </form>
  );
}
