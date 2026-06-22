"use client";
/**
 * Recurring — list + manage active recurring-job templates.
 *
 * Each row spawns a fresh `jobs` row on cadence (server cron at
 * /api/recurring/fire). Templates live in the `recurring_jobs` table;
 * the rooms/data/workOrder blob is copied verbatim to every new job so
 * pricing and the work order travel forward.
 *
 * Two entry points create templates:
 *   1. The "Make recurring" button on a job's expanded row (Jobs.tsx).
 *   2. The "+ New from job" picker here.
 * Both paths land here — this screen owns the lifecycle (pause, edit
 * cadence, fire-now, delete).
 */
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";
import { Icon } from "../Icon";
import {
  CADENCES,
  CADENCE_LABELS,
  DAY_OF_WEEK_LABELS,
  computeNextFire,
  formatNextFire,
  type Cadence,
} from "@/lib/recurring";
import type { Job, RecurringJob } from "@/lib/types";

export default function Recurring() {
  const user = useStore((s) => s.user)!;
  const recurringJobs = useStore((s) => s.recurringJobs);
  const jobs = useStore((s) => s.jobs);
  const loadAll = useStore((s) => s.loadAll);
  const darkMode = useStore((s) => s.darkMode);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [firingId, setFiringId] = useState<string | null>(null);

  const border = darkMode ? "#1e1e2e" : "#eee";

  const active = recurringJobs.filter((r) => r.is_active);
  const paused = recurringJobs.filter((r) => !r.is_active);

  const togglePause = async (r: RecurringJob) => {
    const next = !r.is_active;
    // When resuming, push next_fire_at out to "now + cadence" so it
    // doesn't immediately fire on the next cron tick (the cron picks
    // up any active row with next_fire_at <= NOW or NULL).
    const updates: Record<string, unknown> = {
      is_active: next,
      updated_at: new Date().toISOString(),
    };
    if (next) {
      updates.next_fire_at = computeNextFire(new Date(), r.cadence, {
        dayOfWeek: r.day_of_week,
        dayOfMonth: r.day_of_month,
        hour: r.hour,
      }).toISOString();
    }
    await db.patch("recurring_jobs", r.id, updates);
    await loadAll();
  };

  const deleteOne = async (r: RecurringJob) => {
    const label = r.title || r.property || "this template";
    if (!await useStore.getState().showConfirm("Delete recurring template", `Stop recurring "${label}"? Jobs already created from it are kept.`)) return;
    await db.del("recurring_jobs", r.id);
    await loadAll();
  };

  const fireNow = async (r: RecurringJob) => {
    if (!await useStore.getState().showConfirm("Fire recurring now", `Create a new job from "${r.title || r.property}" right now?`)) return;
    setFiringId(r.id);
    try {
      const adminPw = (typeof window !== "undefined" && (window as unknown as { __adminPw?: string }).__adminPw) || "";
      const res = await fetch(`/api/recurring/fire?force=1&id=${encodeURIComponent(r.id)}`, {
        headers: adminPw ? { "x-admin-token": adminPw } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        useStore.getState().showToast(
          `Fire failed: ${err?.error || res.statusText}. Tip: set window.__adminPw="<pw>" first.`,
          "warning",
        );
        setFiringId(null);
        return;
      }
      const json = await res.json();
      const count = Array.isArray(json?.fired) ? json.fired.length : 0;
      useStore.getState().showToast(
        count > 0 ? `Created ${count} job — check Jobs` : "No job was created — see console",
        count > 0 ? "success" : "warning",
      );
      await loadAll();
    } finally {
      setFiringId(null);
    }
  };

  return (
    <div className="fi">
      <div className="row mb" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 18, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Icon name="refresh" size={18} color="var(--color-primary)" />
          Recurring jobs
        </h3>
        <button className="bb" onClick={() => setShowAdd(true)} style={{ fontSize: 14 }}>
          <Icon name="add" size={14} /> New from job
        </button>
      </div>

      <div className="cd mb" style={{ fontSize: 14, color: "var(--color-dim)", display: "flex", gap: 8, alignItems: "flex-start" }}>
        <span style={{ flexShrink: 0, marginTop: 1 }}><Icon name="info" size={16} color="var(--color-primary)" /></span>
        <div>Templates fire daily via cron. Each fire creates a new <strong style={{ color: "inherit" }}>scheduled</strong> job copied from the template. Pause to skip without losing the schedule.</div>
      </div>

      {recurringJobs.length === 0 && (
        <div className="cd" style={{ textAlign: "center", padding: 28, color: "var(--color-dim)" }}>
          <Icon name="refresh" size={28} color="var(--color-dim)" />
          <div style={{ marginTop: 10, fontSize: 16 }}>No recurring templates yet.</div>
          <div style={{ fontSize: 14, marginTop: 6 }}>
            Make any existing job recurring from its expanded row in Jobs.
          </div>
        </div>
      )}

      {active.length > 0 && (
        <>
          <div className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 6, letterSpacing: ".06em", textTransform: "uppercase" }}>
            Active ({active.length})
          </div>
          {active.map((r) => (
            <RowCard
              key={r.id}
              r={r}
              border={border}
              isFiring={firingId === r.id}
              isEditing={editingId === r.id}
              onEdit={() => setEditingId(editingId === r.id ? null : r.id)}
              onTogglePause={() => togglePause(r)}
              onFire={() => fireNow(r)}
              onDelete={() => deleteOne(r)}
              onSavedEdit={() => setEditingId(null)}
            />
          ))}
        </>
      )}

      {paused.length > 0 && (
        <>
          <div className="dim" style={{ fontSize: 13, marginTop: 14, marginBottom: 6, letterSpacing: ".06em", textTransform: "uppercase" }}>
            Paused ({paused.length})
          </div>
          {paused.map((r) => (
            <RowCard
              key={r.id}
              r={r}
              border={border}
              isFiring={firingId === r.id}
              isEditing={editingId === r.id}
              onEdit={() => setEditingId(editingId === r.id ? null : r.id)}
              onTogglePause={() => togglePause(r)}
              onFire={() => fireNow(r)}
              onDelete={() => deleteOne(r)}
              onSavedEdit={() => setEditingId(null)}
            />
          ))}
        </>
      )}

      {showAdd && (
        <NewFromJobPicker
          jobs={jobs}
          onClose={() => setShowAdd(false)}
          orgId={user.org_id}
          onCreated={async () => {
            setShowAdd(false);
            await loadAll();
          }}
        />
      )}
    </div>
  );
}

