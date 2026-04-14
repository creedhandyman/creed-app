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
    property, client, rooms, rate, grandTotal, totalLabor, totalMat, totalHrs,
  } = opts;

  const orgName = opts.orgName || "Service Provider";
  const orgPhone = opts.orgPhone || "";
  const orgEmail = opts.orgEmail || "";
  const orgLicense = opts.orgLicense || "";
  const orgAddress = opts.orgAddress || "";
  const orgLogo = opts.orgLogo || "";
  const clientPhone = opts.clientPhone || "";
  const clientEmail = opts.clientEmail || "";
  const statusUrl = opts.statusUrl || "";
  const photos = opts.photos || [];
  const markupPct = opts.markupPct || 0;
  const taxPct = opts.taxPct || 0;
  const taxAmount = opts.taxAmount || 0;
  const tripFee = opts.tripFee || 0;
  const jobId = opts.jobId || "";

  const quoteNum = jobId
    ? "CR-" + jobId.slice(0, 6).toUpperCase()
    : "CR-" + Date.now().toString(36).toUpperCase().slice(-6);

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const guide = makeGuide(rooms);

  // Build summary rows per trade/room category
  const summaryRows = rooms.map((rm) => {
    const items = rm.items;
    const hrs = items.reduce((s, it) => s + it.laborHrs, 0);
    const labor = hrs * rate;
    const mat = items.reduce((s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0), 0);
    return { name: rm.name, hrs, labor, mat, total: labor + mat, itemCount: items.length };
  });

  // Build detailed breakdown sections
  let breakdownHtml = "";
  rooms.forEach((rm) => {
    if (rm.items.length === 0) return;
    const sectionHrs = rm.items.reduce((s, it) => s + it.laborHrs, 0);
    const sectionLabor = sectionHrs * rate;
    const sectionMat = rm.items.reduce((s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0), 0);

    // Build material rows from all items in this section
    let matRows = "";
    rm.items.forEach((it) => {
      it.materials.forEach((m) => {
        if (m.c > 0) {
          const note = it.detail || "";
          matRows += `<tr><td>${m.n}</td><td class="r">1</td><td class="r">$${m.c.toFixed(2)}</td><td class="r">$${m.c.toFixed(2)}</td><td class="dim">${note}</td></tr>`;
        }
      });
    });

    const crewSize = sectionHrs > 8 ? 2 : 1;
    const clockHrs = crewSize > 1 ? (sectionHrs / crewSize).toFixed(1) : sectionHrs.toFixed(1);

    breakdownHtml += `
    <div class="section-block">
      <h3>${rm.name}</h3>
      <table class="mat-table">
        <thead><tr><th>Material</th><th class="r">Qty</th><th class="r">Unit Price</th><th class="r">Total</th><th>Notes</th></tr></thead>
        <tbody>${matRows || '<tr><td colspan="5" class="dim">Labor only</td></tr>'}</tbody>
      </table>
      <div class="section-totals">
        <div>Material Subtotal: <b>$${sectionMat.toFixed(2)}</b></div>
        <div>Labor (${clockHrs} clock hrs \u00D7 ${crewSize} man = ${sectionHrs.toFixed(1)} man-hrs): <b>$${rate}.00/hr = $${sectionLabor.toFixed(2)}</b></div>
        <div class="section-grand">Material: $${sectionMat.toFixed(2)} &nbsp;&nbsp; Labor: $${sectionLabor.toFixed(2)} &nbsp;&nbsp; <b>Section Total: $${(sectionLabor + sectionMat).toFixed(2)}</b></div>
      </div>
    </div>`;
  });

  // Tools checklist
  const toolsHtml = guide.tools.map((t) => `<span class="tool-item">\u2610 ${t}</span>`).join("");

  // Logo
  const logoHtml = orgLogo
    ? `<img src="${orgLogo}" alt="" style="height:50px;max-width:160px;object-fit:contain;display:block;margin-bottom:6px" onerror="this.style.display='none'" />`
    : "";

  // Subtotal before markup/tax
  const subtotal = totalLabor + totalMat;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Quote ${quoteNum} \u2014 ${property}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;color:#1a1a2a;font-size:13px;line-height:1.5}
