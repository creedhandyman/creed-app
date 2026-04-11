import type { Room } from "./types";
import { calculateCost, makeGuide } from "./parser";

interface ExportOptions {
  property: string;
  client: string;
  rooms: Room[];
  rate: number;
  workers: { id: string; name: string }[];
  grandTotal: number;
  totalLabor: number;
  totalMat: number;
  totalHrs: number;
  orgName?: string;
  orgPhone?: string;
  orgEmail?: string;
  orgLicense?: string;
  orgAddress?: string;
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

  const orgName = opts.orgName || "Handyman Service";
  const orgPhone = opts.orgPhone || "";
  const orgEmail = opts.orgEmail || "";
  const orgLicense = opts.orgLicense || "";
  const orgAddress = opts.orgAddress || "";

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const crewSize = Math.max(1, Math.ceil(totalHrs / 40));
  const estDays = Math.ceil(totalHrs / (crewSize * 8));
  const guide = makeGuide(rooms);

  // Build summary rows by trade/room category
  const summaryRows = rooms.map((rm) => {
    const items = rm.items;
    const hrs = items.reduce((s, it) => s + it.laborHrs, 0);
    const labor = hrs * rate;
    const mat = items.reduce((s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0), 0);
    return { name: rm.name, hrs, labor, mat, total: labor + mat };
  });

  // Build work schedule — fit all work into estDays
  const schedDays: string[] = [];
  const hrsPerDay = crewSize * 8;

  // Sort categories by priority: safety/electrical first, painting mid, flooring last
  const catOrder: Record<string, number> = {
    "Safety": 0, "Safety & Electrical": 0, "Electrical": 1,
    "Carpentry": 2, "Doors": 2, "Plumbing": 3,
    "Painting": 4, "Painting & Wall Repairs": 4,
    "Flooring": 6, "Exterior": 5, "Cleaning/Hauling": 7,
  };
  const sortedRooms = [...rooms].filter((r) => r.items.length > 0).sort((a, b) =>
    (catOrder[a.name] ?? 3) - (catOrder[b.name] ?? 3)
  );

  let currentDay = 1;
  let hrsLeft = hrsPerDay;

  sortedRooms.forEach((rm) => {
    const rmHrs = rm.items.reduce((s, it) => s + it.laborHrs, 0);
    const itemList = rm.items.slice(0, 5).map((it) => it.detail).join(" · ");

    if (rmHrs <= hrsLeft) {
      // Fits in current day
      const existing = schedDays[schedDays.length - 1];
      if (existing && existing.includes(`Day ${currentDay}<`)) {
        // Append to existing day row
        schedDays[schedDays.length - 1] = existing.replace("</td><td></td></tr>", ` · <b>${rm.name}:</b> ${itemList}</td><td></td></tr>`);
      } else {
        schedDays.push(`<tr><td>Day ${currentDay}</td><td>${crewSize}</td><td><b>${rm.name}:</b> ${itemList}</td><td></td></tr>`);
      }
      hrsLeft -= rmHrs;
    } else {
      // Needs its own day(s)
      if (hrsLeft < hrsPerDay) { currentDay++; hrsLeft = hrsPerDay; }
      const daysNeeded = Math.max(1, Math.ceil(rmHrs / hrsPerDay));
      const dayLabel = daysNeeded > 1 ? `Day ${currentDay}–${currentDay + daysNeeded - 1}` : `Day ${currentDay}`;
      schedDays.push(`<tr><td>${dayLabel}</td><td>${crewSize}</td><td><b>${rm.name}:</b> ${itemList}</td><td></td></tr>`);
      currentDay += daysNeeded;
      hrsLeft = (daysNeeded * hrsPerDay) - rmHrs;
    }
  });

  // Add final day for punch list
  if (currentDay <= estDays) {
    schedDays.push(`<tr><td>Day ${estDays}</td><td>${Math.max(1, crewSize - 1)}</td><td><b>Punch list</b> · Final touch-ups · Clean · Walk-through</td><td></td></tr>`);
  }

  if (schedDays.length === 0) {
    schedDays.push(`<tr><td>Day 1–${estDays}</td><td>${crewSize}</td><td>All work items</td><td></td></tr>`);
  }

