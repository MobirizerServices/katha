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
            <Link href="/browse">Browse series</Link>
            <Link href="/search">Search</Link>
            <Link href="/#how">How coins work</Link>
            <Link href="/coins">Get coins</Link>
            <span className="pending">Careers — not hiring yet</span>
            <span className="pending">Press — press@katha.example</span>
          </div>
          <div>
            <h4>Work with us</h4>
            <Link href="/#business">For studios &amp; brands</Link>
            <Link href="/#creators">Creators</Link>
            <Link href="/#brands">Brands and agencies</Link>
            <Link href="/#pitch">Tell us what you want to make</Link>
          </div>
          <div>
            <h4>Legal</h4>
            {/* None of these documents is published yet. A link to "#" reads as
                live and goes nowhere, so each stays plain text until the page
                behind it exists; the two that DO have a destination link to it. */}
            <span className="pending">Terms of Use</span>
            <span className="pending">Privacy Notice (DPDP)</span>
            <span className="pending">Refund &amp; Cancellation Policy</span>
            <Link href="/#faq">Content ratings &amp; parental controls</Link>
            <span className="pending">Report content — grievance@katha.example</span>
            <p className="pendingnote">
              These policies are drafted but not published; the pages go live with the app.
            </p>
          </div>
          <div>
            <h4>Help and grievances</h4>
            <div className="griev">
              <b>Support:</b> help@katha.example · in-app chat, 9 am–9 pm IST
              <br />
              <b>Grievance officer:</b> to be appointed before launch
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
            © 2026 Katha. Company name and registration are placeholders until incorporation completes.
            All series, characters and people shown are fictional. Prices include GST. Refunds on unused,
            unspent web coins within 7 days.
          </span>
          <span>English · हिन्दी · தமிழ் · తెలుగు</span>
        </div>
      </div>
    </footer>
  );
}