.page{max-width:800px;margin:0 auto;padding:32px 40px}
h1{font-family:Oswald;font-size:22px;color:#2E75B6;text-transform:uppercase;letter-spacing:.05em;margin:0}
h2{font-family:Oswald;font-size:15px;color:#2E75B6;text-transform:uppercase;letter-spacing:.04em;margin:24px 0 8px;border-bottom:2px solid #2E75B6;padding-bottom:4px}
h3{font-family:Oswald;font-size:13px;color:#2E75B6;text-transform:uppercase;margin:18px 0 6px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #2E75B6}
.brand-info{font-size:12px;color:#666;margin-top:4px;line-height:1.8}
.client-section{background:#f5f7fa;border-radius:8px;padding:14px 16px;margin-bottom:14px}
.client-section h4{font-family:Oswald;font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.08em;margin-bottom:4px}
.client-section .name{font-size:14px;font-weight:600}
.client-section .sub{font-size:12px;color:#666}
.details-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.detail-box{background:#f5f7fa;border-radius:6px;padding:8px 12px}
.detail-box .label{font-family:Oswald;font-size:11px;text-transform:uppercase;color:#888;letter-spacing:.08em}
.detail-box .value{font-size:13px;font-weight:600;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:12px}
th{font-family:Oswald;text-transform:uppercase;font-size:11px;letter-spacing:.06em;color:#fff;background:#2E75B6;padding:6px 8px;text-align:left}
td{padding:5px 8px;border-bottom:1px solid #e8e8e8;vertical-align:top}
.r{text-align:right}
.summary-table td{font-family:Oswald;font-size:12px}
.summary-table tr:last-child{font-weight:700;background:#f0f4f8;border-top:2px solid #2E75B6;font-size:14px;color:#2E75B6}
.summary-table td:nth-child(n+2){text-align:right}
.mat-table th:nth-child(2),.mat-table th:nth-child(3),.mat-table th:nth-child(4){text-align:right}
.section-block{margin-bottom:16px;page-break-inside:avoid}
.section-totals{background:#f5f7fa;border-radius:4px;padding:10px 12px;font-size:12px;margin-top:4px}
.section-grand{font-size:13px;margin-top:6px;padding-top:6px;border-top:1px solid #ddd;color:#2E75B6;font-weight:600}
.dim{color:#888}
.tools-grid{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;margin-bottom:16px}
.tool-item{min-width:140px}
.notes{font-size:12px;color:#444;line-height:1.8}
.notes li{margin-bottom:4px}
.accept-box{background:#f0f4f8;border:2px solid #2E75B6;border-radius:10px;padding:16px 20px;margin-top:20px;text-align:center;page-break-inside:avoid}
.accept-box h3{font-family:Oswald;font-size:16px;color:#2E75B6;text-transform:uppercase;margin:0 0 8px}
.accept-box .total{font-family:Oswald;font-size:28px;font-weight:700;color:#2E75B6;margin:8px 0}
.accept-box .methods{font-size:12px;color:#444;line-height:2}
.accept-box a{color:#2E75B6;text-decoration:none}
.sig-row{display:flex;gap:40px;margin-top:30px}
.sig-line{flex:1;border-top:1px solid #999;padding-top:6px;text-align:center;font-size:12px;color:#666}
.footer{border-top:1px solid #ddd;padding-top:8px;text-align:center;font-size:11px;color:#888;margin-top:24px}
@media print{body{padding:0}.page{padding:16px 24px}h2{page-break-after:avoid}.section-block{page-break-inside:avoid}}
</style></head><body><div class="page">

<!-- HEADER -->
<div class="header">
  <div>
    ${logoHtml}
    <h1>${orgName}</h1>
    <div class="brand-info">
      Professional Property Repair & Renovation<br/>
      ${orgPhone ? "\u260E " + orgPhone : ""}${orgPhone && orgEmail ? " &nbsp;&nbsp; " : ""}${orgEmail ? "\u2709 " + orgEmail : ""}${orgAddress ? "<br/>" + orgAddress : ""}
    </div>
  </div>
  <div style="text-align:right">
    <div style="font-family:Oswald;font-size:14px;color:#2E75B6;text-transform:uppercase">Property Repair Estimate</div>
    <div style="font-size:12px;color:#666;margin-top:2px">Quote #${quoteNum}</div>
  </div>
</div>

<!-- CLIENT -->
${(client || clientEmail || clientPhone) ? `
<div class="client-section">
  <h4>Client</h4>
  <div class="name">${client || "\u2014"}</div>
  ${clientEmail ? `<div class="sub">${clientEmail}</div>` : ""}
  ${clientPhone ? `<div class="sub">${clientPhone}</div>` : ""}
</div>
` : ""}

<!-- ESTIMATE DETAILS -->
<div class="details-grid">
  <div class="detail-box"><div class="label">Property</div><div class="value">${property || "\u2014"}</div></div>
  <div class="detail-box"><div class="label">Issue Date</div><div class="value">${today}</div></div>
  <div class="detail-box"><div class="label">License No</div><div class="value">${orgLicense || "\u2014"}</div></div>
  <div class="detail-box"><div class="label">Valid For</div><div class="value">30 Days</div></div>
</div>

<!-- ESTIMATE SUMMARY -->
<h2>Estimate Summary</h2>
<table class="summary-table">
  <thead><tr><th>Category</th><th>Man-Hrs</th><th>Labor</th><th>Material</th><th>Section Total</th></tr></thead>
  <tbody>
    ${summaryRows.map((r) => `<tr><td>${r.name}</td><td class="r">${r.hrs.toFixed(1)}</td><td class="r">$${r.labor.toFixed(2)}</td><td class="r">$${r.mat.toFixed(2)}</td><td class="r">$${r.total.toFixed(2)}</td></tr>`).join("")}
    <tr><td>SUBTOTAL</td><td class="r">${totalHrs.toFixed(1)}</td><td class="r">$${totalLabor.toFixed(2)}</td><td class="r">$${totalMat.toFixed(2)}</td><td class="r">$${subtotal.toFixed(2)}</td></tr>
  </tbody>
</table>
${(markupPct > 0 || taxPct > 0 || tripFee > 0) ? `
<table style="width:auto;margin-left:auto;font-size:12px">
  ${markupPct > 0 ? `<tr><td class="dim">Material Markup (${markupPct}%)</td><td class="r" style="padding-left:20px">Included in materials</td></tr>` : ""}
  ${tripFee > 0 ? `<tr><td class="dim">Trip Fee</td><td class="r" style="padding-left:20px">$${tripFee.toFixed(2)}</td></tr>` : ""}
  ${taxPct > 0 ? `<tr><td class="dim">Tax (${taxPct}%)</td><td class="r" style="padding-left:20px">$${taxAmount.toFixed(2)}</td></tr>` : ""}
  <tr style="font-weight:700;font-size:16px;color:#2E75B6;font-family:Oswald"><td>GRAND TOTAL</td><td class="r" style="padding-left:20px">$${grandTotal.toFixed(2)}</td></tr>
</table>
` : ""}

<!-- PROJECT BREAKDOWN -->
<h2>Project Breakdown & Costs</h2>
${breakdownHtml}

${photos.length > 0 ? `
<h2>Project Photos</h2>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;page-break-inside:avoid">
  ${photos.map((p) => `<div style="text-align:center"><img src="${p.url}" style="width:100%;height:120px;object-fit:cover;border-radius:6px;border:1px solid #ddd" /><div style="font-size:11px;color:#666;margin-top:3px">${p.label || p.type || ""}</div></div>`).join("")}
</div>
` : ""}

<!-- TOOLS CHECKLIST -->
<h2>Tools Checklist</h2>
<div class="tools-grid">${toolsHtml}</div>

<!-- NOTES & EXCLUSIONS -->
<h2>Notes & Exclusions</h2>
<div class="notes">
  <ul>
    <li>Labor rate: <b>$${rate}.00/man-hour</b>. Man-hours = clock hours \u00D7 crew size (2-man crew tasks billed at 2\u00D7 clock time).</li>
    <li>Materials priced at current Home Depot/Lowe\u2019s retail. All material quantities and unit prices listed per line item above.</li>
    <li>Quote valid <b>30 days</b> from issue date. <b>50% deposit</b> to begin; balance due on completion.</li>
    <li>Any unforeseen conditions (mold, hidden water damage, structural issues) will be documented and quoted as a separate change order before proceeding.</li>
    <li>Items requiring licensed professionals (electrical panel work, major HVAC, gas lines) are NOT included unless noted.</li>
  </ul>
</div>

<!-- ACCEPT -->
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
  <div class="sig-line">Authorized Signature: _______________ &nbsp; Date: ___________</div>
  <div class="sig-line">Client Approval: _______________ &nbsp; Date: ___________</div>
</div>

<!-- FOOTER -->
<div class="footer">
  ${orgName}${orgAddress ? " \u00B7 " + orgAddress : ""}${orgPhone ? " \u00B7 " + orgPhone : ""}${orgLicense ? " \u00B7 Lic #" + orgLicense : ""}
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
