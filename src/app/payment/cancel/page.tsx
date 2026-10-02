export default function PaymentCancel() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0a0a0f, #0d1530)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 400 }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>❌</div>
        <h1
          style={{
            fontFamily: "Oswald, sans-serif",
            fontSize: 24,
            color: "#C00000",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Payment Cancelled
        </h1>
        <p style={{ color: "#888", fontSize: 16, fontFamily: "Source Sans 3, sans-serif", marginBottom: 24 }}>
          Your payment was not processed.
        </p>
        <p style={{ color: "#666", fontSize: 14, fontFamily: "Source Sans 3, sans-serif" }}>
          No charge was made. You can close this page, or open the link the business texted you to try again.
        </p>
      </div>
    </div>
  );
}
