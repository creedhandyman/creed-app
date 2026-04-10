"use client";
import { useState, useRef } from "react";
import { supabase } from "@/lib/supabase";

/* ── Preset rooms and items ── */
const ROOM_PRESETS: Record<string, string[]> = {
  Kitchen: ["Sink/Faucet", "Counters", "Cabinets", "Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Appliances", "Electrical/Lights", "Caulking"],
  "Living Room": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Electrical/Lights", "Baseboards"],
  "Dining Room": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Electrical/Lights", "Baseboards"],
  Entry: ["Flooring", "Walls/Ceiling", "Door/Lock", "Doorbell", "Electrical/Lights"],
  "Hallway/Stairs": ["Flooring", "Walls/Ceiling", "Electrical/Lights", "Railings", "Baseboards"],
  "Laundry Room": ["Flooring", "Walls/Ceiling", "Connections", "Venting", "Cabinets", "Electrical"],
  "Bedroom 1": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Closet", "Electrical/Lights", "Baseboards"],
  "Bedroom 2": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Closet", "Electrical/Lights", "Baseboards"],
  "Bedroom 3": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Closet", "Electrical/Lights", "Baseboards"],
  "Bedroom 4": ["Flooring", "Walls/Ceiling", "Doors", "Windows/Blinds", "Closet", "Electrical/Lights", "Baseboards"],
  "Bathroom 1": ["Toilet", "Sink/Vanity", "Tub/Shower", "Flooring", "Walls/Ceiling", "Mirror/Medicine Cabinet", "Towel Bar/TP Holder", "Exhaust Fan", "Caulking", "Electrical/Lights"],
  "Bathroom 2": ["Toilet", "Sink/Vanity", "Tub/Shower", "Flooring", "Walls/Ceiling", "Mirror/Medicine Cabinet", "Towel Bar/TP Holder", "Exhaust Fan", "Caulking", "Electrical/Lights"],
  "Bathroom 3": ["Toilet", "Sink/Vanity", "Tub/Shower", "Flooring", "Walls/Ceiling", "Mirror/Medicine Cabinet", "Towel Bar/TP Holder", "Exhaust Fan", "Caulking", "Electrical/Lights"],
  Garage: ["Door/Opener", "Flooring", "Walls", "Electrical/Lights", "Exterior Door"],
  Exterior: ["Siding", "Gutters/Downspouts", "Porch/Deck", "Landscaping", "Exterior Lights", "Fencing", "HVAC Unit"],
};

// Display order for the room selection grid
const ROOM_ORDER = [
  "Kitchen", "Living Room",
  "Dining Room", "Entry",
  "Hallway/Stairs", "Laundry Room",
  "Bedroom 1", "Bedroom 2",
  "Bedroom 3", "Bedroom 4",
  "Bathroom 1", "Bathroom 2",
  "Bathroom 3", "Garage",
  "Exterior",
];

const CONDITIONS = [
  { code: "S", label: "OK", color: "var(--color-success)", bg: "#00cc6622" },
  { code: "F", label: "Fair", color: "var(--color-highlight)", bg: "#ffcc0022" },
  { code: "P", label: "Poor", color: "var(--color-warning)", bg: "#ff880022" },
  { code: "D", label: "DMG", color: "var(--color-accent-red)", bg: "#C0000022" },
];

export interface InspectionItem {
  name: string;
  condition: string;
  notes: string;
  photos: string[]; // public URLs
}

export interface InspectionRoom {
  name: string;
  items: InspectionItem[];
}

export interface InspectionData {
  rooms: InspectionRoom[];
  property: string;
  client: string;
}

interface Props {
  onComplete: (data: InspectionData) => void;
  onCancel: () => void;
  darkMode: boolean;
}

type Step = "rooms" | "inspect" | "review";

