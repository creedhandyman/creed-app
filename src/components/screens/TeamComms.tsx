"use client";
import { useEffect, useState, useCallback } from "react";
import { useStore } from "@/lib/store";
import { db, supabase } from "@/lib/supabase";
import { Icon } from "../Icon";

interface TeamMessage {
  id: string;
  org_id?: string;
  author_id: string;
  author_name: string;
  message: string;
  urgent?: boolean;
  read_by?: string;        // JSON array of user_ids who've marked read
  created_at?: string;
}

interface Props {
  setPage?: (p: string) => void;
}

/**
 * Team Comms — lightweight in-app message board so the owner can post
 * quick updates the whole team sees on next app open ("Job at 1021 needs
 * a return visit Friday", "Pick up filters at the supply house"). Each
 * message tracks who has read it; unread count surfaces as a badge on the
 * dashboard card.
 *
 * Anyone can post. Owners can pin / mark urgent. Anyone can mark read.
 * Author can delete their own; owners can delete any.
 */
export default function TeamComms({ setPage }: Props) {
  const user = useStore((s) => s.user)!;
  const profiles = useStore((s) => s.profiles);
  const darkMode = useStore((s) => s.darkMode);
  const isOwner = user.role === "owner" || user.role === "manager";

  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [posting, setPosting] = useState(false);
  const [loading, setLoading] = useState(true);
  // Error string when load/post failed because the table is missing or RLS
  // is blocking. Surfaces as an inline banner with the migration SQL so the
  // user can fix it without leaving the screen.
  const [setupError, setSetupError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Bypass the db helper's swallow-error path so we can detect a missing
      // table and show actionable setup help.
      const orgId = (() => {
        try {
          const u = JSON.parse(localStorage.getItem("c_user") || "null");
          return u?.org_id || null;
        } catch { return null; }
      })();
      let query = supabase.from("team_messages").select("*").order("created_at", { ascending: false });
      if (orgId) query = query.eq("org_id", orgId);
      const { data, error } = await query;
      if (error) {
        setSetupError(error.message);
        setMessages([]);
      } else {
        setSetupError(null);
        setMessages((data as TeamMessage[]) || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = async () => {
    if (!draft.trim()) return;
    setPosting(true);
    try {
      const result = await db.post("team_messages", {
        author_id: user.id,
        author_name: user.name,
        message: draft.trim(),
        urgent,
        read_by: JSON.stringify([user.id]), // author has implicitly "read" their own post
      });
      // db.post returns null on error and already toasts the underlying
      // message — surface the setup banner too so the cause is obvious.
      if (result === null) {
        setSetupError("Insert failed — table may not exist or RLS is blocking.");
        return;
      }
      setSetupError(null);
      setDraft("");
      setUrgent(false);
      await load();
    } finally {
      setPosting(false);
    }
  };

  const markRead = async (m: TeamMessage) => {
    let readBy: string[] = [];
    try { readBy = m.read_by ? JSON.parse(m.read_by) : []; } catch { /* */ }
    if (readBy.includes(user.id)) return;
    readBy.push(user.id);
    await db.patch("team_messages", m.id, { read_by: JSON.stringify(readBy) });
    setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, read_by: JSON.stringify(readBy) } : x));
  };

  const remove = async (m: TeamMessage) => {
    if (!await useStore.getState().showConfirm("Delete Message", "Remove this message for everyone?")) return;
    await db.del("team_messages", m.id);
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
  };

  const formatWhen = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const border = darkMode ? "#1e1e2e" : "#eee";

  return (
    <div className="fi">
      <div className="row mb" style={{ justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 22, color: "var(--color-primary)", display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="comms" size={22} color="var(--color-primary)" />
          Team Comms
        </h2>
        {setPage && (
          <button className="bo" onClick={() => setPage("dash")} style={{ fontSize: 12, padding: "4px 10px" }}>
            ← Dashboard
          </button>
        )}
      </div>

      {/* Setup help — shown when the table is missing or an insert was
          blocked. Inline migration SQL so the admin can copy-paste straight
          into Supabase without leaving the screen. */}
      {setupError && (
        <div
          className="cd mb"
          style={{
            borderLeft: "3px solid var(--color-warning)",
            padding: 12,
          }}
        >
          <h4 style={{ fontSize: 13, color: "var(--color-warning)", marginBottom: 4 }}>
            ⚠ Team Comms not set up yet
          </h4>
          <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>
            Run this once in your Supabase SQL editor to enable the message board:
          </div>
          <pre
            style={{
              background: darkMode ? "#0d0d14" : "#f7f7fa",
              border: `1px solid ${darkMode ? "#1e1e2e" : "#ddd"}`,
              borderRadius: 6,
              padding: 8,
              fontSize: 11,
              fontFamily: "monospace",
              overflowX: "auto",
              margin: 0,
              whiteSpace: "pre-wrap",
              color: "inherit",
            }}
          >{`CREATE TABLE team_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,
  author_id UUID,
  author_name TEXT,
  message TEXT NOT NULL,
  urgent BOOLEAN DEFAULT FALSE,
  read_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE team_messages DISABLE ROW LEVEL SECURITY;`}</pre>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`CREATE TABLE team_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID,
  author_id UUID,
  author_name TEXT,
  message TEXT NOT NULL,
  urgent BOOLEAN DEFAULT FALSE,
  read_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE team_messages DISABLE ROW LEVEL SECURITY;`);
              useStore.getState().showToast("Migration SQL copied", "success");
            }}
            className="bo"
            style={{ fontSize: 11, padding: "4px 10px", marginTop: 6 }}
          >
            📋 Copy SQL
          </button>
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
            Error: <span style={{ fontFamily: "monospace" }}>{setupError}</span>
          </div>
          <button
            onClick={load}
            className="bb"
            style={{ fontSize: 11, padding: "4px 10px", marginTop: 6, marginLeft: 6 }}
          >
            🔁 Retry after running migration
          </button>
        </div>
      )}

      {/* Compose */}
      <div className="cd mb" style={{ padding: 12 }}>
        <div className="dim" style={{ fontSize: 11, marginBottom: 6, fontFamily: "Oswald", letterSpacing: ".06em" }}>
          POST AN UPDATE
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`What does the team need to know, ${user.name?.split(/\s+/)[0] || "team"}?`}
          rows={3}
          style={{
            width: "100%",
            fontSize: 13,
            padding: 8,
            borderRadius: 6,
            border: `1px solid ${border}`,
            background: darkMode ? "#0d0d14" : "#f7f7fa",
            color: "inherit",
            resize: "vertical",
            marginBottom: 8,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={urgent}
              onChange={(e) => setUrgent(e.target.checked)}
              style={{ width: 14, height: 14 }}
            />
            <span style={{ color: urgent ? "var(--color-accent-red)" : undefined }}>
              🚨 Mark urgent
            </span>
          </label>
          <button
            className="bb"
            onClick={post}
            disabled={!draft.trim() || posting}
            style={{ fontSize: 13, padding: "6px 16px", opacity: !draft.trim() || posting ? 0.5 : 1 }}
          >
            {posting ? "Posting..." : "Post"}
          </button>
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="cd" style={{ textAlign: "center", padding: 24 }}>
          <p className="dim" style={{ fontSize: 12 }}>Loading messages…</p>
        </div>
      ) : messages.length === 0 ? (
        <div className="cd" style={{ textAlign: "center", padding: 24 }}>
          <p className="dim" style={{ fontSize: 13 }}>No messages yet — post the first one above.</p>
        </div>
      ) : (
        messages.map((m) => {
          let readBy: string[] = [];
          try { readBy = m.read_by ? JSON.parse(m.read_by) : []; } catch { /* */ }
          const hasRead = readBy.includes(user.id);
          const readCount = readBy.length;
          const totalTeam = profiles.length;
          const author = profiles.find((p) => p.id === m.author_id);
          const isOwn = m.author_id === user.id;
          const canDelete = isOwn || isOwner;
          return (
            <div
              key={m.id}
              onClick={() => markRead(m)}
              className="cd mb"
              style={{
                padding: 12,
                borderLeft: `3px solid ${m.urgent ? "var(--color-accent-red)" : hasRead ? border : "var(--color-primary)"}`,
                cursor: hasRead ? "default" : "pointer",
                opacity: hasRead ? 0.92 : 1,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                {/* Author avatar */}
                <div
                  style={{
                    width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                    background: author?.photo_url ? `url(${author.photo_url}) center/cover` : "var(--color-primary)",
                    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontFamily: "Oswald", fontWeight: 700,
                  }}
                >
                  {!author?.photo_url && (m.author_name?.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?")}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                      {m.author_name}
                      {m.urgent && (
                        <span style={{ fontSize: 10, marginLeft: 6, padding: "1px 6px", borderRadius: 8, background: "var(--color-accent-red)22", color: "var(--color-accent-red)", fontFamily: "Oswald", letterSpacing: ".06em" }}>
                          URGENT
                        </span>
                      )}
                    </span>
                    <span className="dim" style={{ fontSize: 11 }}>{formatWhen(m.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {m.message}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                    <span className="dim" style={{ fontSize: 11 }}>
                      Read by {readCount}/{totalTeam}
                      {!hasRead && <span style={{ color: "var(--color-primary)", marginLeft: 6, fontFamily: "Oswald" }}>· Tap to mark read</span>}
                    </span>
                    {canDelete && (
                      <button
                        onClick={(e) => { e.stopPropagation(); remove(m); }}
                        aria-label="Delete message"
                        style={{ background: "none", color: "var(--color-accent-red)", fontSize: 13, padding: "0 4px", display: "inline-flex", alignItems: "center" }}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
