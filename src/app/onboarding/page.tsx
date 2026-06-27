"use client";
import { apiFetch } from "@/lib/api";
/**
 * /onboarding — five-step wizard that finishes everything /signup
 * couldn't fit into a single form. Steps are held in component state
 * (one route, not five) so partial progress is patched into the org
 * row as the visitor advances and a back/forward navigation never
 * loses what they typed.
 *
 * Step order:
 *   1. business  — name, phone, license #, address, services list
 *   2. logo      — upload + preview (Supabase storage `receipts` bucket)
 *   3. slug      — site_slug picker w/ uniqueness check + live preview
 *   4. plan      — Solo / Crew / Pro card picker (Crew is "Most Popular")
 *   5. checkout  — pre-Stripe summary + "Continue to Checkout" CTA
 *
 * The route guards itself: if there's no Supabase session, route to
 * /signup. If there's a session but no profile row (the email-confirm
 * round-trip case), bootstrap the org + owner profile right here using
 * `bootstrapOrgAndProfile` from /signup, then continue with the wizard.
 *
 * Stripe wiring (the last-step "Continue to Checkout" button) lands in
 * a follow-up commit. For now, we patch the chosen plan onto the org
 * row and route the user into the app — they'll still be inside their
 * 30-day trial, so BillingGate lets them in.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, db } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import type { Organization, Profile } from "@/lib/types";
import { bootstrapOrgAndProfile } from "@/lib/signup-helpers";

const PRIMARY = "#2E75B6";
const ACCENT = "#00cc66";
const BG = "linear-gradient(135deg, #0a0a0f, #0d1530)";

type Step = "business" | "logo" | "slug" | "plan" | "checkout";
const STEPS: { id: Step; label: string }[] = [
  { id: "business", label: "Business" },
  { id: "logo",     label: "Logo" },
  { id: "slug",     label: "URL" },
  { id: "plan",     label: "Plan" },
  { id: "checkout", label: "Checkout" },
];

type Plan = "solo" | "crew" | "pro";
const PLAN_CARDS: { id: Plan; name: string; price: number; tagline: string; cap: string; featured?: boolean }[] = [
  { id: "solo", name: "Solo", price: 24.99, tagline: "Independent operators", cap: "1 user · 75 inspections/mo" },
  { id: "crew", name: "Crew", price: 59.99, tagline: "Growing crews",        cap: "Up to 8 users · 175 inspections/mo", featured: true },
  { id: "pro",  name: "Pro",  price: 149.99, tagline: "Full operations",      cap: "Unlimited users · 450 inspections/mo" },
];

export default function OnboardingPage() {
  const user = useStore((s) => s.user);
  const org = useStore((s) => s.org);
  const setUser = useStore((s) => s.setUser);
  const setOrg = useStore((s) => s.setOrg);

  // Auth + bootstrap: a session must exist; profile/org may not (email-
  // confirmation case where /signup couldn't finish the insert).
  const [bootstrapping, setBootstrapping] = useState(true);
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        window.location.href = "/signup";
        return;
      }
      const profiles = await db.get<Profile>("profiles", { id: session.user.id });
      if (profiles.length && profiles[0].org_id) {
        const orgs = await db.get<Organization>("organizations", { id: profiles[0].org_id });
        setUser(profiles[0]);
        if (orgs.length) setOrg(orgs[0]);
      } else {
        const meta = (session.user.user_metadata || {}) as { name?: string };
        const seed = await bootstrapOrgAndProfile(
          session.user.id,
          session.user.email || "",
          meta.name || (session.user.email || "owner").split("@")[0],
        );
        if (seed) { setUser(seed.profile); setOrg(seed.org); }
      }
      setBootstrapping(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read the plan hint that /pricing forwards on (?plan=crew) so the
  // visitor lands on their chosen tier preselected. Defaults to crew.
  const initialPlan = useMemo<Plan>(() => {
    if (typeof window === "undefined") return "crew";
    const p = new URLSearchParams(window.location.search).get("plan");
    return p === "solo" || p === "crew" || p === "pro" ? p : "crew";
  }, []);

  // Honor ?step= so Stripe's cancel_url can deep-link back to the plan
  // picker, and `/onboarding?step=plan` works from the email/verify
  // round-trip without losing the visitor's prior progress.
  const initialStep = useMemo<Step>(() => {
    if (typeof window === "undefined") return "business";
    const s = new URLSearchParams(window.location.search).get("step");
    return s === "business" || s === "logo" || s === "slug" || s === "plan" || s === "checkout" ? s : "business";
  }, []);
  const [step, setStep] = useState<Step>(initialStep);

  // Local form state mirrors the org row so unsaved typing doesn't lose
  // on a re-render. Re-seeds once when org first lands.
  const seeded = useRef(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [license, setLicense] = useState("");
  const [address, setAddress] = useState("");
  const [services, setServices] = useState("");
  const [slug, setSlug] = useState("");
  const [plan, setPlan] = useState<Plan>(initialPlan);
  const [savingStep, setSavingStep] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!org || seeded.current) return;
    const placeholder = `${user?.name || "Your"}'s Business`;
    setName(org.name && org.name !== placeholder ? org.name : "");
    setPhone(org.phone || "");
    setLicense(org.license_num || "");
    setAddress(org.address || "");
    setSlug(org.site_slug || "");
    if (org.plan === "solo" || org.plan === "crew" || org.plan === "pro") setPlan(org.plan as Plan);
    seeded.current = true;
  }, [org, user]);

  if (bootstrapping || !org || !user) {
    return (
      <div style={{ minHeight: "100vh", background: BG, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ width: 36, height: 36, border: "3px solid #1e1e2e", borderTopColor: PRIMARY, borderRadius: "50%", margin: "0 auto 12px", animation: "spin 800ms linear infinite" }} />
          <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 15, letterSpacing: ".08em", textTransform: "uppercase" }}>Loading…</div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  const advance = async () => {
    setErr("");
    setSavingStep(true);
    try {
      if (step === "business") {
        if (!name.trim()) { setErr("Business name is required"); setSavingStep(false); return; }
        await db.patch("organizations", org.id, {
          name: name.trim(),
          phone: phone.trim(),
          license_num: license.trim(),
          address: address.trim(),
          // services lives on org.site_content as JSON — same pattern as
          // the public /card/<slug> page expects. Comma-separated for v1;
          // the card page renders whatever's there. Keep existing site
          // content if any so we don't clobber a customized card.
          ...(services.trim() ? { site_content: JSON.stringify({ services: services.split(",").map((s) => s.trim()).filter(Boolean) }) } : {}),
        });
        await refreshOrg();
        setStep("logo");
      } else if (step === "logo") {
        // Logo uploads happen inline in the step UI; advancing just
        // moves the wizard forward.
        setStep("slug");
      } else if (step === "slug") {
        const normalized = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
        if (!normalized) { setErr("Pick a URL slug"); setSavingStep(false); return; }
        if (normalized.length < 3) { setErr("Slug must be at least 3 characters"); setSavingStep(false); return; }
        // Uniqueness check — scope is the entire organizations table.
        const existing = await db.get<Organization>("organizations", { site_slug: normalized });
        const taken = existing.some((o) => o.id !== org.id);
        if (taken) { setErr("That URL is already taken — try another"); setSavingStep(false); return; }
        await db.patch("organizations", org.id, { site_slug: normalized });
        setSlug(normalized);
        await refreshOrg();
        setStep("plan");
      } else if (step === "plan") {
        await db.patch("organizations", org.id, { plan });
        await refreshOrg();
        setStep("checkout");
      } else if (step === "checkout") {
        // Hand off to Stripe Checkout. The /api endpoint reads
        // STRIPE_PRICE_<PLAN>, creates/reuses the Stripe Customer for
        // this org, and returns the redirect URL. We persist the chosen
        // plan first so it survives a Stripe-side cancel (the cancel_url
        // routes back here with ?step=plan).
        await db.patch("organizations", org.id, { plan });
        const res = await apiFetch("/api/stripe/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orgId: org.id,
            plan,
            returnUrl: window.location.origin,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
          setErr(data?.error || "Couldn't reach Stripe — please try again or contact support.");
          setSavingStep(false);
          return;
        }
        window.location.href = data.url;
        return;
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong saving");
    }
    setSavingStep(false);
  };

  const refreshOrg = async () => {
    const orgs = await db.get<Organization>("organizations", { id: org.id });
    if (orgs.length) setOrg(orgs[0]);
  };

  const back = () => {
    const i = STEPS.findIndex((s) => s.id === step);
    if (i > 0) setStep(STEPS[i - 1].id);
  };

  const currentIdx = STEPS.findIndex((s) => s.id === step);

  return (
    <div style={{ minHeight: "100vh", background: BG, color: "#e2e2e8", padding: "28px 18px 60px" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        {/* Top progress */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 22 }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 26, height: 26, borderRadius: "50%",
                  background: i <= currentIdx ? PRIMARY : "#1e1e2e",
                  color: i <= currentIdx ? "#fff" : "#666",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontFamily: "Oswald, sans-serif", fontSize: 15,
                  border: i === currentIdx ? `2px solid ${PRIMARY}` : "1px solid #1e1e2e",
                }}
              >
                {i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ width: 22, height: 2, background: i < currentIdx ? PRIMARY : "#1e1e2e", borderRadius: 1 }} />
              )}
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", fontFamily: "Oswald, sans-serif", fontSize: 13, color: "#888", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 18 }}>
          Step {currentIdx + 1} of {STEPS.length} · {STEPS[currentIdx].label}
        </div>

        <div style={{ background: "#12121a", border: "1px solid #1e1e2e", borderRadius: 12, padding: 22 }}>
          {step === "business" && (
            <BusinessStep
              name={name} setName={setName}
              phone={phone} setPhone={setPhone}
              license={license} setLicense={setLicense}
              address={address} setAddress={setAddress}
              services={services} setServices={setServices}
            />
          )}
          {step === "logo" && <LogoStep org={org} onUploaded={refreshOrg} />}
          {step === "slug" && <SlugStep slug={slug} setSlug={setSlug} />}
          {step === "plan" && <PlanStep plan={plan} setPlan={setPlan} />}
          {step === "checkout" && <CheckoutStep org={org} plan={plan} />}

          {err && (
            <div style={{ background: "#3a0d0d", border: "1px solid #C00000", borderRadius: 6, padding: "8px 10px", marginTop: 12, fontSize: 14, color: "#ff8888" }}>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            {currentIdx > 0 && (
              <button
                onClick={back}
                disabled={savingStep}
                style={{ ...btnGhost, flex: "0 0 auto" }}
              >
                ← Back
              </button>
            )}
            <button
              onClick={advance}
              disabled={savingStep}
              style={{ ...btnPrimary, flex: 1, opacity: savingStep ? 0.7 : 1, cursor: savingStep ? "wait" : "pointer" }}
            >
              {savingStep
                ? "Saving…"
                : step === "checkout"
                  ? "Continue to Checkout"
                  : "Save & Continue"}
            </button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 14, color: "#555", fontSize: 13 }}>
          You can edit any of this later in Operations → Settings.
        </div>
      </div>
    </div>
  );
}

