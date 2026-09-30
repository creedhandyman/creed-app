import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { PageHero } from "@/components/blocks";

export const metadata: Metadata = {
  title: "SMS terms of service",
  description: `Terms for text messages from ${SITE.legalName}: what we send, how often, and how to stop them.`,
  alternates: { canonical: "/sms-terms" },
};

const EFFECTIVE = "September 29, 2026";

export default function SmsTermsPage() {
  return (
    <main>
      <PageHero
        kicker="SMS Terms of Service"
        title="Texts from Creed Handyman."
        lead="What we text, how often, and how to stop it — one reply does it."
      />

      <section className="band">
        <div className="container section legal">
          <p className="legal-date">Effective {EFFECTIVE}</p>

          <h2 className="h3">The program</h2>
          <p>
            <b>{SITE.name} Text Messages</b> is the text-message program of {SITE.legalName}, a
            home-repair business in {SITE.city}, Kansas. We text customers about their own
            requests and jobs: replies to quote requests, quotes, appointment and arrival updates,
            invoices and payment links, customer-portal login links, and one review request after
            a job is finished. We do not send marketing or promotional texts, and this program
            does not include affiliate marketing.
          </p>

          <h2 className="h3">How you sign up</h2>
          <p>
            You opt in by checking the optional text-message box on our{" "}
            <Link href="/contact">quote request form</Link>, or by giving us your mobile number and
            asking us to text you about your job. Consent to receive texts is not a condition of
            any purchase.
          </p>

          <h2 className="h3">How often</h2>
          <p>
            Message frequency varies with your job — usually a few messages per job, and none when
            you have no open request or job with us.
          </p>

          <h2 className="h3">Cost</h2>
          <p>Message and data rates may apply. Check your wireless plan for details.</p>

          <h2 className="h3">How to stop — or get help</h2>
          <ul>
            <li>
              Reply <b>STOP</b> to any message to opt out. You&rsquo;ll receive one confirmation
              and no further texts. Reply <b>START</b> to opt back in.
            </li>
            <li>
              Reply <b>HELP</b> for help, or contact us at{" "}
              <a href={SITE.phoneHref}>{SITE.phone}</a> or{" "}
              <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
            </li>
          </ul>

          <h2 className="h3">Carriers</h2>
          <p>Carriers are not liable for any delayed or undelivered messages.</p>

          <h2 className="h3">Privacy</h2>
          <p>
            We do not share, sell, or provide your mobile phone number or messaging consent data to
            third parties or affiliates for marketing or promotional purposes. See our{" "}
            <Link href="/privacy">Privacy Policy</Link> for how we handle your information.
          </p>

          <h2 className="h3">Contact</h2>
          <p>
            {SITE.legalName} · {SITE.city}, Kansas ·{" "}
            <a href={SITE.phoneHref}>{SITE.phone}</a> ·{" "}
            <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
          </p>
        </div>
      </section>
    </main>
  );
}
