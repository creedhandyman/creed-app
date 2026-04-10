"use client";

interface Props {
  title: string;
  label: string;
}

export default function ComingSoon({ title, label }: Props) {
  return (
    <div className="fi">
      <h2 style={{ fontSize: 22, color: "var(--color-primary)", marginBottom: 14 }}>{title}</h2>
      <div className="cd" style={{ textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🚧</div>
        <h3 style={{ color: "var(--color-warning)", fontSize: 18, marginBottom: 8 }}>Coming Soon</h3>
        <p className="dim" style={{ fontSize: 13 }}>{label}</p>
      </div>
    </div>
  );
}
