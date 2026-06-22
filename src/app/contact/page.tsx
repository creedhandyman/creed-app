import type { Metadata } from "next";
import MarketingShell from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "Contact · Creed Handy Manager",
  description: "Get in touch with the Creed Handy Manager team — support, questions, and demos.",
};

export default function ContactPage() {
  return (
    <MarketingShell>
      <div className="phead"><div className="wrap">
        <div className="kick">Contact</div>
        <div className="h1">Talk to <span className="g">a human</span></div>
        <div className="lead">Built by a handyman — questions, support, and demos go straight to the team.</div>
      </div></div>
      <div className="wrap" style={{ maxWidth: 560, padding: "30px 24px 80px" }}>
        <div className="fcard" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <a href="mailto:creedhandyman@gmail.com" style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 16 }}>
            <span className="ic" style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(46,117,182,.16)", color: "#7fb6ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✉</span>
            creedhandyman@gmail.com
          </a>
          <div style={{ color: "var(--mmuted)", fontSize: 15, lineHeight: 1.6 }}>
            We reply to most messages within one business day. Already a customer? Sign in and use the in-app help for the fastest response.
          </div>
        </div>
      </div>
    </MarketingShell>
  );
}
