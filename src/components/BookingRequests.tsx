"use client";
/**
 * Online booking requests waiting on the owner — shown at the top of the
 * Schedule for owners/managers. Each one is a schedule row with
 * booking_status "requested" (written by /api/public/booking) holding a time
 * for a new lead. Confirm keeps the time and emails the customer; Decline
 * frees the time. Either way the job stays a lead to quote.
 * Renders nothing when there are no requests.
 */
import { useState } from "react";
import { useStore } from "@/lib/store";
import { apiFetch } from "@/lib/api";
import { Icon } from "./Icon";
import { fmt12, fmtDay } from "@/lib/booking";
import { parseSchedTime } from "@/lib/day-plan";
import type { ScheduleEntry } from "@/lib/types";

export default function BookingRequests({ schedule }: { schedule: ScheduleEntry[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const requests = schedule
    .filter((e) => e.booking_status === "requested")
    .sort((a, b) => `${a.sched_date} ${a.start_time || ""}`.localeCompare(`${b.sched_date} ${b.start_time || ""}`));
  if (!requests.length) return null;

  const answer = async (e: ScheduleEntry, action: "confirm" | "decline") => {
    setBusy(`${e.id}:${action}`);
    try {
      const res = await apiFetch("/api/booking/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleId: e.id, action }),
      });
      const data = await res.json().catch(() => ({}));
      const st = useStore.getState();
      if (!res.ok) {
        st.showToast(data?.error || "Couldn't save that. Try again.", "error");
      } else {
        st.showToast(
          action === "confirm"
            ? data?.emailed ? "Booked. The customer got a confirmation email." : "Booked."
            : "Declined. The time is open again; the lead is still in Jobs.",
          "success",
        );
      }
      await st.loadAll();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cd mb" style={{ borderColor: "#ff9f43" }}>
      <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 15, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <Icon name="bell" size={15} color="#ff9f43" />
        {requests.length === 1 ? "1 online booking to confirm" : `${requests.length} online bookings to confirm`}
      </div>
      {requests.map((e) => {
        const start = parseSchedTime(e.note) || e.start_time;
        const who = (e.note || "").split("⏳ Online booking request ·")[1]?.trim() || "";
        return (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--color-border-dark-2)", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>
                {fmtDay(e.sched_date)}{start ? `, ${fmt12(start)}` : ""}{who ? ` · ${who}` : ""}
              </div>
              <div className="dim" style={{ fontSize: 13 }}>{e.job}</div>
            </div>
            <button className="bg" disabled={!!busy} onClick={() => answer(e, "confirm")} style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="check" size={13} color="#fff" /> {busy === `${e.id}:confirm` ? "…" : "Confirm"}
            </button>
            <button className="bo" disabled={!!busy} onClick={() => answer(e, "decline")} style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 4 }}>
              <Icon name="close" size={13} /> {busy === `${e.id}:decline` ? "…" : "Decline"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
