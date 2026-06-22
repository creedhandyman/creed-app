"use client";
import { useEffect } from "react";
import { useParams } from "next/navigation";

/**
 * Magic-link landing page. The link sent over SMS/email points HERE (a page),
 * not straight at the redeem API. Link previewers and security scanners (e.g.
 * iMessage/SMS rich previews, Outlook SafeLinks) fetch the URL to build a
 * preview — but they only get static HTML and don't run JavaScript, so they
 * can't consume the one-time token. A real browser runs this effect, navigates
 * to the GET redeem endpoint (which marks the token used, sets the session
 * cookie, and redirects to /portal), so the token is spent by the actual tap —
 * not by a preview bot. If the token is already used/expired, the API redirects
 * to /portal/login?reason=… which shows the "request a new link" page.
 */
export default function PortalRedeem() {
  const { token } = useParams<{ token: string }>();
  useEffect(() => {
    if (token) window.location.replace(`/api/portal/redeem/${token}`);
  }, [token]);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a0f, #0d1530)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "Oswald, sans-serif", fontSize: 20, color: "#7fb6ff", textTransform: "uppercase", letterSpacing: ".06em" }}>Opening your portal…</div>
        <div style={{ color: "#8a8a99", fontSize: 14, marginTop: 8 }}>
          One moment. If nothing happens, <a href={`/api/portal/redeem/${token}`} style={{ color: "#7fb6ff" }}>tap here</a>.
        </div>
      </div>
    </div>
  );
}
