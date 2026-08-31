import type { ReactNode } from "react";
import type { SeriesStatus } from "./api/types";

export function fmtN(n: number): string {
  return Number(n).toLocaleString("en-IN");
}

export function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export function tsLabel(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

const STATUS_LABEL: Record<SeriesStatus, string> = {
  live: "Live",
  sched: "Scheduled",
  qc: "In QC",
  draft: "Draft",
  arch: "Archived",
};

export function StatusBadge({ status }: { status: SeriesStatus }) {
  return <span className={`st st-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function PageHeader({
  title,
  subtitle,
  crumbs,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  crumbs?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      {crumbs ? <div className="crumbs">{crumbs}</div> : null}
      <div className="ph">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
    </>
  );
}

export function Poster({ i }: { i: number }) {
  const palettes = [
    ["#8A4A2F", "#41211A"],
    ["#2F5A8A", "#1A2A41"],
    ["#5A2F8A", "#2A1A41"],
    ["#2F8A5A", "#1A412A"],
    ["#8A2F5A", "#411A2A"],
    ["#8A7A2F", "#41371A"],
  ];
  const [c1, c2] = palettes[i % palettes.length];
  return (
    <div
      className="pos"
      style={{ ["--c1" as string]: c1, ["--c2" as string]: c2 }}
      aria-hidden
    />
  );
}

export function Modal({
  title,
  children,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="mb">{children}</div>
        <div className="mf">{footer}</div>
      </div>
    </>
  );
}
