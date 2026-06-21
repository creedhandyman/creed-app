"use client";
import { useStore } from "@/lib/store";
import { t } from "@/lib/i18n";
import { Icon, type IconName } from "./Icon";
import type { AppNotification, NotificationType } from "@/lib/types";

interface Props {
  onClose: () => void;
  /** Deep-link to a job's detail screen (notification.job_id). */
  onOpenJob?: (jobId: string) => void;
}

/** Compact relative time — "just now", "5m", "3h", "2d", else a date. */
function ago(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const META: Record<NotificationType, { icon: IconName; color: string }> = {
  job_assigned: { icon: "worker", color: "#2e8bff" },
  new_lead: { icon: "sparkle", color: "#ff5fa8" },
};

export default function NotificationsPanel({ onClose, onOpenJob }: Props) {
  const notifications = useStore((s) => s.notifications);
  const markRead = useStore((s) => s.markNotificationRead);
  const markAll = useStore((s) => s.markAllNotificationsRead);

  const sorted = [...notifications].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || ""),
  );
  const unread = sorted.filter((n) => !n.read_at).length;

  const tap = (n: AppNotification) => {
    if (!n.read_at) markRead(n.id);
    if (n.job_id && onOpenJob) {
      onOpenJob(n.job_id);
      onClose();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.45)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cd fi"
        style={{
          position: "absolute",
          top: 58,
          right: 12,
          left: 12,
          maxWidth: 420,
          marginLeft: "auto",
          maxHeight: "min(72vh, 560px)",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 14px", borderBottom: "1px solid var(--color-border-dark)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="bell" size={16} color="var(--color-primary)" />
            <span style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: 17, letterSpacing: ".4px", textTransform: "uppercase" }}>{t("notif.title")}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {unread > 0 && (
              <button onClick={() => markAll()} style={{ background: "none", border: "none", color: "var(--color-primary)", fontSize: 13.5, fontWeight: 600, cursor: "pointer", padding: 2 }}>
                {t("notif.markAll")}
              </button>
            )}
            <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: "var(--color-dim)", cursor: "pointer", padding: 2, display: "inline-flex" }}>
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        {/* List */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {sorted.length === 0 ? (
            <div style={{ textAlign: "center", padding: "38px 18px", color: "var(--color-dim)" }}>
              <Icon name="bell" size={28} color="var(--color-dim)" />
              <div style={{ fontSize: 15, marginTop: 10 }}>{t("notif.empty")}</div>
            </div>
          ) : (
            sorted.map((n) => {
              const m = META[n.type] || { icon: "info" as IconName, color: "var(--color-primary)" };
              const isUnread = !n.read_at;
              return (
                <div
                  key={n.id}
                  onClick={() => tap(n)}
                  style={{
                    display: "flex",
                    gap: 11,
                    padding: "12px 14px",
                    cursor: n.job_id ? "pointer" : "default",
                    borderBottom: "1px solid var(--color-border-dark)",
                    background: isUnread ? "rgba(46,139,255,.07)" : "transparent",
                  }}
                >
                  <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: `${m.color}22`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon name={m.icon} size={17} color={m.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{n.title}</span>
                      <span className="dim" style={{ fontSize: 12.5, whiteSpace: "nowrap", flexShrink: 0 }}>{ago(n.created_at)}</span>
                    </div>
                    <div className="dim" style={{ fontSize: 13.5, marginTop: 2, lineHeight: 1.35 }}>{n.body}</div>
                  </div>
                  {isUnread && (
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--color-primary)", flexShrink: 0, marginTop: 6 }} />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
