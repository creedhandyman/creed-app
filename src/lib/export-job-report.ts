import type { Job } from "./types";

interface ReportOptions {
  job: Job;
  orgName: string;
  orgPhone: string;
  orgEmail: string;
  orgLicense: string;
  orgAddress: string;
  workerNames: string[];
}

export function exportJobReport(opts: ReportOptions) {
  const { job, orgName, orgPhone, orgEmail, orgLicense, orgAddress, workerNames } = opts;
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Parse job data
  let workOrder: { room: string; detail: string; action: string; pri: string; hrs: number; done: boolean }[] = [];
  let photos: { url: string; label: string; type: string }[] = [];
  try {
    const data = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
    workOrder = data?.workOrder || [];
    photos = data?.photos || [];
  } catch { /* */ }

  const completedItems = workOrder.filter((w) => w.done);
  const pendingItems = workOrder.filter((w) => !w.done);

  // Work order rows
  const workRows = workOrder.map((w) => `
    <tr>
      <td style="text-align:center;font-size:16px">${w.done ? "✅" : "☐"}</td>
      <td><span class="pri-${w.pri.toLowerCase()}">${w.pri}</span></td>
      <td><b>${w.room}</b></td>
      <td>${w.detail}</td>
      <td class="dim">${w.action}</td>
      <td style="text-align:right">${w.hrs}h</td>
    </tr>
  `).join("");

  // Photo grid (before/after pairs)
  const beforePhotos = photos.filter((p) => p.type === "before");
  const afterPhotos = photos.filter((p) => p.type === "after");
  const workPhotos = photos.filter((p) => p.type === "work");

  let photoHtml = "";
  if (photos.length > 0) {
    photoHtml = `<h2>Photos</h2>`;
    if (beforePhotos.length > 0) {
      photoHtml += `<h3>Before</h3><div class="photo-grid">${beforePhotos.map((p) => `<div class="photo"><img src="${p.url}" /><div class="photo-label">${p.label || ""}</div></div>`).join("")}</div>`;
    }
    if (workPhotos.length > 0) {
      photoHtml += `<h3>During Work</h3><div class="photo-grid">${workPhotos.map((p) => `<div class="photo"><img src="${p.url}" /><div class="photo-label">${p.label || ""}</div></div>`).join("")}</div>`;
    }
    if (afterPhotos.length > 0) {
      photoHtml += `<h3>After</h3><div class="photo-grid">${afterPhotos.map((p) => `<div class="photo"><img src="${p.url}" /><div class="photo-label">${p.label || ""}</div></div>`).join("")}</div>`;
    }
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Job Report — ${job.property}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;600;700&family=Source+Sans+3:wght@400;500;600&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Source Sans 3',sans-serif;color:#1a1a2a;font-size:11px;line-height:1.5}
.page{max-width:800px;margin:0 auto;padding:32px 40px}
h1{font-family:Oswald;font-size:22px;color:#2E75B6;text-transform:uppercase;letter-spacing:.05em}
h2{font-family:Oswald;font-size:14px;color:#2E75B6;text-transform:uppercase;letter-spacing:.04em;margin:16px 0 8px;border-bottom:2px solid #2E75B6;padding-bottom:4px}
h3{font-family:Oswald;font-size:12px;color:#666;text-transform:uppercase;margin:10px 0 6px}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;padding-bottom:12px;border-bottom:3px solid #2E75B6}
.brand .info{font-size:10px;color:#666;margin-top:4px;line-height:1.6}
.report-label h2{font-family:Oswald;font-size:16px;color:#2E75B6;text-transform:uppercase;margin:0;border:none;padding:0}
.report-label .date{font-size:11px;color:#666;margin-top:2px}
.info-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:16px}
.info-box{background:#f5f7fa;border-radius:6px;padding:8px 12px}
.info-box .label{font-family:Oswald;font-size:9px;text-transform:uppercase;color:#888;letter-spacing:.08em}
.info-box .value{font-size:12px;font-weight:600;margin-top:2px}
table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10px}
th{font-family:Oswald;text-transform:uppercase;font-size:9px;letter-spacing:.06em;color:#fff;background:#2E75B6;padding:5px 8px;text-align:left}
td{padding:4px 8px;border-bottom:1px solid #e8e8e8;vertical-align:top}
.dim{color:#888}
.pri-high{font-size:8px;padding:1px 4px;border-radius:3;background:#C0000022;color:#C00000}
.pri-med{font-size:8px;padding:1px 4px;border-radius:3;background:#ff880022;color:#ff8800}
.pri-low{font-size:8px;padding:1px 4px;border-radius:3;background:#00cc6622;color:#00cc66}
.summary{display:flex;gap:16px;margin-bottom:16px}
.summary-box{flex:1;background:#f5f7fa;border-radius:6px;padding:12px;text-align:center}
.summary-box .num{font-family:Oswald;font-size:24px;font-weight:700}
.summary-box .lbl{font-family:Oswald;font-size:9px;text-transform:uppercase;color:#888;letter-spacing:.08em}
.green{color:#00cc66} .blue{color:#2E75B6} .orange{color:#ff8800}
.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:12px}
.photo img{width:100%;height:100px;object-fit:cover;border-radius:4px;border:1px solid #ddd}
.photo-label{font-size:9px;color:#666;margin-top:2px;text-align:center}
.sig-row{display:flex;gap:40px;margin-top:24px}
.sig-line{flex:1;border-top:1px solid #999;padding-top:6px;text-align:center;font-size:10px;color:#666}
.footer{border-top:1px solid #ddd;padding-top:8px;text-align:center;font-size:9px;color:#888;margin-top:20px}
.checklist-note{background:#f0f8f0;border:1px solid #00cc66;border-radius:6px;padding:10px;margin-bottom:12px;font-size:11px}
@media print{.page{padding:16px 24px}h2{page-break-after:avoid}}
</style></head><body><div class="page">

<!-- Header -->
<div class="header">
  <div class="brand">
    <h1>${orgName}</h1>
    <div class="info">${orgPhone ? "☎ " + orgPhone : ""}${orgEmail ? " · ✉ " + orgEmail : ""}${orgLicense ? "<br/>License #" + orgLicense : ""}</div>
  </div>
  <div class="report-label">
    <h2>Job Completion Report</h2>
    <div class="date">${today}</div>
  </div>
</div>

<!-- Job Info -->
<div class="info-grid">
  <div class="info-box"><div class="label">Property</div><div class="value">${job.property}</div></div>
  <div class="info-box"><div class="label">Client</div><div class="value">${job.client || "—"}</div></div>
  <div class="info-box"><div class="label">Status</div><div class="value">${job.status}</div></div>
  <div class="info-box"><div class="label">Job Date</div><div class="value">${job.job_date || "—"}</div></div>
  <div class="info-box"><div class="label">Crew</div><div class="value">${workerNames.length ? workerNames.join(", ") : "—"}</div></div>
  <div class="info-box"><div class="label">Total Hours</div><div class="value">${(job.total_hrs || 0).toFixed(1)} man-hours</div></div>
</div>

<!-- Summary -->
<div class="summary">
  <div class="summary-box"><div class="num green">${completedItems.length}</div><div class="lbl">Completed</div></div>
  <div class="summary-box"><div class="num orange">${pendingItems.length}</div><div class="lbl">Pending</div></div>
  <div class="summary-box"><div class="num blue">${workOrder.length}</div><div class="lbl">Total Tasks</div></div>
</div>

${pendingItems.length > 0 ? `<div class="checklist-note">⚠️ <b>${pendingItems.length} task${pendingItems.length !== 1 ? "s" : ""} still pending.</b> Please review before signing off.</div>` : `<div class="checklist-note">✅ <b>All tasks completed.</b> This job is ready for sign-off.</div>`}

<!-- Work Order -->
<h2>Work Order Checklist</h2>
<table>
  <thead><tr><th style="width:30px">Done</th><th style="width:40px">Pri</th><th>Room</th><th>Item</th><th>Description</th><th style="text-align:right">Hrs</th></tr></thead>
  <tbody>${workRows || '<tr><td colspan="6" class="dim">No work order items</td></tr>'}</tbody>
</table>

${photoHtml}

<!-- Notes -->
<h2>Notes</h2>
<div style="min-height:60px;border:1px solid #ddd;border-radius:6px;padding:8px;font-size:11px;color:#888">
  Additional notes or observations:
  <br/><br/><br/>
</div>

<!-- Signatures -->
<div class="sig-row">
  <div class="sig-line">Technician Signature / Date</div>
  <div class="sig-line">Client/Manager Approval / Date</div>
</div>

<!-- Footer -->
<div class="footer">
  ${orgName}${orgAddress ? " · " + orgAddress : ""}${orgPhone ? " · " + orgPhone : ""}${orgLicense ? " · Lic #" + orgLicense : ""}
</div>

</div></body></html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Allow popups to export report"); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 600);
}
