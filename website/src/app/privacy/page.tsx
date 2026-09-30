import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { PageHero } from "@/components/blocks";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${SITE.legalName} collects, uses and protects your information — including your mobile number and text-message consent.`,
  alternates: { canonical: "/privacy" },
};

const EFFECTIVE = "September 29, 2026";

export default function PrivacyPage() {
  return (
    <main>
      <PageHero
        kicker="Privacy Policy"
        title="Your information, handled straight."
        lead="What we collect when you request a quote, hire us or text with us — and what we never do with it."
      />

      <section className="band">
        <div className="container section legal">
          <p className="legal-date">Effective {EFFECTIVE}</p>

          <p>
            This policy covers {SITE.legalName} (&ldquo;{SITE.name},&rdquo; &ldquo;we,&rdquo;
            &ldquo;us&rdquo;), a home-repair business based in {SITE.city}, Kansas. The short
            version: we use your information to quote and do your job, we never sell it, and
            we never share your phone number with anyone for their marketing.
          </p>

          <h2 className="h3">What we collect</h2>
          <ul>
            <li><b>Contact details</b> — your name, phone number, email and the property address.</li>
            <li><b>Job details</b> — what needs fixing, plus any photos, inspection reports or notes you send us.</li>
            <li><b>Quotes, invoices and payments</b> — card payments are processed by Stripe; we never see or store your full card number.</li>
            <li><b>Messages</b> — texts, emails and quote-form submissions you send us.</li>
            <li><b>Website visits</b> — cookie-free visit counts (Vercel Web Analytics). No advertising cookies and nothing that identifies you personally.</li>
          </ul>

          <h2 className="h3">How we use it</h2>
          <ul>
            <li>To answer your request and prepare your quote.</li>
            <li>To schedule and do the work, and keep you updated about it.</li>
            <li>To send quotes, invoices and payment links, and to take payment.</li>
            <li>After the job, to ask how we did (one review request).</li>
            <li>To keep the records we need for taxes and our <Link href="/guarantee">workmanship guarantee</Link>.</li>
          </ul>

          <h2 className="h3">Who we share it with</h2>
          <p>
            We never sell or rent your information. We share it only with the service providers
            that help us run the business, and only what each one needs: website and app hosting
            and our database, payment processing (Stripe), text-message and email delivery, and AI
            tools that help us prepare quotes from your job details and photos. They may use it only
            to provide those services to us. If a landlord or property manager arranged the work,
            we share the job details, photos and invoices with them. We may also disclose
            information when the law requires it.
          </p>
          <p className="legal-key">
            We do not share, sell, or provide your mobile phone number or messaging consent data to
            third parties or affiliates for marketing or promotional purposes. The above excludes
            text messaging originator opt-in data and consent; this information will not be shared
            with any third parties.
          </p>

          <h2 className="h3" id="sms">Text messages</h2>
          <p>
            If you opt in — with the optional text-message box on our{" "}
            <Link href="/contact">quote request form</Link>, or by asking us to text you about your
            job — we text you about your request and job: quotes, appointment and arrival updates,
            invoices and payment links, customer-portal login links, and one review request after
            the job. No marketing texts. Message frequency varies (usually a few per job). Message
            and data rates may apply. Reply <b>STOP</b> to opt out or <b>HELP</b> for help. Consent
            is not a condition of any purchase. Full terms: <Link href="/sms-terms">SMS Terms of
            Service</Link>.
          </p>

          <h2 className="h3">How long we keep it</h2>
          <p>
            As long as we need it for your job, our guarantee and our tax and business records
            (financial records generally up to seven years), then we delete it.
          </p>

          <h2 className="h3">Keeping it safe</h2>
          <p>
            Your information is stored with providers that use industry-standard security, and
            access is limited to the people who need it to do your job. No system is perfect, so
            please don&rsquo;t send us passwords or full card numbers by text or email.
          </p>

          <h2 className="h3">Your choices</h2>
          <ul>
            <li>Ask to see, correct or delete the information we hold about you.</li>
            <li>Stop texts anytime by replying STOP.</li>
            <li>Tell us not to send a review request.</li>
          </ul>
          <p>
            Call <a href={SITE.phoneHref}>{SITE.phone}</a> or email{" "}
            <a href={`mailto:${SITE.email}`}>{SITE.email}</a> and we&rsquo;ll take care of it.
          </p>

          <h2 className="h3">Children</h2>
          <p>Our services are for adults. We don&rsquo;t knowingly collect information from children under 13.</p>

          <h2 className="h3">Changes</h2>
          <p>
            If we change this policy, we&rsquo;ll post the new version here and update the
            effective date above.
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
