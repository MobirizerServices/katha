import { useEffect, useRef, useState } from "react";
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
  wide,
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  /** 820px instead of 520px — for dialogs that carry a table. */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={wide ? "modal wide" : "modal"} role="dialog" aria-modal="true"
           aria-label={title} tabIndex={-1} ref={ref}>
        <h2>{title}</h2>
        <div className="mb">{children}</div>
        <div className="mf">{footer}</div>
      </div>
    </>
  );
}


/** Rupees with up to two decimals (paise) — ₹0.15 per coin, ₹99.99 — never
 *  rounded to a tenth. */
export function fmtINR(rupees: number): string {
  return "₹" + Number(rupees).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Humanized time from an ISO string, full stamp on hover (#094). */
export function IsoTime({ iso }: { iso: string }) {
  if (!iso) return <span className="muted">—</span>;
  const t = Date.parse(iso);
  return (
    <span title={iso} className="mono">
      {Number.isNaN(t) ? iso : ago(t)}
    </span>
  );
}

/** Click-to-copy id chip (#090). */
export function CopyId({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copyid mono"
      title={value}
      aria-label={`Copy ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).catch(() => {});
        setDone(true);
        window.setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? "copied" : value}
    </button>
  );
}

/** 30-day sparkline (#015): plain canvas, no library. */
export function Spark({ points, width = 120, height = 28 }:
                      { points: number[]; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = el?.getContext("2d") ?? null;   // jsdom throws instead of null
    } catch {
      return;
    }
    if (!el || !ctx || points.length < 2) return;
    const max = Math.max(...points, 1);
    const min = Math.min(...points, 0);
    const span = max - min || 1;
    const dpr = window.devicePixelRatio || 1;
    el.width = width * dpr;
    el.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    const x = (i: number) => (i / (points.length - 1)) * (width - 2) + 1;
    const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
    ctx.beginPath();
    points.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
    ctx.strokeStyle = "rgba(246,84,44,.9)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(x(points.length - 1), height);
    ctx.lineTo(x(0), height);
    ctx.closePath();
    ctx.fillStyle = "rgba(246,84,44,.12)";
    ctx.fill();
    ctx.beginPath();                                   // emphasized endpoint
    ctx.arc(x(points.length - 1), y(points[points.length - 1]), 2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(246,84,44,1)";
    ctx.fill();
  }, [points, width, height]);
  // A line with no scale is decoration: say what the low, high and latest
  // values are so the shape can actually be read (ADM-29).
  const lo = points.length ? Math.min(...points) : 0;
  const hi = points.length ? Math.max(...points) : 0;
  const last = points.length ? points[points.length - 1] : 0;
  return (
    <span className="spark">
      <canvas ref={ref} style={{ width, height }} aria-hidden="true" />
      <span className="cap">
        {fmtN(lo)}–{fmtN(hi)} · now {fmtN(last)}
      </span>
    </span>
  );
}


export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div className="sk-row" key={i} />
      ))}
    </div>
  );
}

/** One empty-state pattern everywhere (#089): explain the feature, not the void. */
export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="empty">
      <h4>{title}</h4>
      <p>{hint}</p>
    </div>
  );
}

/** Severity chip used by attention items and SLA badges. */
export function Sev({ level, children }: { level: "danger" | "warn" | "info" | "ok";
                                            children: ReactNode }) {
  return <span className={`sev sev-${level}`}>{children}</span>;
}

// ---- business-board pieces shared by Overview (compact), Analytics and Finance
/** Period-over-period change. */
export function Delta({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return cur ? <span className="delta">new</span> : null;
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return <span className="delta muted">±0%</span>;
  return (
    <span className={pct < 0 ? "delta down" : "delta"}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

/** One business metric with its period delta + optional 30-day sparkline. */
export function Metric({ label, value, cur, prev, spark }:
                       { label: string; value: string; cur: number; prev: number;
                         spark?: number[] }) {
  return (
    <div className="kpi">
      <div className="lbl">{label}</div>
      <div className="val">{value}</div>
      <Delta cur={cur} prev={prev} />
      {spark ? <div style={{ marginTop: 6 }}><Spark points={spark} /></div> : null}
    </div>
  );
}

export function Funnel({ f }: { f: { paywall_view: number; purchase: number; unlock: number } }) {
  const stages = [
    { label: "Saw the paywall", n: f.paywall_view },
    { label: "Bought coins", n: f.purchase },
    { label: "Unlocked an episode", n: f.unlock },
  ];
  const max = Math.max(f.paywall_view, 1);
  return (
    <div className="funnel">
      {stages.map((s, i) => {
        const prev = i === 0 ? s.n : stages[i - 1].n;
        const drop = i > 0 && prev > 0
          ? ` · ${Math.round(((prev - s.n) / prev) * 100)}% drop`
          : "";
        return (
          <div key={s.label} className="fstage">
            <div className="fbar" style={{ width: `${(s.n / max) * 100}%` }} />
            <span>{s.label}</span>
            <b className="mono">{fmtN(s.n)}{drop}</b>
          </div>
        );
      })}
    </div>
  );
}

/** Filter chip (selected = accent tint + border), per the design system. */
export function Chip({ on, onClick, children }:
                     { on?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className={on ? "chip on" : "chip"} onClick={onClick}
            aria-pressed={!!on}>
      {children}
    </button>
  );
}