  // Build detailed breakdown by trade
  let breakdownHtml = "";
  rooms.forEach((rm) => {
    if (rm.items.length === 0) return;
    const sectionHrs = rm.items.reduce((s, it) => s + it.laborHrs, 0);
    const sectionLabor = sectionHrs * rate;
    const sectionMat = rm.items.reduce((s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0), 0);

    let matRows = "";
    rm.items.forEach((it) => {
      it.materials.forEach((m) => {
        if (m.c > 0) {
          matRows += `<tr><td>${m.n}</td><td style="text-align:center">1</td><td style="text-align:right">$${m.c.toFixed(2)}</td><td style="text-align:right">$${m.c.toFixed(2)}</td><td class="dim">${it.detail}</td></tr>`;
        }
      });
    });

    breakdownHtml += `
    <div class="section-block">
      <h3>◆ ${rm.name}</h3>
      <table class="mat-table">
        <thead><tr><th>Material</th><th style="text-align:center">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th><th>Notes</th></tr></thead>
        <tbody>${matRows || '<tr><td colspan="5" class="dim">Labor only — no materials</td></tr>'}</tbody>
      </table>
      <div class="section-totals">
        <div>Material Subtotal: <b>$${sectionMat.toFixed(2)}</b></div>
        <div>Labor (${sectionHrs.toFixed(1)} man-hrs × $${rate}/hr): <b>$${sectionLabor.toFixed(2)}</b></div>
        <div class="section-grand">Material: $${sectionMat.toFixed(2)} &nbsp; Labor: $${sectionLabor.toFixed(2)} &nbsp; <b>Section Total: $${(sectionLabor + sectionMat).toFixed(2)}</b></div>
      </div>
    </div>`;
  });

