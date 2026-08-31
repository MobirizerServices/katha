import Link from "next/link";

export default function SiteFooter() {
  return (
    <footer className="site">
      <div className="wrap">
        <div className="fgrid">
          <div>
            <Link className="brand" href="/" style={{ marginBottom: 12, display: "inline-flex" }}>
              <span className="appmark">▶</span>
              Katha<small>कथा</small>
            </Link>
            <p style={{ margin: 0, maxWidth: "34ch" }}>
              Micro-dramas in Indian languages. Two-minute episodes, no ads, pay only for what you watch.
              For viewers 18 and older.
            </p>
          </div>
          <div>
            <h4>Katha</h4>
            <Link href="/#series">Series</Link>
            <Link href="/#how">How coins work</Link>
            <Link href="/coins">Get coins</Link>
            <a href="#">Careers</a>
            <a href="#">Press</a>
          </div>
          <div>
            <h4>Legal</h4>
            <a href="#">Terms of Use</a>
            <a href="#">Privacy Notice (DPDP)</a>
            <a href="#">Refund &amp; Cancellation Policy</a>
            <a href="#">Content ratings &amp; parental controls</a>
            <a href="#">Report content</a>
          </div>
          <div>
            <h4>Help and grievances</h4>
            <div className="griev">
              <b>Support:</b> help@katha.example · in-app chat, 9 am–9 pm IST
              <br />
              <b>Grievance officer:</b> Name (to be appointed)
              <br />
              grievance@katha.example
              <br />
              Complaints are acknowledged within 24 hours and resolved within 15 days, as required under
              the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021.
            </div>
          </div>
        </div>
        <div className="fbot">
          <span>
            © 2026 Katha Media Private Limited (placeholder). All series, characters and people shown are
            fictional. Prices include GST. Refunds on unused, unspent web coins within 7 days.
          </span>
          <span>English · हिन्दी · தமிழ் · తెలుగు</span>
        </div>
      </div>
    </footer>
  );
}
