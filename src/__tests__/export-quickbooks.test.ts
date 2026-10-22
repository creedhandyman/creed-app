import {
  buildCustomersCsv, buildExpensesCsv, buildInvoicesCsv, buildPaymentsCsv, buildQuickBooksExport,
  csvField, parseVendor, paymentMethod, qbDate,
} from "@/lib/export-quickbooks";

const jobs = [
  { id: "aaaaaaaa-1111-2222-3333-444444444444", client: "Smith, Jane", property: "12 Oak St", job_date: "2026-03-05", total: 1234.5, status: "paid", rooms: JSON.stringify({ jobNumber: "J-100" }), customer_id: "c1" },
  { id: "bbbbbbbb-1111-2222-3333-444444444444", client: "Bob", property: "9 Elm", created_at: "2026-04-01T10:00:00Z", total: 50, status: "complete", rooms: "[]" },
  { id: "cccccccc", client: "Quote", total: 9, status: "quoted", job_date: "2026-03-05" },
  { id: "dddddddd", client: "Old", total: 9, status: "paid", archived: true, job_date: "2026-03-05" },
];

describe("csv basics", () => {
  it("escapes", () => {
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("x\ny")).toBe('"x\ny"');
    expect(csvField("plain")).toBe("plain");
  });
  it("dates", () => { expect(qbDate("2026-03-05")).toBe("03/05/2026"); expect(qbDate("3/5/2026")).toBe("03/05/2026"); });
});

describe("invoices", () => {
  it("only complete/invoiced/paid, not archived, in range", () => {
    const out = buildInvoicesCsv(jobs, { from: "2026-03-01", to: "2026-03-31" }).trim().split("\r\n");
    expect(out[0]).toBe("InvoiceNo,Customer,InvoiceDate,DueDate,ItemDescription,ItemAmount");
    expect(out).toHaveLength(2);
    expect(out[1]).toBe('J-100,"Smith, Jane",03/05/2026,03/05/2026,12 Oak St,1234.50');
  });
  it("short id when no job number; empty = header only", () => {
    expect(buildInvoicesCsv(jobs, {})).toContain("BBBBBBBB,Bob");
    expect(buildInvoicesCsv([], {}).trim().split("\r\n")).toHaveLength(1);
  });
});

describe("payments", () => {
  it("methods", () => {
    expect(paymentMethod({ job_id: "x", amount: 1, kind: "check", stripe_session_id: "manual_abc" })).toBe("check");
    expect(paymentMethod({ job_id: "x", amount: 1, kind: "deposit", stripe_session_id: "cs_123" })).toBe("card (online)");
    expect(paymentMethod({ job_id: "x", amount: -1, kind: "refund", stripe_session_id: "refund_pi" })).toBe("refund");
  });
  it("joins job and keeps refunds negative", () => {
    const pays = [
      { job_id: jobs[0].id, amount: 500, kind: "deposit", stripe_session_id: "cs_1", created_at: "2026-03-06T12:00:00" },
      { job_id: jobs[0].id, amount: -100, kind: "refund", stripe_session_id: "refund_pi", created_at: "2026-03-09T12:00:00" },
      { job_id: jobs[0].id, amount: 5, kind: "cash", stripe_session_id: "manual_1", created_at: "2026-05-09T12:00:00" },
    ];
    const rows = buildPaymentsCsv(pays, jobs, { from: "2026-03-01", to: "2026-03-31" }).trim().split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe('03/06/2026,"Smith, Jane",J-100,500.00,card (online),cs_1');
    expect(rows[2]).toContain("-100.00,refund");
  });
});

describe("expenses", () => {
  it("parses vendor", () => {
    expect(parseVendor("Home Depot — 2x4, screws (+3 more)")).toEqual({ vendor: "Home Depot", description: "2x4, screws (+3 more)" });
    expect(parseVendor("").vendor).toBe("Receipt");
  });
  it("rows", () => {
    const rows = buildExpensesCsv([{ note: "Lowes — paint", amount: 42.1, receipt_date: "2026-03-10" }, { note: "x", amount: 1, receipt_date: "2025-01-01" }], { from: "2026-01-01", to: "2026-12-31" }).trim().split("\r\n");
    expect(rows).toEqual(["Date,Vendor,Description,Amount", "03/10/2026,Lowes,paint,42.10"]);
  });
});

describe("customers", () => {
  const custs = [
    { id: "c1", name: "Smith, Jane", type: "individual", email: "j@x.com", city: "Wichita" },
    { id: "c2", name: "Unused", type: "business" },
    { id: "c3", name: "bob", type: "business" },
  ];
  it("range: only invoiced customers (by id or name), deduped", () => {
    const rows = buildCustomersCsv(custs, jobs, { from: "2026-01-01", to: "2026-12-31" }).trim().split("\r\n");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe('"Smith, Jane",,j@x.com,,,Wichita,,');
    expect(rows[2].startsWith("bob,bob")).toBe(true);
  });
  it("all time: everyone", () => {
    expect(buildCustomersCsv(custs, jobs, {}).trim().split("\r\n")).toHaveLength(4);
  });
  it("bundle has all four", () => {
    const b = buildQuickBooksExport({ jobs: [], payments: [], receipts: [], customers: [] }, {});
    expect(Object.keys(b).sort()).toEqual(["customers", "expenses", "invoices", "payments"]);
  });
});
