import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/** A poster card for one series (browse, search, my list). The poster links
 * to the series page; `actions` render below it so buttons never nest inside
 * the link. */
export default function SeriesCard({
  slug,
  title,
  meta,
  cover,
  c1,
  c2,
  badge,
  actions,
}: {
  slug: string;
  title: string;
  meta: string;
  cover: string;
  c1?: string;
  c2?: string;
  badge?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="pcard" data-testid={`card-${slug}`}>
      <Link href={`/series/${slug}`} aria-label={title}>
        <div
          className="poster"
          style={{
            "--c1": c1 ?? "#1D1A2F",
            "--c2": c2 ?? "#6C4AB6",
            backgroundImage: `linear-gradient(to top, rgba(0,0,0,.7), transparent 55%), url(${cover})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          } as CSSProperties}
        >
          {badge && <span className="badge">{badge}</span>}
          <span className="t">{title}</span>
        </div>
      </Link>
      <div className="m">
        <b>{title}</b>
        {meta}
      </div>
      {actions && <div className="cardactions">{actions}</div>}
    </div>
  );
}
