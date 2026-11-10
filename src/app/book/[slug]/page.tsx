"use client";
/**
 * Public online booking page — /book/[slug]. A customer picks a day, then an
 * open time inside the business's hours, then leaves their details. The
 * request lands in Creed as a lead with the time held until the owner
 * confirms (see /api/public/booking). Hidden (404 copy) unless the business
 * switched Online booking on in Ops → Settings.
 *
 * Same `.pub` look as /lead and /status. Mobile-first.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { fmt12, fmtDay, type DaySlots } from "@/lib/booking";

interface Business { name: string; phone: string | null; logo_url: string | null }

const CONSENT_TEXT = (biz: string) =>
  `(Optional) Yes, send me text messages from ${biz} about my booking: appointment updates and reminders. ` +
  "Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of purchase.";

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();

  const [biz, setBiz] = useState<Business | null>(null);
  const [days, setDays] = useState<DaySlots[]>([]);
  const [durationMin, setDurationMin] = useState(120);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [description, setDescription] = useState("");
  const [textsOk, setTextsOk] = useState(false);
  const [company, setCompany] = useState(""); // honeypot

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const res = await fetch(`/api/public/booking?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      if (res.status === 404) { setUnavailable(true); return; }
      const data = await res.json();
      if (!res.ok) { setError(data?.error || "Couldn't load open times."); return; }
      setBiz(data.business);
      setDays(data.days || []);
      setDurationMin(data.durationMin || 120);
    } catch {
      setError("Couldn't load open times. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const daySlots = useMemo(() => days.find((d) => d.date === date)?.slots || [], [days, date]);
  const lengthLabel = durationMin % 60 === 0 ? `${durationMin / 60} hour${durationMin === 60 ? "" : "s"}` : `${durationMin} minutes`;

  const submit = async () => {
    setError("");
    if (!date || !time) { setError("Please pick a day and a time."); return; }
    if (!name.trim() || !description.trim()) { setError("Please fill in your name and what you need done."); return; }
    if (!phone.trim() && !email.trim()) { setError("Please add a phone number or email so we can reach you."); return; }
    if (!street.trim()) { setError("Please add the address where the work is."); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug, date, time,
          name: name.trim(), phone: phone.trim(), email: email.trim(),
          street: street.trim(), city: city.trim(), state: state.trim(), zip: zip.trim(),
          description: description.trim(),
          sms_consent: textsOk,
          sms_consent_text: biz ? CONSENT_TEXT(biz.name) : "",
          company,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Something went wrong. Please call us directly.");
        if (data?.taken) { setTime(""); await load(); }
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  };

  if (loading) return <div className="pub" />;

  if (unavailable || !biz) {
    return (
      <div className="pub" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📅</div>
          <h1 style={{ fontFamily: "Oswald, sans-serif", fontSize: 22, color: "#ff7a7a", textTransform: "uppercase" }}>Online booking isn&apos;t available</h1>
          <p style={{ color: "#8a8a99", fontSize: 15, marginTop: 8 }}>{error || "This business isn't taking online bookings right now."}</p>
        </div>
      </div>
    );
  }

  const header = (
    <div className="bh">
      <div className="logo">
        {biz.logo_url
          ? <img src={biz.logo_url} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          : (biz.name?.[0]?.toUpperCase() || "C")}
      </div>
      <div className="nm">{biz.name}</div>
      {biz.phone && <div className="ph">{biz.phone}</div>}
    </div>
  );

  if (done) {
    return (
      <div className="pub" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="pub-wrap" style={{ textAlign: "center" }}>
          {header}
          <div className="card" style={{ textAlign: "center", padding: 28 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontFamily: "Oswald, sans-serif", fontSize: 24, color: "#3ee08f", textTransform: "uppercase", marginBottom: 8 }}>Request sent</h2>
            <p className="muted" style={{ fontSize: 15, lineHeight: 1.5 }}>
              We&apos;re holding {fmtDay(date)} at {fmt12(time)} for you. {biz.name} will confirm shortly.
            </p>
            {biz.phone && (
              <p style={{ color: "#8a8a99", fontSize: 14, marginTop: 12 }}>
                Questions? <a href={`tel:${biz.phone}`} style={{ color: "#7fb6ff", textDecoration: "none" }}>{biz.phone}</a>
              </p>
            )}
          </div>
          <div style={{ color: "#666", fontSize: 12, marginTop: 16 }}>Powered by Creed HM</div>
        </div>
      </div>
    );
  }

  // Compact chips (the .segb base is sized for 3 big icon tiles).
  const chip: CSSProperties = { flex: "0 0 auto", minWidth: 0, padding: "10px 12px" };

  return (
    <div className="pub">
      <div className="pub-wrap">
        {header}

        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: ".4px", textTransform: "uppercase" }}>Book a Visit</div>
          <div className="muted" style={{ marginTop: 3 }}>Pick an open time. Visits are about {lengthLabel}.</div>
        </div>

        {days.length === 0 ? (
          <div className="card" style={{ textAlign: "center" }}>
            <div className="muted" style={{ fontSize: 15 }}>
              No open times in the next few weeks.{biz.phone ? <> Please call <a href={`tel:${biz.phone}`} style={{ color: "#7fb6ff" }}>{biz.phone}</a>.</> : ""}
            </div>
          </div>
        ) : (
          <>
            <div className="lbl">Day</div>
            <div className="seg" style={{ flexWrap: "nowrap", overflowX: "auto", paddingBottom: 4 }}>
              {days.map((d) => (
                <div key={d.date} className={`segb${date === d.date ? " on" : ""}`} style={chip}
                  onClick={() => { setDate(d.date); setTime(""); }}>
                  {fmtDay(d.date)}
                </div>
              ))}
            </div>

            {date && (
              <>
                <div className="lbl">Time</div>
                <div className="seg">
                  {daySlots.map((s) => (
                    <div key={s} className={`segb${time === s ? " on" : ""}`} style={chip} onClick={() => setTime(s)}>
                      {fmt12(s)}
                    </div>
                  ))}
                </div>
              </>
            )}

            {date && time && (
              <>
                <div className="lbl">Your details</div>
                <input className="in" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
                <div className="row" style={{ marginBottom: 10 }}>
                  <input className="in" style={{ marginBottom: 0 }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" autoComplete="tel" />
                  <input className="in" style={{ marginBottom: 0 }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" inputMode="email" autoComplete="email" />
                </div>
                <input className="in" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="Address where the work is" autoComplete="street-address" />
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <input className="in" style={{ marginBottom: 0 }} value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" autoComplete="address-level2" />
                  <input className="in" style={{ marginBottom: 0 }} value={state} onChange={(e) => setState(e.target.value)} placeholder="ST" autoComplete="address-level1" />
                  <input className="in" style={{ marginBottom: 0 }} value={zip} onChange={(e) => setZip(e.target.value)} placeholder="ZIP" autoComplete="postal-code" inputMode="numeric" />
                </div>
                <textarea className="in" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What do you need done?" rows={3} style={{ resize: "vertical" }} />

                <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#8a8a99", lineHeight: 1.45, marginBottom: 12, cursor: "pointer" }}>
                  <input type="checkbox" checked={textsOk} onChange={(e) => setTextsOk(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>{CONSENT_TEXT(biz.name)}</span>
                </label>

                {/* Honeypot — hidden from people, tempting to bots. */}
                <div style={{ position: "absolute", left: "-5000px" }} aria-hidden="true">
                  <input tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} name="company" />
                </div>
              </>
            )}
          </>
        )}

        {error && (
          <div style={{ background: "#3a0d0d", border: "1px solid #C00000", borderRadius: 8, padding: "8px 10px", marginBottom: 11, fontSize: 14, color: "#ff8888" }}>
            {error}
          </div>
        )}

        {date && time && (
          <>
            <button className="btn glow-green" onClick={submit} disabled={submitting}>
              <Icon name="send" size={17} /> {submitting ? "Sending…" : `Request ${fmtDay(date)}, ${fmt12(time)}`}
            </button>
            <div className="muted" style={{ textAlign: "center", marginTop: 9, fontSize: 12 }}>
              We&apos;ll hold this time and confirm with you shortly.
            </div>
          </>
        )}

        <div style={{ textAlign: "center", color: "#666", fontSize: 12, marginTop: 16 }}>Powered by Creed HM</div>
      </div>
    </div>
  );
}
