"use client";
import { useState } from "react";
import { useStore } from "@/lib/store";
import { db } from "@/lib/supabase";

interface Props {
  value: string;
  onChange: (name: string) => void;
  style?: React.CSSProperties;
}

export default function ClientSelect({ value, onChange, style }: Props) {
  const clients = useStore((s) => s.clients);
  const loadAll = useStore((s) => s.loadAll);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");

  const createClient = async () => {
    if (!newName.trim()) return;
    const result = await db.post("clients", {
      name: newName.trim(),
      phone: newPhone,
      email: "",
      address: "",
      notes: "",
    });
    if (!result) {
      alert("Failed to save client");
      return;
    }
    const savedName = newName.trim();
    setNewName("");
    setNewPhone("");
    setShowNew(false);
    await loadAll();
    onChange(savedName);
  };

  return (
    <div style={{ position: "relative", ...style }}>
      <div style={{ display: "flex", gap: 4 }}>
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === "__NEW__") {
              setShowNew(true);
            } else {
              onChange(e.target.value);
            }
          }}
          style={{ flex: 1 }}
        >
          <option value="">Select client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.name}>{c.name}</option>
          ))}
          <option value="__NEW__">+ New client...</option>
        </select>
      </div>

      {showNew && (
        <div
          style={{
            marginTop: 4,
            padding: 8,
            borderRadius: 6,
            border: "1px solid var(--color-primary)",
            background: "var(--color-card-dark, #12121a)",
          }}
        >
          <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Client name *"
              style={{ flex: 1, fontSize: 12 }}
              autoFocus
            />
            <input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="Phone"
              style={{ width: 100, fontSize: 12 }}
            />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              className="bg"
              onClick={createClient}
              style={{ fontSize: 10, padding: "4px 10px" }}
            >
              Create
            </button>
            <button
              className="bo"
              onClick={() => { setShowNew(false); setNewName(""); }}
              style={{ fontSize: 10, padding: "4px 10px" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
