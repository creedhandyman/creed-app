import type { Room } from "./types";
import { calculateCost, makeGuide } from "./parser";

interface ExportOptions {
  property: string;
  client: string;
  clientPhone?: string;
  clientEmail?: string;
  rooms: Room[];
  rate: number;
  workers: { id: string; name: string }[];
  grandTotal: number;
  totalLabor: number;
  totalMat: number;
  totalHrs: number;
  trade?: string;
  jobId?: string;
  orgName?: string;
  orgPhone?: string;
  orgEmail?: string;
  orgLicense?: string;
  orgAddress?: string;
  orgLogo?: string;
  statusUrl?: string;
  photos?: { url: string; label: string; type: string }[];
  markupPct?: number;
  taxPct?: number;
  taxAmount?: number;
  tripFee?: number;
}

export function exportQuotePdf(opts: ExportOptions) {
  const {
    property,
    client,
    rooms,
    rate,
    grandTotal,
    totalLabor,
    totalMat,
    totalHrs,
  } = opts;

  const orgName = opts.orgName || "Service Provider";
  const orgPhone = opts.orgPhone || "";
  const orgEmail = opts.orgEmail || "";
  const orgLicense = opts.orgLicense || "";
  const orgAddress = opts.orgAddress || "";
  const orgLogo = opts.orgLogo || "";
  const clientPhone = opts.clientPhone || "";
  const clientEmail = opts.clientEmail || "";
  const trade = opts.trade || "";
  const jobId = opts.jobId || "";
  const statusUrl = opts.statusUrl || "";
  const photos = opts.photos || [];
  const markupPct = opts.markupPct || 0;
  const taxPct = opts.taxPct || 0;
  const taxAmount = opts.taxAmount || 0;
  const tripFee = opts.tripFee || 0;

  // Generate quote number from job ID or timestamp
  const quoteNum = jobId
    ? "CR-" + jobId.slice(0, 6).toUpperCase()
    : "CR-" + Date.now().toString(36).toUpperCase().slice(-6);

  // Dynamic title based on trade
  const estimateTitle = trade && trade !== "General"
    ? `${trade} Estimate`
    : "Service Estimate";

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const guide = makeGuide(rooms);

  // Build summary rows by trade/room category
  const summaryRows = rooms.map((rm) => {
    const items = rm.items;
    const hrs = items.reduce((s, it) => s + it.laborHrs, 0);
    const labor = hrs * rate;
    const mat = items.reduce((s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0), 0);
    return { name: rm.name, hrs, labor, mat, total: labor + mat };
  });

  // Build detailed breakdown by trade
  let breakdownHtml = "";
  rooms.forEach((rm) => {
    if (rm.items.length === 0) return;
    const sectionHrs = rm.items.reduce((s, it) => s + it.laborHrs, 0);
    const sectionLabor = sectionHrs * rate;
    const sectionMat = rm.items.reduce((s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0), 0);

    // Consolidate duplicate materials in this section
    const matMap: Record<string, { n: string; unitCost: number; qty: number; notes: string[] }> = {};
    rm.items.forEach((it) => {
      it.materials.forEach((m) => {
        if (m.c > 0) {
          const key = `${m.n}|${m.c}`;
          if (matMap[key]) {
            matMap[key].qty += 1;
            if (!matMap[key].notes.includes(it.detail)) matMap[key].notes.push(it.detail);
          } else {
            matMap[key] = { n: m.n, unitCost: m.c, qty: 1, notes: [it.detail] };
          }
        }
      });
    });
    let matRows = "";
    Object.values(matMap).forEach((m) => {
      const total = m.unitCost * m.qty;
      matRows += `<tr><td>${m.n}</td><td style="text-align:center">${m.qty}</td><td style="text-align:right">$${m.unitCost.toFixed(2)}</td><td style="text-align:right">$${total.toFixed(2)}</td><td class="dim">${m.notes.slice(0, 3).join(", ")}</td></tr>`;
    });

    breakdownHtml += `
    <div class="section-block">
      <h3>\u25C6 ${rm.name}</h3>
      <table class="mat-table">
        <thead><tr><th>Material</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th><th>Notes</th></tr></thead>
        <tbody>${matRows || '<tr><td colspan="5" class="dim">Labor only \u2014 no materials</td></tr>'}</tbody>
      </table>
      <div class="section-totals">
        <div>Material Subtotal: <b>$${sectionMat.toFixed(2)}</b></div>
        <div>Labor (${sectionHrs.toFixed(1)} man-hrs \u00D7 $${rate}/hr): <b>$${sectionLabor.toFixed(2)}</b></div>
        <div class="section-grand">Material: $${sectionMat.toFixed(2)} &nbsp; Labor: $${sectionLabor.toFixed(2)} &nbsp; <b>Section Total: $${(sectionLabor + sectionMat).toFixed(2)}</b></div>
      </div>
    </div>`;
  });

  // Build tools checklist
  const toolsHtml = guide.tools.map((t) => `<span class="tool-item">\u2610 ${t}</span>`).join("");

  // Logo HTML
  const logoHtml = orgLogo
    ? `<img src="${orgLogo}" alt="" style="height:50px;max-width:160px;object-fit:contain;margin-bottom:6px;display:block" onerror="this.style.display='none'" />`
    : "";

  // Client contact line
  const clientContactLine = [clientPhone, clientEmail].filter(Boolean).join(" \u00B7 ");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Quote ${quoteNum} \u2014 ${property}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;color:#1a1a2a;padding:0;font-size:13px;line-height:1.5}
.page{max-width:800px;margin:0 auto;padding:32px 40px}
h1{font-family:Oswald;font-size:22px;color:#2E75B6;text-transform:uppercase;letter-spacing:.05em;margin:0}
h2{font-family:Oswald;font-size:14px;color:#2E75B6;text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px;border-bottom:2px solid #2E75B6;padding-bottom:4px}
h3{font-family:Oswald;font-size:12px;color:#2E75B6;text-transform:uppercase;margin:16px 0 6px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #2E75B6}
.brand .llc{font-family:Oswald;font-size:11px;color:#C00000;letter-spacing:.15em}
.brand .info{font-size:12px;color:#666;margin-top:4px;line-height:1.6}
.quote-num{font-family:Oswald;font-size:12px;color:#888;margin-top:4px;letter-spacing:.06em}
.client-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.client-box{background:#f5f7fa;border-radius:6px;padding:8px 12px}
.client-box .label{font-family:Oswald;font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.08em}
.client-box .value{font-size:13px;font-weight:600}
.client-box .sub{font-size:11px;color:#666;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px}
th{font-family:Oswald;text-transform:uppercase;font-size:11px;letter-spacing:.06em;color:#fff;background:#2E75B6;padding:6px 8px;text-align:left}
td{padding:5px 8px;border-bottom:1px solid #e8e8e8;vertical-align:top}
.summary-table td{font-family:Oswald;font-size:12px}
.summary-table tr:last-child{font-weight:700;background:#f0f4f8;border-top:2px solid #2E75B6;font-size:14px;color:#2E75B6}
.summary-table td:nth-child(n+2){text-align:right}
.mat-table th:nth-child(2),.mat-table th:nth-child(3),.mat-table th:nth-child(4){text-align:right}
.section-block{margin-bottom:16px;page-break-inside:avoid}
.section-totals{background:#f5f7fa;border-radius:4px;padding:8px 10px;font-size:12px;margin-top:4px}
.section-grand{font-size:12px;margin-top:4px;padding-top:4px;border-top:1px solid #ddd;color:#2E75B6}
.dim{color:#888}
.tools-grid{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;margin-bottom:16px}
.tool-item{min-width:140px}
.notes{font-size:12px;color:#444;line-height:1.6}
.notes li{margin-bottom:4px}
.accept-box{background:#f0f4f8;border:2px solid #2E75B6;border-radius:10px;padding:16px 20px;margin-top:20px;text-align:center;page-break-inside:avoid}
.accept-box h3{font-family:Oswald;font-size:16px;color:#2E75B6;text-transform:uppercase;margin:0 0 8px}
.accept-box .total{font-family:Oswald;font-size:28px;font-weight:700;color:#2E75B6;margin:8px 0}
.accept-box .methods{font-size:12px;color:#444;line-height:2}
.accept-box a{color:#2E75B6;text-decoration:none}
.sig-row{display:flex;gap:40px;margin-top:24px}
.sig-line{flex:1;border-top:1px solid #999;padding-top:6px;text-align:center;font-size:12px;color:#666}
.footer{border-top:1px solid #ddd;padding-top:8px;text-align:center;font-size:11px;color:#888;margin-top:24px}
@media print{body{padding:0}.page{padding:16px 24px}h2{page-break-after:avoid}.section-block{page-break-inside:avoid}}
</style></head><body><div class="page">

<!-- HEADER -->
<div class="header">
  <div class="brand">
    ${logoHtml}
    <h1>${orgName}</h1>
    <div class="info">${orgAddress ? orgAddress + "<br/>" : ""}${orgPhone ? "\u260E " + orgPhone : ""}${orgEmail ? " \u00B7 \u2709 " + orgEmail : ""}</div>
  </div>
  <div style="text-align:right">
    <div style="font-family:Oswald;font-size:14px;color:#2E75B6;text-transform:uppercase">${estimateTitle}</div>
    <div style="font-size:12px;color:#666;margin-top:2px">${today}</div>
    <div class="quote-num">Quote #${quoteNum}</div>
    <div style="font-size:11px;color:#888">${orgLicense ? "License #" + orgLicense + " \u00B7 " : ""}Valid 30 Days</div>
  </div>
</div>

<!-- CLIENT INFO -->
<div class="client-grid">
  <div class="client-box">
    <div class="label">Property</div>
    <div class="value">${property || "\u2014"}</div>
  </div>
  <div class="client-box">
    <div class="label">Client</div>
    <div class="value">${client || "\u2014"}</div>
    ${clientContactLine ? `<div class="sub">${clientContactLine}</div>` : ""}
  </div>
  <div class="client-box"><div class="label">Total Hours</div><div class="value">${totalHrs.toFixed(1)} man-hours</div></div>
  <div class="client-box"><div class="label">Labor Rate</div><div class="value">$${rate}.00/man-hour</div></div>
</div>

<!-- ESTIMATE SUMMARY -->
<h2>Estimate Summary</h2>
<table class="summary-table">
  <thead><tr><th>Category</th><th>Man-Hrs</th><th>Labor</th><th>Material</th><th>Section Total</th></tr></thead>
  <tbody>
    ${summaryRows.map((r) => `<tr><td>${r.name}</td><td style="text-align:right">${r.hrs.toFixed(1)}</td><td style="text-align:right">$${r.labor.toFixed(2)}</td><td style="text-align:right">$${r.mat.toFixed(2)}</td><td style="text-align:right">$${r.total.toFixed(2)}</td></tr>`).join("")}
    <tr><td>SUBTOTAL</td><td style="text-align:right">${totalHrs.toFixed(1)}</td><td style="text-align:right">$${totalLabor.toFixed(2)}</td><td style="text-align:right">$${totalMat.toFixed(2)}</td><td style="text-align:right">$${(totalLabor + totalMat).toFixed(2)}</td></tr>
    ${markupPct > 0 ? `<tr><td>Material Markup (${markupPct}%)</td><td></td><td></td><td></td><td style="text-align:right">Included</td></tr>` : ""}
    ${tripFee > 0 ? `<tr><td>Trip Fee</td><td></td><td></td><td></td><td style="text-align:right">$${tripFee.toFixed(2)}</td></tr>` : ""}
    ${taxPct > 0 ? `<tr><td>Tax (${taxPct}%)</td><td></td><td></td><td></td><td style="text-align:right">$${taxAmount.toFixed(2)}</td></tr>` : ""}
    <tr><td>GRAND TOTAL</td><td style="text-align:right">${totalHrs.toFixed(1)}</td><td></td><td></td><td style="text-align:right;font-size:16px">$${grandTotal.toFixed(2)}</td></tr>
  </tbody>
</table>

<!-- PROJECT BREAKDOWN -->
<h2>Project Breakdown & Costs</h2>
${breakdownHtml}

<!-- TOOLS NEEDED -->
<h2>Tools Checklist</h2>
<div class="tools-grid">${toolsHtml}</div>

${photos.length > 0 ? `
<!-- PROJECT PHOTOS -->
<h2>Project Photos</h2>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;page-break-inside:avoid">
  ${photos.map((p) => `<div style="text-align:center"><img src="${p.url}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;border:1px solid #ddd" /><div style="font-size:11px;color:#666;margin-top:3px">${p.label || p.type || ""}</div></div>`).join("")}
</div>
` : ""}

<!-- NOTES & EXCLUSIONS -->
<h2>Notes & Exclusions</h2>
<div class="notes">
  <ul>
    <li>Labor rate: <b>$${rate}.00/man-hour</b>. Man-hours = clock hours \u00D7 crew size.</li>
    <li>Materials priced at current Home Depot/Lowe\u2019s retail. All quantities and unit prices listed per line item above.</li>
    <li>Quote valid <b>30 days</b> from issue date.</li>
    <li><b>50% deposit</b> to begin; balance due on completion.</li>
    <li>Any unforeseen conditions (mold, hidden water damage, structural issues) will be documented and quoted as a separate change order before proceeding.</li>
    <li>Items requiring licensed professionals (electrical panel, major HVAC, roofing) are NOT included \u2014 flagged for subcontractor referral.</li>
  </ul>
</div>

<!-- ACCEPT THIS ESTIMATE -->
<div class="accept-box">
  <h3>Accept This Estimate</h3>
  <div class="total">$${grandTotal.toFixed(2)}</div>
  <div class="methods">
    ${statusUrl ? `<div>\uD83D\uDD17 <b>View & approve online:</b> <a href="${statusUrl}">${statusUrl}</a></div>` : ""}
    ${orgPhone ? `<div>\u260E <b>Call:</b> ${orgPhone}</div>` : ""}
    ${orgEmail ? `<div>\u2709 <b>Email:</b> ${orgEmail}</div>` : ""}
  </div>
  <div style="font-size:11px;color:#888;margin-top:8px">Reference: Quote #${quoteNum}</div>
</div>

<!-- SIGNATURES -->
<div class="sig-row">
  <div class="sig-line">Authorized Signature / Date</div>
  <div class="sig-line">Client Approval / Date</div>
</div>

<!-- FOOTER -->
<div class="footer">
  ${orgName}${orgAddress ? " \u00B7 " + orgAddress : ""}${orgPhone ? " \u00B7 " + orgPhone : ""}${orgLicense ? " \u00B7 Lic #" + orgLicense : ""}${orgEmail ? " \u00B7 " + orgEmail : ""}
</div>

</div></body></html>`;

  const win = window.open("", "_blank");
  if (!win) {
    (window as any).__creed_toast?.("Allow popups to export PDF", "error");
    return;
  }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 600);
}