export default function Inspector({ onComplete, onCancel, darkMode }: Props) {
  const [step, setStep] = useState<Step>("rooms");
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [customRoom, setCustomRoom] = useState("");
  const [property, setProperty] = useState("");
  const [client, setClient] = useState("");
  const [currentRoomIdx, setCurrentRoomIdx] = useState(0);
  const [roomData, setRoomData] = useState<InspectionRoom[]>([]);
  const [uploading, setUploading] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const [photoTarget, setPhotoTarget] = useState<{ room: number; item: number } | null>(null);

  const border = darkMode ? "#1e1e2e" : "#eee";

  /* ── Room selection helpers ── */
  const toggleRoom = (room: string) => {
    setSelectedRooms((prev) =>
      prev.includes(room) ? prev.filter((r) => r !== room) : [...prev, room]
    );
  };

  const addCustomRoom = () => {
    if (!customRoom.trim() || selectedRooms.includes(customRoom.trim())) return;
    setSelectedRooms((prev) => [...prev, customRoom.trim()]);
    setCustomRoom("");
  };

  const startInspection = () => {
    const data = selectedRooms.map((room) => {
      const presetKey = Object.keys(ROOM_PRESETS).find(
        (k) => k === room || room.startsWith(k.replace(/ \d+$/, ""))
      );
      const items = (presetKey ? ROOM_PRESETS[presetKey] : ["General"]).map(
        (name) => ({ name, condition: "S", notes: "", photos: [] })
      );
      return { name: room, items };
    });
    setRoomData(data);
    setCurrentRoomIdx(0);
    setStep("inspect");
  };

  /* ── Inspection helpers ── */
  const updateItem = (roomIdx: number, itemIdx: number, field: keyof InspectionItem, value: string | string[]) => {
    setRoomData((prev) =>
      prev.map((r, ri) =>
        ri === roomIdx
          ? {
              ...r,
              items: r.items.map((it, ii) =>
                ii === itemIdx ? { ...it, [field]: value } : it
              ),
            }
          : r
      )
    );
  };

  const uploadPhoto = async (file: File, roomIdx: number, itemIdx: number) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `inspections/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file);
      if (error) throw error;
      const { data } = supabase.storage.from("receipts").getPublicUrl(path);
      const url = data.publicUrl;
      setRoomData((prev) =>
        prev.map((r, ri) =>
          ri === roomIdx
            ? {
                ...r,
                items: r.items.map((it, ii) =>
                  ii === itemIdx ? { ...it, photos: [...it.photos, url] } : it
                ),
              }
            : r
        )
      );
    } catch (err) {
      console.error("Photo upload failed:", err);
      alert("Photo upload failed");
    }
    setUploading(false);
  };

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !photoTarget) return;
    uploadPhoto(file, photoTarget.room, photoTarget.item);
    if (photoRef.current) photoRef.current.value = "";
  };

  const addItemToRoom = (roomIdx: number) => {
    setRoomData((prev) =>
      prev.map((r, ri) =>
        ri === roomIdx
          ? { ...r, items: [...r.items, { name: "Custom Item", condition: "S", notes: "", photos: [] }] }
          : r
      )
    );
  };

  /* ── Review helpers ── */
  const findingsCount = roomData.reduce(
    (s, r) => s + r.items.filter((it) => it.condition !== "S").length,
    0
  );
  const photosCount = roomData.reduce(
    (s, r) => s + r.items.reduce((ss, it) => ss + it.photos.length, 0),
    0
  );

  const handleGenerate = () => {
    onComplete({ rooms: roomData, property, client });
  };

  /* ═══════════════════════════════════
     ROOM SELECTION
     ═══════════════════════════════════ */
  if (step === "rooms") {
    return (
      <div className="fi">
        <div className="row mb">
          <button className="bo" onClick={onCancel}>←</button>
          <h2 style={{ fontSize: 18, color: "var(--color-primary)" }}>🔍 New Inspection</h2>
        </div>

        {/* Property + Client */}
        <div className="cd mb">
          <div className="g2">
            <input value={property} onChange={(e) => setProperty(e.target.value)} placeholder="Property address *" />
            <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client name" />
          </div>
        </div>

        {/* Room checklist */}
        <div className="cd mb">
          <h4 style={{ fontSize: 13, marginBottom: 8 }}>Select Rooms to Inspect</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {ROOM_ORDER.map((room) => {
              const checked = selectedRooms.includes(room);
              return (
                <label
                  key={room}
                  onClick={() => toggleRoom(room)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 12,
                    background: checked ? "var(--color-primary)" + "22" : "transparent",
                    border: `1px solid ${checked ? "var(--color-primary)" : border}`,
                  }}
                >
                  <span style={{ color: checked ? "var(--color-primary)" : "#888", fontSize: 14 }}>
                    {checked ? "☑" : "☐"}
                  </span>
                  {room}
                </label>
              );
            })}
          </div>

          {/* Custom room */}
          <div className="row" style={{ marginTop: 8 }}>
            <input
              value={customRoom}
              onChange={(e) => setCustomRoom(e.target.value)}
              placeholder="Add custom room"
              style={{ flex: 1, fontSize: 12 }}
              onKeyDown={(e) => e.key === "Enter" && addCustomRoom()}
            />
            <button className="bo" onClick={addCustomRoom} style={{ fontSize: 10, padding: "5px 10px" }}>
              + Add
            </button>
          </div>

          {/* Custom rooms added */}
          {selectedRooms
            .filter((r) => !Object.keys(ROOM_PRESETS).includes(r))
            .map((r) => (
              <div
                key={r}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "3px 8px",
                  borderRadius: 12,
                  fontSize: 11,
                  background: "var(--color-primary)" + "22",
                  color: "var(--color-primary)",
                  margin: "4px 4px 0 0",
                }}
              >
                {r}
                <span
                  onClick={() => setSelectedRooms((prev) => prev.filter((x) => x !== r))}
                  style={{ cursor: "pointer", color: "var(--color-accent-red)" }}
                >
                  ✕
                </span>
              </div>
            ))}
        </div>

        {/* Start button */}
        <button
          className="bb"
          onClick={startInspection}
          disabled={!selectedRooms.length || !property}
          style={{
            width: "100%",
            padding: 12,
            fontSize: 15,
            opacity: !selectedRooms.length || !property ? 0.5 : 1,
          }}
        >
          Start Inspection ({selectedRooms.length} rooms) →
        </button>
      </div>
    );
  }

  /* ═══════════════════════════════════
     ROOM INSPECTION
     ═══════════════════════════════════ */
  if (step === "inspect") {
    const room = roomData[currentRoomIdx];
    if (!room) return null;

    return (
      <div className="fi">
        {/* Hidden file input */}
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handlePhotoSelect}
        />

        {/* Header */}
        <div className="row mb" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <button className="bo" onClick={() => setStep("rooms")} style={{ fontSize: 10, padding: "4px 8px" }}>←</button>
            <h2 style={{ fontSize: 18, color: "var(--color-primary)" }}>{room.name}</h2>
          </div>
          <span className="dim" style={{ fontSize: 11, fontFamily: "Oswald" }}>
            {currentRoomIdx + 1} / {roomData.length}
          </span>
        </div>

        {/* Progress bar */}
        <div style={{ height: 3, background: border, borderRadius: 2, marginBottom: 12 }}>
          <div
            style={{
              height: 3,
              background: "var(--color-primary)",
              borderRadius: 2,
              width: `${((currentRoomIdx + 1) / roomData.length) * 100}%`,
              transition: "width 0.3s",
            }}
          />
        </div>

        {/* Items */}
        {room.items.map((item, itemIdx) => (
          <div
            key={itemIdx}
            className="cd"
            style={{
              marginBottom: 6,
              padding: 10,
              borderLeft: `3px solid ${CONDITIONS.find((c) => c.code === item.condition)?.color || "#888"}`,
            }}
          >
            {/* Item name (editable for custom items) */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <input
                value={item.name}
                onChange={(e) => updateItem(currentRoomIdx, itemIdx, "name", e.target.value)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontWeight: 600,
                  fontSize: 13,
                  padding: 0,
                  width: "auto",
                  flex: 1,
                }}
              />
              {/* Photo button */}
              <button
                onClick={() => {
                  setPhotoTarget({ room: currentRoomIdx, item: itemIdx });
                  photoRef.current?.click();
                }}
                disabled={uploading}
                style={{
                  background: "none",
                  fontSize: 16,
                  padding: "0 4px",
                  color: item.photos.length ? "var(--color-success)" : "#888",
                }}
              >
                📷{item.photos.length > 0 && <span style={{ fontSize: 9 }}> {item.photos.length}</span>}
              </button>
            </div>

            {/* Condition buttons */}
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {CONDITIONS.map((c) => (
                <button
                  key={c.code}
                  onClick={() => updateItem(currentRoomIdx, itemIdx, "condition", c.code)}
                  style={{
                    flex: 1,
                    padding: "4px 0",
                    borderRadius: 4,
                    fontSize: 10,
                    fontFamily: "Oswald",
                    background: item.condition === c.code ? c.bg : "transparent",
                    color: item.condition === c.code ? c.color : "#666",
                    border: `1px solid ${item.condition === c.code ? c.color : border}`,
                    fontWeight: item.condition === c.code ? 700 : 400,
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Notes (show when not S) */}
            {item.condition !== "S" && (
              <input
                value={item.notes}
                onChange={(e) => updateItem(currentRoomIdx, itemIdx, "notes", e.target.value)}
                placeholder="Describe the issue..."
                style={{ fontSize: 12 }}
              />
            )}

            {/* Photo thumbnails */}
            {item.photos.length > 0 && (
              <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                {item.photos.map((url, pi) => (
                  <div key={pi} style={{ position: "relative" }}>
                    <img
                      src={url}
                      alt=""
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: 4,
                        objectFit: "cover",
                        border: `1px solid ${border}`,
                      }}
                    />
                    <span
                      onClick={() => {
                        const newPhotos = item.photos.filter((_, i) => i !== pi);
                        updateItem(currentRoomIdx, itemIdx, "photos", newPhotos);
                      }}
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -4,
                        background: "var(--color-accent-red)",
                        color: "#fff",
                        borderRadius: "50%",
                        width: 14,
                        height: 14,
                        fontSize: 9,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      ✕
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Add custom item */}
        <button
          className="bo"
          onClick={() => addItemToRoom(currentRoomIdx)}
          style={{ fontSize: 10, padding: "5px 12px", marginBottom: 12 }}
        >
          + Add Item
        </button>

        {/* Navigation */}
        <div style={{ display: "flex", gap: 8 }}>
          {currentRoomIdx > 0 && (
            <button
              className="bo"
              onClick={() => setCurrentRoomIdx((prev) => prev - 1)}
              style={{ flex: 1, padding: 10, fontSize: 13 }}
            >
              ← {roomData[currentRoomIdx - 1]?.name}
            </button>
          )}
          {currentRoomIdx < roomData.length - 1 ? (
            <button
              className="bb"
              onClick={() => setCurrentRoomIdx((prev) => prev + 1)}
              style={{ flex: 1, padding: 10, fontSize: 13 }}
            >
              {roomData[currentRoomIdx + 1]?.name} →
            </button>
          ) : (
            <button
              className="bg"
              onClick={() => setStep("review")}
              style={{ flex: 1, padding: 10, fontSize: 13 }}
            >
              Review Inspection →
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════
     REVIEW
     ═══════════════════════════════════ */
  return (
    <div className="fi">
      <div className="row mb">
        <button className="bo" onClick={() => setStep("inspect")} style={{ fontSize: 10, padding: "4px 8px" }}>← Edit</button>
        <h2 style={{ fontSize: 18, color: "var(--color-primary)" }}>🔍 Inspection Review</h2>
      </div>

      {/* Property */}
      <div className="cd mb">
        <div style={{ fontSize: 13 }}>
          <b>{property}</b>
          {client && <span className="dim"> · {client}</span>}
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Rooms</div>
          <div className="sv" style={{ color: "var(--color-primary)" }}>{roomData.length}</div>
        </div>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Findings</div>
          <div className="sv" style={{ color: "var(--color-warning)" }}>{findingsCount}</div>
        </div>
        <div className="cd" style={{ textAlign: "center" }}>
          <div className="sl">Photos</div>
          <div className="sv" style={{ color: "var(--color-success)" }}>{photosCount}</div>
        </div>
      </div>

      {/* Room-by-room summary */}
      {roomData.map((room, ri) => {
        const issues = room.items.filter((it) => it.condition !== "S");
        const roomPhotos = room.items.reduce((s, it) => s + it.photos.length, 0);
        return (
          <div
            key={ri}
            className="cd mb"
            style={{ cursor: "pointer" }}
            onClick={() => { setCurrentRoomIdx(ri); setStep("inspect"); }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <b style={{ fontSize: 13 }}>{room.name}</b>
                <div className="dim" style={{ fontSize: 11 }}>
                  {issues.length} issue{issues.length !== 1 ? "s" : ""}
                  {roomPhotos > 0 && ` · ${roomPhotos} photo${roomPhotos !== 1 ? "s" : ""}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                {issues.map((it, i) => (
                  <span
                    key={i}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: CONDITIONS.find((c) => c.code === it.condition)?.color || "#888",
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        );
      })}

      {/* Generate button */}
      <button
        className="bb"
        onClick={handleGenerate}
        disabled={findingsCount === 0}
        style={{
          width: "100%",
          padding: 14,
          fontSize: 16,
          background: findingsCount === 0 ? "#333" : "var(--color-primary)",
          opacity: findingsCount === 0 ? 0.5 : 1,
        }}
      >
        🤖 Generate Quote ({findingsCount} findings)
      </button>
      {findingsCount === 0 && (
        <p className="dim" style={{ fontSize: 11, textAlign: "center", marginTop: 6 }}>
          Mark at least one item as Fair, Poor, or Damaged to generate a quote
        </p>
      )}
    </div>
  );
}
