"use client";
/**
 * Ops → Settings → Online booking. The switch (OFF by default), the public
 * booking link, the work hours customers can pick from, and the appointment
 * rules. Everything lives on the organizations row (booking_* columns, see
 * supabase/migrations/20261109190000_online_booking.sql); the slot math that
 * reads it is lib/booking.ts.
 */
import { useState } from "react";
import { useStore } from "@/lib/store";
import { Icon } from "./Icon";
import { siteOrigin } from "@/lib/site-url";
import { readBookingSettings, toMin, fromMin, type BookingHours } from "@/lib/booking";
import type { Organization } from "@/lib/types";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function BookingSettings({
  org,
  saveOrg,
}: {
  org: Organization;
  saveOrg: (u: Record<string, unknown>) => Promise<void>;
}) {
  const enabled = org.booking_enabled === true;
  const s = readBookingSettings(org as unknown as Record<string, unknown>);
  const [copied, setCopied] = useState(false);
  const slug = org.site_slug || "";
  const link = slug ? `${siteOrigin()}/book/${slug}` : "";

  const saveHours = async (next: BookingHours) => {
    await saveOrg({ booking_hours: next });
  };
  const setWindow = (day: number, i: number, which: 0 | 1, value: string) => {
    const wins = (s.hours[String(day)] || []).map((w) => [...w] as [string, string]);
    if (!wins[i] || !Number.isFinite(toMin(value))) return;
    wins[i][which] = value;
    if (toMin(wins[i][1]) <= toMin(wins[i][0])) {
      useStore.getState().showToast("End time has to be after the start time", "error");
      return;
    }
    saveHours({ ...s.hours, [String(day)]: wins });
  };
  const toggleDay = (day: number) => {
    const open = (s.hours[String(day)] || []).length > 0;
    saveHours({ ...s.hours, [String(day)]: open ? [] : [["09:30", "12:00"], ["13:30", "18:00"]] });
  };
  const addWindow = (day: number) => {
    const wins = s.hours[String(day)] || [];
    const lastEnd = wins.length ? toMin(wins[wins.length - 1][1]) : 9 * 60;
    const start = Math.min(lastEnd + 60, 22 * 60);
    saveHours({ ...s.hours, [String(day)]: [...wins, [fromMin(start), fromMin(Math.min(start + 120, 23 * 60 + 30))]] });
  };
  const removeWindow = (day: number, i: number) => {
    const wins = (s.hours[String(day)] || []).filter((_, j) => j !== i);
    saveHours({ ...s.hours, [String(day)]: wins });
  };

  const numberField = (label: string, col: string, value: number, help: string, min: number, max: number, step: number) => (
    <div>
      <label className="sl">{label}</label>
      <input
        type="number"
        key={`${col}-${value}`}
        defaultValue={value}
        min={min}
        max={max}
        step={step}
        style={{ marginTop: 4 }}
        onBlur={async (e) => {
          const v = Math.round(Number(e.target.value));
          if (!Number.isFinite(v) || v === value) return;
          await saveOrg({ [col]: Math.min(max, Math.max(min, v)) });
        }}
      />
      <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>{help}</div>
    </div>
  );

  return (
    <div className="cd mb">
      <h4 style={{ fontSize: 16, marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <Icon name="schedule" size={16} color="var(--color-primary)" />
        Online booking
      </h4>
      <div className="dim" style={{ fontSize: 14, marginBottom: 12 }}>
        Customers pick an open time inside your hours from a booking page. Each booking comes in as a lead with the
        time held on your Schedule until you confirm or decline it.
      </div>

      <label className="row" style={{ gap: 8, marginBottom: 12, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={async (e) => {
            if (e.target.checked && !slug) {
              useStore.getState().showToast("Set your website address in Branding first", "error");
              return;
            }
            await saveOrg({ booking_enabled: e.target.checked });
          }}
          style={{ width: 16, height: 16, cursor: "pointer" }}
        />
        <span style={{ fontSize: 15, fontWeight: 500 }}>
          {enabled ? "On" : "Off"} — take bookings online
        </span>
      </label>

      {link && (
        <div className="mb">
          <label className="sl">Your booking link</label>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            <input readOnly value={link} style={{ flex: 1, fontSize: 14 }} onFocus={(e) => e.target.select()} />
            <button
              className="bo"
              onClick={async () => {
                try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* */ }
              }}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}
            >
              <Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>
            {enabled ? "Add it to your Google Business Profile as your booking button." : "The page shows \"not available\" until you turn booking on."}
          </div>
        </div>
      )}

      <label className="sl">Hours customers can book</label>
      <div style={{ marginTop: 4, marginBottom: 12 }}>
        {DAY_NAMES.map((dn, day) => {
          const wins = s.hours[String(day)] || [];
          const open = wins.length > 0;
          return (
            <div key={dn} className="row" style={{ gap: 6, alignItems: "center", flexWrap: "wrap", padding: "5px 0", borderBottom: "1px solid var(--color-border-dark-2, #1e1e2e)" }}>
              <label className="row" style={{ gap: 6, width: 64, cursor: "pointer", fontSize: 14 }}>
                <input type="checkbox" checked={open} onChange={() => toggleDay(day)} style={{ width: 15, height: 15 }} />
                {dn}
              </label>
              {!open && <span className="dim" style={{ fontSize: 14 }}>Closed</span>}
              {wins.map((w, i) => (
                <span key={`${day}-${i}-${w[0]}-${w[1]}`} className="row" style={{ gap: 4, alignItems: "center" }}>
                  <input type="time" defaultValue={w[0]} step={900} style={{ width: 108, fontSize: 14 }}
                    onBlur={(e) => e.target.value !== w[0] && setWindow(day, i, 0, e.target.value)} />
                  <span className="dim">to</span>
                  <input type="time" defaultValue={w[1]} step={900} style={{ width: 108, fontSize: 14 }}
                    onBlur={(e) => e.target.value !== w[1] && setWindow(day, i, 1, e.target.value)} />
                  <button className="bo" title="Remove" onClick={() => removeWindow(day, i)} style={{ padding: "2px 6px" }}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              ))}
              {open && wins.length < 3 && (
                <button className="bo" onClick={() => addWindow(day)} style={{ fontSize: 12, padding: "2px 8px", display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <Icon name="add" size={12} /> Add
                </button>
              )}
            </div>
          );
        })}
        <div className="dim" style={{ fontSize: 14, marginTop: 4 }}>
          A visit has to fit inside one block, so the gap between blocks (lunch) is never booked.
        </div>
      </div>

      <div className="g2">
        {numberField("Visit length (minutes)", "booking_slot_min", s.slotMin, "How long each booking holds.", 30, 480, 15)}
        {numberField("Gap between visits (minutes)", "booking_buffer_min", s.bufferMin, "Drive time kept clear before and after.", 0, 240, 5)}
        {numberField("Minimum notice (hours)", "booking_min_notice_hours", s.minNoticeHours, "No bookings sooner than this.", 0, 336, 1)}
        {numberField("Days ahead", "booking_days_ahead", s.daysAhead, "How far out customers can book.", 1, 60, 1)}
      </div>
      <div className="dim" style={{ fontSize: 13, marginTop: 8 }}>Times are {s.tz.replace("_", " ")} time.</div>
    </div>
  );
}