function RowCard({
  r,
  border,
  isFiring,
  isEditing,
  onEdit,
  onTogglePause,
  onFire,
  onDelete,
  onSavedEdit,
}: {
  r: RecurringJob;
  border: string;
  isFiring: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onTogglePause: () => void;
  onFire: () => void;
  onDelete: () => void;
  onSavedEdit: () => void;
}) {
  return (
    <div className="cd mb statusstrip" style={{ ["--c" as any]: r.is_active ? "var(--color-success)" : "#888" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>
            {r.title || r.property || "Recurring service"}
          </div>
          <div className="dim" style={{ fontSize: 14, marginTop: 2 }}>
            {r.client ? `${r.client} · ` : ""}
            {r.property || "—"}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8, fontSize: 14 }}>
            <span>
              <span className="dim">Cadence: </span>
              <strong>{CADENCE_LABELS[r.cadence] || r.cadence}</strong>
            </span>
            <span>
              <span className="dim">Next: </span>
              <strong>{formatNextFire(r.next_fire_at)}</strong>
            </span>
            <span>
              <span className="dim">Last: </span>
              {r.last_fired_at ? formatNextFire(r.last_fired_at) : <em className="dim">never</em>}
            </span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <button className="bo" onClick={onEdit} style={{ fontSize: 13, padding: "4px 10px" }}>
            <Icon name="edit" size={12} /> Edit
          </button>
          <button
            className={r.is_active ? "bo" : "bg"}
            onClick={onTogglePause}
            style={{ fontSize: 13, padding: "4px 10px" }}
          >
            {r.is_active ? <><Icon name="pause" size={12} /> Pause</> : <><Icon name="start" size={12} /> Resume</>}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 10, borderTop: `1px solid ${border}`, paddingTop: 8 }}>
        <button
          className="bb"
          onClick={onFire}
          disabled={isFiring}
          style={{ fontSize: 13, padding: "4px 10px", opacity: isFiring ? 0.6 : 1 }}
        >
          <Icon name="rocket" size={12} /> {isFiring ? "Firing…" : "Fire now"}
        </button>
        <button className="br" onClick={onDelete} style={{ fontSize: 13, padding: "4px 10px", marginLeft: "auto" }}>
          <Icon name="delete" size={12} /> Delete
        </button>
      </div>

      {isEditing && <EditPanel r={r} onSaved={onSavedEdit} />}
    </div>
  );
}