  // Build tools checklist
  const toolsHtml = guide.tools.map((t) => `<span class="tool-item">☐ ${t}</span>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Quote — ${property}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;color:#1a1a2a;padding:0;font-size:11px;line-height:1.5}
.page{max-width:800px;margin:0 auto;padding:32px 40px}
h1{font-family:Oswald;font-size:22px;color:#2E75B6;text-transform:uppercase;letter-spacing:.05em;margin:0}
h2{font-family:Oswald;font-size:14px;color:#2E75B6;text-transform:uppercase;letter-spacing:.04em;margin:20px 0 8px;border-bottom:2px solid #2E75B6;padding-bottom:4px}
h3{font-family:Oswald;font-size:12px;color:#2E75B6;text-transform:uppercase;margin:16px 0 6px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #2E75B6}
.brand .llc{font-family:Oswald;font-size:9px;color:#C00000;letter-spacing:.15em}
.brand .info{font-size:10px;color:#666;margin-top:4px;line-height:1.6}
.client-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px}
.client-box{background:#f5f7fa;border-radius:6px;padding:8px 12px}
.client-box .label{font-family:Oswald;font-size:9px;text-transform:uppercase;color:#888;letter-spacing:.08em}
.client-box .value{font-size:12px;font-weight:600}
table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px}
th{font-family:Oswald;text-transform:uppercase;font-size:9px;letter-spacing:.06em;color:#fff;background:#2E75B6;padding:5px 8px;text-align:left}
td{padding:4px 8px;border-bottom:1px solid #e8e8e8;vertical-align:top}
.summary-table td{font-family:Oswald;font-size:10px}
.summary-table tr:last-child{font-weight:700;background:#f0f4f8;border-top:2px solid #2E75B6}
.summary-table td:nth-child(n+2){text-align:right}
.sched-table td:first-child{font-family:Oswald;font-weight:600;color:#2E75B6;white-space:nowrap}
.mat-table th:nth-child(2),.mat-table th:nth-child(3),.mat-table th:nth-child(4){text-align:right}
.section-block{margin-bottom:16px;page-break-inside:avoid}
.section-totals{background:#f5f7fa;border-radius:4px;padding:6px 10px;font-size:10px;margin-top:4px}
.section-grand{font-size:11px;margin-top:4px;padding-top:4px;border-top:1px solid #ddd}
.dim{color:#888}
.tools-grid{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:10px;margin-bottom:16px}
.tool-item{min-width:140px}
.notes{font-size:10px;color:#444;line-height:1.6}
.notes li{margin-bottom:4px}
.sig-row{display:flex;gap:40px;margin-top:30px}
.sig-line{flex:1;border-top:1px solid #999;padding-top:6px;text-align:center;font-size:10px;color:#666}
.footer{border-top:1px solid #ddd;padding-top:8px;text-align:center;font-size:9px;color:#888;margin-top:24px}
@media print{body{padding:0}.page{padding:16px 24px}h2{page-break-after:avoid}.section-block{page-break-inside:avoid}}
</style></head><body><div class="page">

<!-- HEADER -->
<div class="header">
  <div class="brand">
    <h1>${orgName}</h1>
    <div class="info">Professional Property Repair & Renovation${orgPhone ? "<br/>☎ " + orgPhone : ""}${orgEmail ? " · ✉ " + orgEmail : ""}</div>
  </div>
  <div style="text-align:right">
    <div style="font-family:Oswald;font-size:13px;color:#2E75B6;text-transform:uppercase">Property Repair Estimate</div>
    <div style="font-size:10px;color:#666;margin-top:2px">${today}</div>
    <div style="font-size:9px;color:#888">${orgLicense ? "License #" + orgLicense + " · " : ""}Valid 30 Days</div>
  </div>
</div>

<!-- CLIENT INFO -->
<div class="client-grid">
  <div class="client-box"><div class="label">Property</div><div class="value">${property || "—"}</div></div>
  <div class="client-box"><div class="label">Client</div><div class="value">${client || "—"}</div></div>
  <div class="client-box"><div class="label">Est. Duration</div><div class="value">${estDays} working days (${crewSize}-man crew)</div></div>
  <div class="client-box"><div class="label">Labor Rate</div><div class="value">$${rate}.00/man-hour</div></div>
</div>

<!-- ESTIMATE SUMMARY -->
<h2>Estimate Summary</h2>
<table class="summary-table">
  <thead><tr><th>Category</th><th>Man-Hrs</th><th>Labor</th><th>Material</th><th>Section Total</th></tr></thead>
  <tbody>
    ${summaryRows.map((r) => `<tr><td>${r.name}</td><td style="text-align:right">${r.hrs.toFixed(1)}</td><td style="text-align:right">$${r.labor.toFixed(2)}</td><td style="text-align:right">$${r.mat.toFixed(2)}</td><td style="text-align:right">$${r.total.toFixed(2)}</td></tr>`).join("")}
    <tr><td>GRAND TOTAL</td><td style="text-align:right">${totalHrs.toFixed(1)}</td><td style="text-align:right">$${totalLabor.toFixed(2)}</td><td style="text-align:right">$${totalMat.toFixed(2)}</td><td style="text-align:right">$${grandTotal.toFixed(2)}</td></tr>
  </tbody>
</table>

<!-- WORK SCHEDULE -->
<h2>${estDays}-Day Work Schedule</h2>
<table class="sched-table">
  <thead><tr><th>Day</th><th>Crew</th><th>Primary Work</th><th>Notes</th></tr></thead>
  <tbody>${schedDays.join("")}</tbody>
</table>

<!-- PROJECT BREAKDOWN -->
<h2>Project Breakdown & Costs</h2>
${breakdownHtml}

<!-- TOOLS NEEDED -->
<h2>Tools Checklist</h2>
<div class="tools-grid">${toolsHtml}</div>

<!-- NOTES & EXCLUSIONS -->
<h2>Notes & Exclusions</h2>
<div class="notes">
  <ul>
    <li>Labor rate: <b>$${rate}.00/man-hour</b>. Man-hours = clock hours × crew size.</li>
    <li>Materials priced at current Home Depot/Lowe's retail. All quantities and unit prices listed per line item above.</li>
    <li>Quote valid <b>30 days</b> from issue date.</li>
    <li><b>50% deposit</b> to begin; balance due on completion.</li>
    <li>Any unforeseen conditions (mold, hidden water damage, structural issues) will be documented and quoted as a separate change order before proceeding.</li>
    <li>Items requiring licensed professionals (electrical panel, major HVAC, roofing) are NOT included — flagged for subcontractor referral.</li>
  </ul>
</div>

<!-- SIGNATURES -->
<div class="sig-row">
  <div class="sig-line">Authorized Signature / Date</div>
  <div class="sig-line">Client Approval / Date</div>
</div>

<!-- FOOTER -->
<div class="footer">
  ${orgName}${orgAddress ? " · " + orgAddress : ""}${orgPhone ? " · " + orgPhone : ""}${orgLicense ? " · Lic #" + orgLicense : ""}${orgEmail ? " · " + orgEmail : ""}
</div>

</div></body></html>`;

  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow popups to export PDF");
    return;
  }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 600);
}