/* ─────────────────── Step components ─────────────────── */

function BusinessStep({
  name, setName, phone, setPhone, license, setLicense,
  address, setAddress, services, setServices,
}: {
  name: string; setName: (v: string) => void;
  phone: string; setPhone: (v: string) => void;
  license: string; setLicense: (v: string) => void;
  address: string; setAddress: (v: string) => void;
  services: string; setServices: (v: string) => void;
}) {
  return (
    <>
      <StepHeader title="Tell us about your business" sub="This shows up on quotes, invoices, and your customer-facing pages." />

      <label style={lbl}>Business name *</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Handyman LLC" style={{ ...inp, marginBottom: 10 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <label style={lbl}>Phone</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(555) 123-4567" style={inp} inputMode="tel" />
        </div>
        <div>
          <label style={lbl}>License #</label>
          <input value={license} onChange={(e) => setLicense(e.target.value)} placeholder="Optional" style={inp} />
        </div>
      </div>

      <label style={lbl}>City / address</label>
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Wichita, KS" style={{ ...inp, marginBottom: 10 }} />

      <label style={lbl}>Services you offer</label>
      <input
        value={services}
        onChange={(e) => setServices(e.target.value)}
        placeholder="Plumbing, Electrical, Painting, Drywall"
        style={inp}
      />
      <div style={{ fontSize: 13, color: "#666", marginTop: 6 }}>
        Comma-separated. We&apos;ll surface these on your customer card.
      </div>
    </>
  );
}