function EditPanel({ r, onSaved }: { r: RecurringJob; onSaved: () => void }) {
  const loadAll = useStore((s) => s.loadAll);
  const [cadence, setCadence] = useState<Cadence>(r.cadence);
  const [dayOfWeek, setDayOfWeek] = useState<number>(r.day_of_week ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState<number>(r.day_of_month ?? 1);
  const [hour, setHour] = useState<number>(r.hour ?? 9);
  const [title, setTitle] = useState<string>(r.title || "");
  const [saving, setSaving] = useState(false);

  const isWeekly = cadence === "weekly" || cadence === "biweekly";

  const save = async () => {
    setSaving(true);
    const nextFire = computeNextFire(new Date(), cadence, {
      dayOfWeek: isWeekly ? dayOfWeek : undefined,
      dayOfMonth: !isWeekly ? dayOfMonth : undefined,
      hour,
    });
    await db.patch("recurring_jobs", r.id, {
      cadence,
      day_of_week: isWeekly ? dayOfWeek : null,
      day_of_month: !isWeekly ? dayOfMonth : null,
      hour,
      title: title.trim() || null,
      next_fire_at: nextFire.toISOString(),
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    await loadAll();
    onSaved();
  };

  return (
    <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "var(--color-bg-subtle, #f3f4f6)" }}>
      <div className="g2" style={{ gap: 8 }}>
        <div>
          <label className="sl">Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Lawn maintenance"
            style={{ marginTop: 4 }}
          />
        </div>
        <div>
          <label className="sl">Cadence</label>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value as Cadence)}
            style={{ marginTop: 4 }}
          >
            {CADENCES.map((c) => (
              <option key={c} value={c}>{CADENCE_LABELS[c]}</option>
            ))}
          </select>
        </div>
        {isWeekly ? (
          <div>
            <label className="sl">Day of week</label>
            <select
              value={dayOfWeek}
              onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10))}
              style={{ marginTop: 4 }}
            >
              {DAY_OF_WEEK_LABELS.map((lbl, i) => (
                <option key={i} value={i}>{lbl}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="sl">Day of month (1-28)</label>
            <input
              type="number"
              min={1}
              max={28}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10) || 1)}
              style={{ marginTop: 4 }}
            />
          </div>
        )}
        <div>
          <label className="sl">Hour (0-23)</label>
          <input
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(e) => setHour(parseInt(e.target.value, 10) || 0)}
            style={{ marginTop: 4 }}
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10, gap: 6 }}>
        <button className="bb" onClick={save} disabled={saving} style={{ fontSize: 14 }}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="bo" onClick={onSaved} style={{ fontSize: 14 }}>Cancel</button>
      </div>
    </div>
  );
}

