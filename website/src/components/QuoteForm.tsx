"use client";

import { useState } from "react";
import { LEADS, SITE } from "@/lib/site";

type FormState = "idle" | "sending" | "ok" | "err";

/**
 * Quote-request form. POSTs to the Creed app's public lead endpoint —
 * the submission lands as a "lead" job in the app and notifies the crew.
 * No photos here on purpose: the success/fallback copy tells people to
 * text photos to the shop number instead.
 */
export default function QuoteForm() {
  const [state, setState] = useState<FormState>("idle");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);

    // Honeypot — bots fill every field; humans never see this one.
    if (String(f.get("company") || "").trim()) {
      setState("ok");
      return;
    }

    const body = {
      slug: LEADS.slug,
      name: String(f.get("name") || "").trim(),
      phone: String(f.get("phone") || "").trim(),
      email: String(f.get("email") || "").trim(),
      street: String(f.get("street") || "").trim(),
      city: String(f.get("city") || "").trim(),
      state: "KS",
      description: String(f.get("description") || "").trim(),
    };

    setState("sending");
    setError("");
    try {
      const res = await fetch(LEADS.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}) as { error?: string });
      if (!res.ok) throw new Error(data?.error || "Something went wrong sending your request.");
      setState("ok");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong sending your request.");
      setState("err");
    }
  }

  if (state === "ok") {
    return (
      <div className="form-ok">
        <h3 className="h3" style={{ color: "var(--blue-lt)" }}>Got it. We&rsquo;ll call you back.</h3>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: "var(--muted)", margin: "0 0 14px" }}>
          Your request is in — expect a call or text within one business day.
          Photos help us quote faster: text them to{" "}
          <a href={SITE.phoneHref} style={{ whiteSpace: "nowrap" }}>{SITE.phone}</a>.
        </p>
        <p style={{ fontSize: 15, color: "var(--dim)", margin: 0 }}>
          Need it handled sooner? Call us directly.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate={false}>
      {state === "err" && (
        <div className="form-err" role="alert">
          {error} — or just call <a href={SITE.phoneHref}>{SITE.phone}</a>.
        </div>
      )}
      <div className="frow frow2">
        <div>
          <label className="flabel" htmlFor="qf-name">Name</label>
          <input className="field" id="qf-name" name="name" autoComplete="name" required />
        </div>
        <div>
          <label className="flabel" htmlFor="qf-phone">Phone</label>
          <input className="field" id="qf-phone" name="phone" type="tel" autoComplete="tel" required />
        </div>
      </div>
      <div className="frow frow2">
        <div>
          <label className="flabel" htmlFor="qf-email">Email (optional)</label>
          <input className="field" id="qf-email" name="email" type="email" autoComplete="email" />
        </div>
        <div>
          <label className="flabel" htmlFor="qf-city">City</label>
          <input className="field" id="qf-city" name="city" placeholder="Wichita" autoComplete="address-level2" />
        </div>
      </div>
      <div className="frow">
        <label className="flabel" htmlFor="qf-street">Street address (optional)</label>
        <input className="field" id="qf-street" name="street" autoComplete="street-address" />
      </div>
      <div className="frow">
        <label className="flabel" htmlFor="qf-desc">What needs fixing?</label>
        <textarea
          className="field"
          id="qf-desc"
          name="description"
          required
          placeholder="e.g. Kitchen faucet drips, and the disposal hums but won't spin."
        />
      </div>
      {/* Honeypot field — hidden from people, tempting to bots. */}
      <div style={{ position: "absolute", left: "-5000px" }} aria-hidden="true">
        <input tabIndex={-1} name="company" autoComplete="off" />
      </div>
      <div className="btn-row" style={{ alignItems: "center", gap: 18 }}>
        <button type="submit" className="btn btn-red" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Send it"}
        </button>
        <span style={{ fontSize: 14.5, color: "var(--dim)" }}>
          Photos? Text them to {SITE.phone} after you send.
        </span>
      </div>
    </form>
  );
}