function LogoStep({ org, onUploaded }: { org: Organization; onUploaded: () => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  const [bust, setBust] = useState(0);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `logos/${org.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: false, contentType: file.type || undefined });
      if (error) {
        useStore.getState().showToast("Upload failed: " + error.message, "error");
        setUploading(false);
        return;
      }
      const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(path);
      await db.patch("organizations", org.id, { logo_url: urlData.publicUrl });
      await onUploaded();
      setBust(Date.now());
      useStore.getState().showToast("Logo saved", "success");
    } catch (e) {
      useStore.getState().showToast("Upload error: " + (e instanceof Error ? e.message : String(e)), "error");
    }
    setUploading(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFile(e.dataTransfer.files?.[0]);
  };

  const preview = org.logo_url ? `${org.logo_url}${org.logo_url.includes("?") ? "&" : "?"}v=${bust}` : "";

  return (
    <>
      <StepHeader title="Add your logo" sub="Optional. PNG, JPG, WebP, or SVG. Shows on every quote PDF, invoice, and customer page." />

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{
          display: "block", padding: 22, border: "2px dashed #2a2a3a",
          borderRadius: 10, textAlign: "center", cursor: uploading ? "wait" : "pointer",
          background: "#0d0d15", marginBottom: 10,
        }}
      >
        {preview ? (
          <img src={preview} alt="Logo" style={{ maxHeight: 80, maxWidth: "100%", margin: "0 auto 10px", display: "block", borderRadius: 6, objectFit: "contain" }} />
        ) : (
          <div style={{ fontSize: 38, marginBottom: 6 }}>📤</div>
        )}
        <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 15, color: PRIMARY, textTransform: "uppercase", letterSpacing: ".06em" }}>
          {uploading ? "Uploading…" : preview ? "Replace logo" : "Click or drag to upload"}
        </div>
        <input
          type="file"
          accept="image/png, image/jpeg, image/webp, image/svg+xml"
          disabled={uploading}
          onChange={(e) => handleFile(e.target.files?.[0])}
          style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", clipPath: "inset(50%)" }}
        />
      </label>
      <div style={{ fontSize: 13, color: "#666", textAlign: "center" }}>
        Skip this step if you don&apos;t have a logo handy — you can add one later in Operations → Settings.
      </div>
    </>
  );
}

function SlugStep({ slug, setSlug }: { slug: string; setSlug: (v: string) => void }) {
  const cleaned = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const previewBase = typeof window !== "undefined" ? window.location.origin : "https://www.creedhm.com";
  return (
    <>
      <StepHeader title="Pick your custom URL" sub="This is the slug for your portal, card, and lead-intake links. Keep it short and easy to say." />

      <label style={lbl}>Your slug</label>
      <input
        value={slug}
        onChange={(e) => setSlug(e.target.value)}
        placeholder="acme"
        style={{ ...inp, marginBottom: 6 }}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <div style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
        Lowercase letters, numbers, and hyphens. 3 characters minimum.
      </div>

      <div style={{ background: "#0d0d15", border: "1px solid #1e1e2e", borderRadius: 8, padding: 12 }}>
        <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 13, color: "#888", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>
          Live preview
        </div>
        <div style={{ fontSize: 15, color: "#ddd", marginBottom: 4 }}>
          Customer portal: <span style={{ color: PRIMARY }}>{previewBase}/portal</span>
        </div>
        <div style={{ fontSize: 15, color: "#ddd", marginBottom: 4 }}>
          Business card: <span style={{ color: PRIMARY }}>{previewBase}/card/{cleaned || "your-slug"}</span>
        </div>
        <div style={{ fontSize: 15, color: "#ddd" }}>
          Lead intake: <span style={{ color: PRIMARY }}>{previewBase}/lead/{cleaned || "your-slug"}</span>
        </div>
      </div>
    </>
  );
}

function PlanStep({ plan, setPlan }: { plan: Plan; setPlan: (p: Plan) => void }) {
  return (
    <>
      <StepHeader title="Choose your plan" sub="Free for the first 30 days. Cancel anytime in the first month at no charge." />

      <div style={{ display: "grid", gap: 10 }}>
        {PLAN_CARDS.map((p) => {
          const active = plan === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setPlan(p.id)}
              style={{
                position: "relative",
                width: "100%", textAlign: "left",
                background: active ? "#13182a" : "#0d0d15",
                border: active ? `2px solid ${PRIMARY}` : "1px solid #1e1e2e",
                borderRadius: 10, padding: "14px 16px",
                cursor: "pointer", color: "#e2e2e8",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 12,
              }}
            >
              {p.featured && (
                <span style={{ position: "absolute", top: -10, right: 12, background: PRIMARY, color: "#fff", fontSize: 12, fontFamily: "Oswald, sans-serif", textTransform: "uppercase", letterSpacing: ".06em", padding: "2px 8px", borderRadius: 10 }}>
                  ★ Most Popular
                </span>
              )}
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 18, color: active ? PRIMARY : "#fff", textTransform: "uppercase", letterSpacing: ".05em" }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 14, color: "#888", marginTop: 2 }}>{p.tagline}</div>
                <div style={{ fontSize: 14, color: "#aaa", marginTop: 4 }}>{p.cap}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#fff" }}>${p.price}</div>
                <div style={{ fontSize: 13, color: "#888" }}>/month</div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ fontSize: 13, color: "#666", marginTop: 12, lineHeight: 1.5 }}>
        Managing properties? You can enable the <strong style={{ color: "#aaa" }}>Property Manager</strong> add-on
        ($2/door above 10 doors) from your billing dashboard after signup.
      </div>
    </>
  );
}

function CheckoutStep({ org, plan }: { org: Organization; plan: Plan }) {
  const tier = PLAN_CARDS.find((p) => p.id === plan)!;
  return (
    <>
      <StepHeader title="Almost done" sub="Review your selection — no charge until your trial ends." />

      <div style={{ background: "#0d0d15", border: "1px solid #1e1e2e", borderRadius: 10, padding: 16, marginBottom: 12 }}>
        <Row label="Business">{org.name}</Row>
        <Row label="Plan">{tier.name} — ${tier.price}/mo</Row>
        <Row label="Trial">30 days free, starts today</Row>
        {org.site_slug && <Row label="URL">creedhm.com/card/{org.site_slug}</Row>}
      </div>

      <div style={{ background: "#13182a", border: `1px solid ${PRIMARY}55`, borderRadius: 8, padding: 12, fontSize: 14, color: "#aabbd4", lineHeight: 1.5 }}>
        Next, we&apos;ll route you to Stripe to confirm your payment method.
        You won&apos;t be charged today — your card is held for after the
        30-day trial. Cancel anytime from your billing dashboard.
      </div>
    </>
  );
}

function StepHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 20, color: "#fff", textTransform: "uppercase", letterSpacing: ".04em", margin: "0 0 4px" }}>
        {title}
      </h2>
      <p style={{ color: "#888", fontSize: 14, margin: 0, lineHeight: 1.5 }}>{sub}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1e1e2e", fontSize: 15 }}>
      <span style={{ color: "#888", fontFamily: "Oswald, sans-serif", textTransform: "uppercase", fontSize: 13, letterSpacing: ".06em" }}>{label}</span>
      <span style={{ color: "#ddd" }}>{children}</span>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 8,
  border: "1px solid #1e1e2e",
  background: "#0d0d15",
  color: "#e2e2e8",
  fontSize: 16,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const lbl: React.CSSProperties = {
  fontSize: 13,
  color: "#888",
  fontFamily: "Oswald, sans-serif",
  textTransform: "uppercase",
  letterSpacing: ".06em",
  marginBottom: 4,
  display: "block",
};

const btnPrimary: React.CSSProperties = {
  padding: 12, borderRadius: 8,
  fontFamily: "Oswald, sans-serif", fontSize: 16,
  textTransform: "uppercase", letterSpacing: ".05em",
  background: PRIMARY, color: "#fff",
  border: "none",
};

const btnGhost: React.CSSProperties = {
  padding: "12px 16px", borderRadius: 8,
  fontFamily: "Oswald, sans-serif", fontSize: 15,
  textTransform: "uppercase", letterSpacing: ".05em",
  background: "transparent", color: "#888",
  border: "1px solid #1e1e2e",
  cursor: "pointer",
};
