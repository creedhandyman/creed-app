"use client";
/**
 * "Sharing location while on the clock" — the small line Time and Work mode
 * show while this phone's live-location heartbeat (lib/crew-heartbeat) is
 * running, so a tech always knows when the office can see where they are.
 * Hidden off the clock, when location permission isn't granted, and until the
 * crew_locations migration runs.
 */
import { useLocationSharing } from "@/lib/crew-heartbeat";
import { LIVE_FRESH_MIN } from "@/lib/crew-location";
import { t } from "@/lib/i18n";
import { Icon } from "./Icon";

export default function LocationSharingNote({ on, style }: { on: boolean; style?: React.CSSProperties }) {
  const sharing = useLocationSharing();
  if (!on || !sharing) return null;
  return (
    <div className="dim" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5, ...style }}>
      <Icon name="gps" size={12} /> {t("loc.sharingOnClock")}
    </div>
  );
}

/** "live · 3 min ago" while fresh, "location from 2:14 PM" once it's old. */
export function liveFixLabel(ageMin: number, time: string): string {
  if (ageMin < 1) return t("disp.liveNow");
  if (ageMin <= LIVE_FRESH_MIN) return t("disp.liveAgo").replace("{n}", String(ageMin));
  return t("disp.locFrom").replace("{time}", time);
}
