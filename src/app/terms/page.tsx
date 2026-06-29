import type { Metadata } from "next";
import Link from "next/link";
import MarketingShell from "@/components/marketing/MarketingShell";

export const metadata: Metadata = {
  title: "Terms of Use · Creed Handy Manager",
  description:
    "Terms of Use for Creed Handy Manager — the field-service management app for handyman and trade crews.",
};

const h2Style: React.CSSProperties = {
  fontFamily: "Oswald, sans-serif",
  fontWeight: 600,
  fontSize: 18,
  letterSpacing: ".3px",
  textTransform: "uppercase",
  margin: "34px 0 10px",
  paddingTop: 8,
  borderTop: "1px solid var(--mline, #1e1e2e)",
  color: "#fff",
};

const pStyle: React.CSSProperties = {
  color: "var(--mmuted, #9a9aa8)",
  fontSize: 15.5,
  lineHeight: 1.62,
  margin: "10px 0",
};

const ulStyle: React.CSSProperties = {
  margin: "10px 0 10px 22px",
  fontSize: 15,
  color: "var(--mmuted, #9a9aa8)",
};

const liStyle: React.CSSProperties = { margin: "6px 0" };

export default function TermsPage() {
  return (
    <MarketingShell>
      <div className="phead">
        <div className="wrap">
          <div className="kick">Legal</div>
          <div className="h1">
            Terms of <span className="g">Use</span>
          </div>
          <div className="lead">
            Last updated June 28, 2026 &middot; Effective on acceptance.
          </div>
        </div>
      </div>

      <div className="wrap" style={{ maxWidth: 800, padding: "20px 24px 80px" }}>

        {/* Table of contents */}
        <div style={{
          background: "var(--mcard, #12121a)",
          border: "1px solid var(--mline, #1e1e2e)",
          borderRadius: 12,
          padding: "16px 18px",
          marginBottom: 28,
        }}>
          <div style={{
            fontFamily: "Oswald, sans-serif",
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: ".1em",
            textTransform: "uppercase",
            color: "var(--mmuted, #9a9aa8)",
            marginBottom: 10,
          }}>
            Contents
          </div>
          <ol style={{
            margin: 0,
            paddingLeft: 20,
            columns: 2,
            columnGap: 28,
            fontSize: 13.5,
            color: "var(--mlink, #7fb6ff)",
          }}>
            {[
              ["#accept",   "Acceptance"],
              ["#service",  "The Service"],
              ["#accounts", "Accounts & eligibility"],
              ["#subs",     "Subscriptions & billing"],
              ["#ai",       "AI features"],
              ["#payments", "Payments & Stripe"],
              ["#content",  "Your content & data"],
              ["#use",      "Acceptable use"],
              ["#third",    "Third-party services"],
              ["#ip",       "Intellectual property"],
              ["#warranty", "Disclaimers"],
              ["#liability","Limitation of liability"],
              ["#indem",    "Indemnification"],
              ["#term",     "Termination"],
              ["#changes",  "Changes"],
              ["#law",      "Governing law"],
              ["#contact",  "Contact"],
            ].map(([href, label], i) => (
              <li key={href} style={{ marginBottom: 4 }}>
                <a href={href} style={{ color: "var(--mlink, #7fb6ff)", textDecoration: "none" }}>
                  {i + 1}. {label}
                </a>
              </li>
            ))}
          </ol>
        </div>

        <p style={{ ...pStyle, fontSize: 16, color: "#d6d8df", marginBottom: 8 }}>
          These Terms of Use (&ldquo;Terms&rdquo;) are a binding agreement between you
          (&ldquo;you,&rdquo; &ldquo;your,&rdquo; or &ldquo;Customer&rdquo;) and{" "}
          <strong style={{ color: "#fff" }}>Creed Handyman LLC</strong>{" "}
          (&ldquo;Creed,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;)
          governing your access to and use of the Creed Handy Manager application,
          website at creedhm.com, and related services (together, the
          &ldquo;Service&rdquo;). By creating an account or using the Service, you agree
          to these Terms.
        </p>

        {/* 1 */}
        <h2 id="accept" style={h2Style}>1. Acceptance of these Terms</h2>
        <p style={pStyle}>
          By accessing or using the Service, you confirm that you have read, understood,
          and agree to be bound by these Terms and our Privacy Policy. If you are using
          the Service on behalf of a business, you represent that you are authorized to
          bind that business, and &ldquo;you&rdquo; refers to that business. If you do not
          agree, do not use the Service.
        </p>

        {/* 2 */}
        <h2 id="service" style={h2Style}>2. The Service</h2>
        <p style={pStyle}>
          Creed provides software for field-service and trade businesses to create quotes,
          schedule and dispatch crews, track time, manage customers, request payments, and
          run related back-office tasks, including AI-assisted features. The Service is a
          tool that supports your business;{" "}
          <strong style={{ color: "#fff" }}>
            you are solely responsible for the work you perform, the quotes and invoices
            you send, the prices you charge, your employees and contractors, and your
            compliance with all applicable laws, licensing, permitting, tax, and employment
            requirements.
          </strong>
        </p>

        {/* 3 */}
        <h2 id="accounts" style={h2Style}>3. Accounts &amp; eligibility</h2>
        <ul style={ulStyle}>
          <li style={liStyle}>You must be at least 18 years old and able to form a binding contract.</li>
          <li style={liStyle}>
            You are responsible for the accuracy of your account information and for keeping
            your credentials secure. You are responsible for all activity under your account,
            including that of your crew members and team users you invite.
          </li>
          <li style={liStyle}>You must promptly notify us of any unauthorized use of your account.</li>
        </ul>

        {/* 4 */}
        <h2 id="subs" style={h2Style}>4. Subscriptions, trials &amp; billing</h2>
        <ul style={ulStyle}>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Plans &amp; fees.</strong>{" "}
            Paid plans (e.g., Solo, Crew, Pro) are billed in advance on a recurring monthly
            basis at the prices shown at sign-up. Each plan includes a monthly usage
            allowance (such as a number of AI inspections/renders) as described on our
            pricing page.
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Free trial.</strong>{" "}
            If we offer a free first month or trial, your paid subscription begins
            automatically when the trial ends unless you cancel before then.
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Auto-renewal.</strong>{" "}
            Subscriptions renew automatically each period until cancelled. You authorize us
            (and our payment processor) to charge your payment method for each renewal.
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Cancellation.</strong>{" "}
            You may cancel anytime; cancellation takes effect at the end of the current
            billing period, and you retain access until then.
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Refunds.</strong>{" "}
            Except where required by law, fees are non-refundable, and we do not provide
            refunds or credits for partial periods or unused allowances.
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Changes to pricing.</strong>{" "}
            We may change plans, allowances, or fees; we will give reasonable advance
            notice, and changes apply to your next renewal.
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Taxes.</strong>{" "}
            Fees are exclusive of applicable taxes, which you are responsible for.
          </li>
        </ul>

        {/* 5 */}
        <h2 id="ai" style={h2Style}>5. AI-assisted features</h2>
        <p style={pStyle}>
          The Service uses artificial intelligence to help generate quotes, pricing
          estimates, inspection summaries, and visual renders.{" "}
          <strong style={{ color: "#fff" }}>
            AI output is an estimate and a starting point, not professional advice or a
            guarantee.
          </strong>{" "}
          AI may produce inaccurate, incomplete, or unexpected results. You are solely
          responsible for reviewing, editing, and verifying all AI-generated content
          &mdash; including pricing, scope, measurements, and renders &mdash; before relying
          on it or sending it to your customers. Creed is not liable for decisions made,
          prices quoted, or work performed based on AI output. Visual renders are
          illustrative representations and do not depict the actual finished work,
          materials, or results.
        </p>

        {/* 6 */}
        <h2 id="payments" style={h2Style}>6. Payments &amp; Stripe</h2>
        <p style={pStyle}>
          Payment processing for funds you collect from your own customers is provided by
          third parties, including <strong style={{ color: "#d6d8df" }}>Stripe</strong>,
          and is subject to their terms. When you accept deposits or payments through the
          Service, <strong style={{ color: "#fff" }}>you</strong> are the merchant of
          record in the transaction with your customer; Creed is not a party to, and is
          not responsible for, the underlying transaction, the goods or services you
          provide, refunds, chargebacks, or disputes between you and your customers. You
          are responsible for complying with the payment processor&apos;s terms and all
          applicable rules and laws. Processing fees charged by the payment processor are
          separate from your Creed subscription.
        </p>

        {/* 7 */}
        <h2 id="content" style={h2Style}>7. Your content &amp; data</h2>
        <ul style={ulStyle}>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Your ownership.</strong>{" "}
            You retain ownership of the content and data you submit, including quotes,
            photos, customer information, and business records (&ldquo;Customer Data&rdquo;).
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>License to us.</strong>{" "}
            You grant Creed a worldwide, non-exclusive license to host, store, process,
            transmit, and display Customer Data solely as needed to provide, secure, and
            improve the Service and as permitted by the Privacy Policy.
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Improving the Service.</strong>{" "}
            We may use aggregated and de-identified data (data that does not identify you
            or any individual) to operate, analyze, and improve the Service, including its
            pricing and AI models.
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Your responsibilities.</strong>{" "}
            You represent that you have the rights and any necessary consents to submit
            Customer Data (including data about your customers) and that doing so does not
            violate any law or third-party right.
          </li>
          <li style={liStyle}>
            <strong style={{ color: "#d6d8df" }}>Privacy.</strong>{" "}
            Our handling of personal information is described in our{" "}
            <Link href="/privacy" style={{ color: "var(--mlink, #7fb6ff)" }}>
              Privacy Policy
            </Link>
            , incorporated by reference.
          </li>
        </ul>

        {/* 8 */}
        <h2 id="use" style={h2Style}>8. Acceptable use</h2>
        <p style={pStyle}>
          You agree not to: (a) use the Service for any unlawful, fraudulent, or harmful
          purpose; (b) violate the rights of others, including privacy and intellectual
          property rights; (c) upload malicious code or attempt to disrupt, probe, or gain
          unauthorized access to the Service; (d) reverse engineer, copy, resell, or create
          derivative works of the Service except as permitted by law; (e) use the Service
          to send unlawful, deceptive, or unsolicited communications; or (f) misrepresent
          prices, work, licensing, or credentials to your customers. We may suspend or
          limit accounts that we reasonably believe violate these Terms.
        </p>

        {/* 9 */}
        <h2 id="third" style={h2Style}>9. Third-party services</h2>
        <p style={pStyle}>
          The Service integrates third-party providers (for example, Stripe for payments,
          Twilio for messaging, AI model providers for generation, and cloud
          hosting/database providers). Your use of those features may be subject to the
          third party&apos;s terms, and we are not responsible for third-party services,
          outages, or content.
        </p>

        {/* 10 */}
        <h2 id="ip" style={h2Style}>10. Intellectual property</h2>
        <p style={pStyle}>
          The Service, including its software, design, branding, and content (excluding
          Customer Data), is owned by Creed and its licensors and is protected by
          intellectual-property laws. We grant you a limited, non-exclusive,
          non-transferable, revocable license to use the Service during your subscription,
          subject to these Terms. All rights not expressly granted are reserved.
        </p>

        {/* 11 */}
        <h2 id="warranty" style={h2Style}>11. Disclaimers</h2>
        <p style={{ ...pStyle, textTransform: "uppercase", fontSize: 14 }}>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo;
          without warranties of any kind, whether express, implied, or statutory, including
          implied warranties of merchantability, fitness for a particular purpose, accuracy,
          and non-infringement. We do not warrant that the Service will be uninterrupted,
          error-free, secure, or that AI output, pricing, or estimates will be accurate or
          suitable for any purpose.
        </p>

        {/* 12 */}
        <h2 id="liability" style={h2Style}>12. Limitation of liability</h2>
        <p style={{ ...pStyle, textTransform: "uppercase", fontSize: 14 }}>
          To the maximum extent permitted by law, Creed and its owners, employees, and
          suppliers will not be liable for any indirect, incidental, special, consequential,
          or punitive damages, or for any lost profits, revenue, data, or goodwill, arising
          from or relating to the Service. Our total liability for any claim arising from or
          relating to the Service will not exceed the amounts you paid to Creed for the
          Service in the twelve (12) months before the event giving rise to the claim. Some
          jurisdictions do not allow certain limitations, so some of the above may not apply
          to you.
        </p>

        {/* 13 */}
        <h2 id="indem" style={h2Style}>13. Indemnification</h2>
        <p style={pStyle}>
          You agree to defend, indemnify, and hold harmless Creed from any claims, damages,
          liabilities, and expenses (including reasonable legal fees) arising from your use
          of the Service, your Customer Data, the work you perform, the quotes or invoices
          you issue, your violation of these Terms, or your violation of any law or
          third-party right.
        </p>

        {/* 14 */}
        <h2 id="term" style={h2Style}>14. Term &amp; termination</h2>
        <p style={pStyle}>
          These Terms apply while you use the Service. You may stop using the Service and
          cancel at any time. We may suspend or terminate your access if you breach these
          Terms, fail to pay, or where required by law. Upon termination, your right to use
          the Service ends. We may delete Customer Data after a reasonable period following
          termination; export your data before cancelling if you wish to keep it. Sections
          that by their nature should survive (including ownership, disclaimers, limitation
          of liability, and indemnification) survive termination.
        </p>

        {/* 15 */}
        <h2 id="changes" style={h2Style}>15. Changes to the Service or Terms</h2>
        <p style={pStyle}>
          We may modify the Service or these Terms from time to time. If we make material
          changes to these Terms, we will provide reasonable notice (for example, by posting
          the updated Terms with a new &ldquo;Last updated&rdquo; date or by in-app
          notice). Your continued use after changes take effect constitutes acceptance.
        </p>

        {/* 16 */}
        <h2 id="law" style={h2Style}>16. Governing law &amp; disputes</h2>
        <p style={pStyle}>
          These Terms are governed by the laws of the State of Kansas, without regard to
          its conflict-of-laws rules. You agree that the state and federal courts located
          in Kansas have exclusive jurisdiction over any dispute not subject to other agreed
          resolution, and you consent to venue there.
        </p>

        {/* 17 */}
        <h2 id="contact" style={h2Style}>17. Contact</h2>
        <p style={pStyle}>
          Questions about these Terms? Contact Creed Handyman LLC at{" "}
          <a
            href="mailto:creedhandyman@gmail.com"
            style={{ color: "var(--mlink, #7fb6ff)" }}
          >
            creedhandyman@gmail.com
          </a>
          .
        </p>

        {/* Footer links */}
        <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid var(--mline, #1e1e2e)", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, fontSize: 13, color: "var(--mmuted, #9a9aa8)" }}>
          <span>&copy; 2026 Creed Handyman LLC</span>
          <span>
            <Link href="/" style={{ color: "var(--mmuted, #9a9aa8)", marginLeft: 18, textDecoration: "none" }}>Home</Link>
            <Link href="/privacy" style={{ color: "var(--mmuted, #9a9aa8)", marginLeft: 18, textDecoration: "none" }}>Privacy</Link>
            <a href="mailto:creedhandyman@gmail.com" style={{ color: "var(--mmuted, #9a9aa8)", marginLeft: 18, textDecoration: "none" }}>Contact</a>
          </span>
        </div>
      </div>
    </MarketingShell>
  );
}
