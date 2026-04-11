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
        <p style={{ color: "#888", fontSize: 14, fontFamily: "Source Sans 3, sans-serif", marginBottom: 24 }}>
          Your payment was not processed. You can try again from your invoice.
        </p>
        <a
          href="/"
          style={{
            display: "inline-block",
            padding: "10px 24px",
            background: "#2E75B6",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
            fontFamily: "Oswald, sans-serif",
            textTransform: "uppercase",
            fontSize: 14,
          }}
        >
          Back to App
        </a>
      </div>
    </div>
  );
}
