"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { Icon } from "../Icon";
import type { Address, Equipment } from "@/lib/types";

/**
 * Equipment / asset history for a customer — the units at their property
 * (HVAC, water heater, panel…) with make/model/serial/install/warranty +
 * photos. `last_service_at` is stamped automatically when a linked job
 * completes (see Jobs setStatus / WorkVision). Used inside CustomerDetail.
 */
const KINDS: { key: string; label: string }[] = [
  { key: "hvac", label: "HVAC / AC" },
  { key: "furnace", label: "Furnace" },
  { key: "water_heater", label: "Water heater" },
  { key: "panel", label: "Electrical panel" },
  { key: "other", label: "Other" },
];
const kindLabel = (k?: string) => KINDS.find((x) => x.key === k)?.label || k || "Equipment";

const BLANK = {
  kind: "hvac", make: "", model: "", serial: "", installed_at: "", warranty_until: "",
  address_id: "", notes: "", photos: [] as { url: string; label?: string }[],
};

export default function EquipmentSection({ customerId, addresses }: { customerId: string; addresses: Address[] }) {
  const equipment = useStore((s) => s.equipment) ?? [];
  const upsertEquipment = useStore((s) => s.upsertEquipment);
  const deleteEquipment = useStore((s) => s.deleteEquipment);
  const showToast = useStore((s) => s.showToast);
  const showConfirm = useStore((s) => s.showConfirm);

  const units = equipment.filter((e) => e.customer_id === customerId);
  const [editing, setEditing] = useState<string | null>(null); // id | "new" | null
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const addrLabel = (id?: string | null) => {
    const a = addresses.find((x) => x.id === id);
    return a ? (a.label || [a.street, a.city].filter(Boolean).join(", ")) : "";
  };

  const startNew = () => {
    setForm({ ...BLANK, address_id: addresses.find((a) => a.is_primary)?.id || addresses[0]?.id || "" });
    setEditing("new");
  };
  const startEdit = (e: Equipment) => {
    setForm({
      kind: e.kind || "hvac", make: e.make || "", model: e.model || "", serial: e.serial || "",
      installed_at: (e.installed_at || "").split("T")[0], warranty_until: (e.warranty_until || "").split("T")[0],
      address_id: e.address_id || "", notes: e.notes || "", photos: Array.isArray(e.photos) ? e.photos : [],
    });
    setEditing(e.id);
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `equipment/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file);
      if (error) { showToast("Photo upload failed: " + error.message, "error"); return; }
      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
      if (data?.publicUrl) setForm((f) => ({ ...f, photos: [...f.photos, { url: data.publicUrl }] }));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    const payload: Partial<Equipment> & { kind: string } = {
      kind: form.kind,
      make: form.make.trim() || undefined,
      model: form.model.trim() || undefined,
      serial: form.serial.trim() || undefined,
      installed_at: form.installed_at || undefined,
      warranty_until: form.warranty_until || undefined,
      address_id: form.address_id || undefined,
      property: addrLabel(form.address_id) || undefined,
      notes: form.notes.trim() || undefined,
      photos: form.photos,
      customer_id: customerId,
    };
    if (editing && editing !== "new") payload.id = editing;
    await upsertEquipment(payload);
    setSaving(false);
    setEditing(null);
    showToast("Equipment saved", "success");
  };

  const remove = async (e: Equipment) => {
    if (!(await showConfirm("Delete equipment", `Delete this ${kindLabel(e.kind)}? Its service history will no longer be linked.`))) return;
    await deleteEquipment(e.id);
    showToast("Equipment removed", "success");
  };

  const warranty = (e: Equipment) => {
    if (!e.warranty_until) return null;
    const d = new Date(e.warranty_until);
    if (isNaN(d.getTime())) return null;
    const now = Date.now();
    const expired = d.getTime() < now;
    const soon = !expired && d.getTime() - now < 60 * 24 * 3600 * 1000;
    return { color: expired ? "var(--color-accent-red)" : soon ? "var(--color-warning)" : "var(--color-money)", label: `${expired ? "Warranty expired" : "Under warranty until"} ${d.toLocaleDateString()}` };
  };

  return (
    <div className="cd mb">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8 }}>
        <h4 style={{ fontSize: 15, margin: 0 }}>🔧 Equipment{units.length ? ` (${units.length})` : ""}</h4>
        {editing === null && (
          <button className="bo" style={{ fontSize: 12.5, padding: "4px 10px", width: "auto", flexShrink: 0 }} onClick={startNew}>
            <Icon name="add" size={13} /> Add
          </button>
        )}
      </div>

      {units.length === 0 && editing === null && (
        <div className="dim" style={{ fontSize: 13 }}>No equipment on file. Add a unit to track its service history.</div>
      )}

      {editing === null && units.map((e) => {
        const w = warranty(e);
        return (
          <div key={e.id} style={{ borderTop: "1px solid var(--color-border-dark)", paddingTop: 9, marginTop: 9 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{kindLabel(e.kind)}{e.make || e.model ? ` — ${[e.make, e.model].filter(Boolean).join(" ")}` : ""}</div>
                {e.serial && <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>S/N {e.serial}</div>}
                <div style={{ fontSize: 11.5, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap", color: "var(--color-dim)" }}>
                  {e.address_id && <span>{addrLabel(e.address_id)}</span>}
                  {e.installed_at && <span>Installed {new Date(e.installed_at).toLocaleDateString()}</span>}
                  {e.last_service_at && <span>Serviced {new Date(e.last_service_at).toLocaleDateString()}</span>}
                </div>
                {w && <div style={{ fontSize: 11.5, marginTop: 3, color: w.color }}>{w.label}</div>}
                {e.notes && <div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{e.notes}</div>}
                {Array.isArray(e.photos) && e.photos.length > 0 && (
                  <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                    {e.photos.map((p, i) => (
                      <a key={i} href={p.url} target="_blank" rel="noreferrer">
                        <img src={p.url} alt="" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 6, border: "1px solid var(--color-border-dark)" }} />
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: 4, flexShrink: 0 }}>
                <button className="iconbtn" title="Edit" onClick={() => startEdit(e)}><Icon name="edit" size={15} /></button>
                <button className="iconbtn" title="Delete" onClick={() => remove(e)}><Icon name="delete" size={15} color="var(--color-accent-red)" /></button>
              </div>
            </div>
          </div>
        );
      })}

      {editing !== null && (
        <div style={{ borderTop: units.length ? "1px solid var(--color-border-dark)" : "none", paddingTop: units.length ? 10 : 0, marginTop: units.length ? 10 : 0 }}>
          <div className="g2">
            <div>
              <label className="sl" style={{ fontSize: 12 }}>Type</label>
              <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))} style={{ fontSize: 15 }}>
                {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </div>
            {addresses.length > 0 && (
              <div>
                <label className="sl" style={{ fontSize: 12 }}>Property</label>
                <select value={form.address_id} onChange={(e) => setForm((f) => ({ ...f, address_id: e.target.value }))} style={{ fontSize: 15 }}>
                  <option value="">—</option>
                  {addresses.map((a) => <option key={a.id} value={a.id}>{a.label || [a.street, a.city].filter(Boolean).join(", ")}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="g2" style={{ marginTop: 8 }}>
            <div><label className="sl" style={{ fontSize: 12 }}>Make</label><input value={form.make} onChange={(e) => setForm((f) => ({ ...f, make: e.target.value }))} placeholder="Carrier" style={{ fontSize: 15 }} /></div>
            <div><label className="sl" style={{ fontSize: 12 }}>Model</label><input value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="24ACC6" style={{ fontSize: 15 }} /></div>
          </div>
          <label className="sl" style={{ fontSize: 12, marginTop: 8, display: "block" }}>Serial #</label>
          <input value={form.serial} onChange={(e) => setForm((f) => ({ ...f, serial: e.target.value }))} placeholder="Serial number" style={{ fontSize: 15, marginBottom: 8 }} />
          <div className="g2">
            <div><label className="sl" style={{ fontSize: 12 }}>Installed</label><input type="date" value={form.installed_at} onChange={(e) => setForm((f) => ({ ...f, installed_at: e.target.value }))} style={{ fontSize: 15 }} /></div>
            <div><label className="sl" style={{ fontSize: 12 }}>Warranty until</label><input type="date" value={form.warranty_until} onChange={(e) => setForm((f) => ({ ...f, warranty_until: e.target.value }))} style={{ fontSize: 15 }} /></div>
          </div>
          <label className="sl" style={{ fontSize: 12, marginTop: 8, display: "block" }}>Notes</label>
          <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Location, quirks, filter size…" style={{ fontSize: 14, minHeight: 54, width: "100%" }} />

          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
            {form.photos.map((p, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={p.url} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 6, border: "1px solid var(--color-border-dark)" }} />
                <button
                  onClick={() => setForm((f) => ({ ...f, photos: f.photos.filter((_, j) => j !== i) }))}
                  style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: 9, background: "var(--color-accent-red)", color: "#fff", border: "none", fontSize: 11, cursor: "pointer", lineHeight: 1 }}
                >×</button>
              </div>
            ))}
            <label className="bo" style={{ fontSize: 12.5, padding: "6px 12px", width: "auto", cursor: uploading ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="camera" size={14} /> {uploading ? "Uploading…" : "Photo"}
              <input type="file" accept="image/*" disabled={uploading} style={{ display: "none" }} onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadPhoto(file); e.target.value = ""; }} />
            </label>
          </div>

          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <button className="bg" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            <button className="bo" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