function NewFromJobPicker({
  jobs,
  orgId,
  onClose,
  onCreated,
}: {
  jobs: Job[];
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [jobId, setJobId] = useState<string>("");
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [hour, setHour] = useState<number>(9);
  const [title, setTitle] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Templating from anything completed or in flight makes sense — leads
  // and quoted-only jobs typically have no rooms/work-order yet. Sort by
  // most recent so the picker surfaces the freshest candidates first.
  const candidates = jobs
    .filter((j) => ["accepted", "scheduled", "active", "complete", "invoiced", "paid"].includes(j.status))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
    .slice(0, 100);

  const selected = candidates.find((j) => j.id === jobId);
  const isWeekly = cadence === "weekly" || cadence === "biweekly";

  const save = async () => {
    if (!selected) {
      useStore.getState().showToast("Pick a job to template from", "warning");
      return;
    }
    setSaving(true);
    let templateRooms: unknown = {};
    try {
      templateRooms = typeof selected.rooms === "string" ? JSON.parse(selected.rooms) : selected.rooms;
    } catch {
      templateRooms = {};
    }
    const nextFire = computeNextFire(new Date(), cadence, {
      dayOfWeek: isWeekly ? dayOfWeek : undefined,
      dayOfMonth: !isWeekly ? dayOfMonth : undefined,
      hour,
    });
    await db.post("recurring_jobs", {
      org_id: orgId,
      customer_id: selected.customer_id ?? null,
      address_id: selected.address_id ?? null,
      property: selected.property,
      client: selected.client,
      template_rooms: templateRooms,
      title: title.trim() || selected.property || "Recurring service",
      cadence,
      day_of_week: isWeekly ? dayOfWeek : null,
      day_of_month: !isWeekly ? dayOfMonth : null,
      hour,
      is_active: true,
      next_fire_at: nextFire.toISOString(),
    });
    setSaving(false);
    useStore.getState().showToast("Recurring template created", "success");
    onCreated();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 1500,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        className="cd"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480 }}
      >
        <div className="row mb" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 17 }}>New recurring template</h3>
          <button className="bo" onClick={onClose} style={{ padding: "2px 8px" }}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <label className="sl">Template from job</label>
        <select
          value={jobId}
          onChange={(e) => { setJobId(e.target.value); const j = candidates.find((x) => x.id === e.target.value); if (j) setTitle(j.property || ""); }}
          style={{ marginTop: 4 }}
        >
          <option value="">Pick a job…</option>
          {candidates.map((j) => (
            <option key={j.id} value={j.id}>
              {j.property} — {j.client || "—"} ({j.status})
            </option>
          ))}
        </select>

        <div className="g2 mb" style={{ gap: 8, marginTop: 10 }}>
          <div>
            <label className="sl">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lawn maintenance"
              style={{ marginTop: 4 }}
            />
          </div>
          <div>
            <label className="sl">Cadence</label>
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value as Cadence)}
              style={{ marginTop: 4 }}
            >
              {CADENCES.map((c) => (
                <option key={c} value={c}>{CADENCE_LABELS[c]}</option>
              ))}
            </select>
          </div>
          {isWeekly ? (
            <div>
              <label className="sl">Day of week</label>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10))}
                style={{ marginTop: 4 }}
              >
                {DAY_OF_WEEK_LABELS.map((lbl, i) => (
                  <option key={i} value={i}>{lbl}</option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="sl">Day of month (1-28)</label>
              <input
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(parseInt(e.target.value, 10) || 1)}
                style={{ marginTop: 4 }}
              />
            </div>
          )}
          <div>
            <label className="sl">Hour (0-23)</label>
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) => setHour(parseInt(e.target.value, 10) || 0)}
              style={{ marginTop: 4 }}
            />
          </div>
        </div>

        <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
          Next fire: <strong>{formatNextFire(computeNextFire(new Date(), cadence, { dayOfWeek: isWeekly ? dayOfWeek : undefined, dayOfMonth: !isWeekly ? dayOfMonth : undefined, hour }).toISOString())}</strong>
        </div>

        <div className="row" style={{ marginTop: 12, gap: 6 }}>
          <button className="bb" onClick={save} disabled={saving} style={{ fontSize: 14 }}>
            {saving ? "Saving…" : "Create"}
          </button>
          <button className="bo" onClick={onClose} style={{ fontSize: 14 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
