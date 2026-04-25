import type { Job } from "./types";
import { wrapPrint, openPrint } from "./print-template";

interface ReportOptions {
  job: Job;
  orgName: string;
  orgPhone: string;
  orgEmail: string;
  orgLicense: string;
  orgAddress: string;
  orgLogo?: string;
  workerNames: string[];
}

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function exportJobReport(opts: ReportOptions) {
  const {
    job,
    orgName,
    orgPhone,
    orgEmail,
    orgLicense,
    orgAddress,
    orgLogo,
    workerNames,
  } = opts;
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const reportNum = "JR-" + job.id.slice(0, 6).toUpperCase();

  // Parse job data
  let workOrder: {
    room: string;
    detail: string;
    action: string;
    pri: string;
    hrs: number;
    done: boolean;
  }[] = [];
  let photos: { url: string; label: string; type: string }[] = [];
  try {
    const data = typeof job.rooms === "string" ? JSON.parse(job.rooms) : job.rooms;
    workOrder = data?.workOrder || [];
    photos = data?.photos || [];
  } catch {
    /* */
  }

  const completedItems = workOrder.filter((w) => w.done);
  const pendingItems = workOrder.filter((w) => !w.done);

  // Work order rows with priority pills
  const priColor = (pri: string) =>
    pri === "HIGH" ? "#C00000" : pri === "MED" ? "#ff8800" : "#00cc66";
  const workRows = workOrder
    .map(
      (w) => `
    <tr>
      <td style="text-align:center;font-size:14px;color:${w.done ? "#00cc66" : "#cfd4dc"}">${w.done ? "&#10003;" : "&#9633;"}</td>
      <td><span style="font-family:Oswald,sans-serif;font-size:10px;padding:2px 7px;border-radius:3px;background:${priColor(w.pri)}22;color:${priColor(w.pri)};letter-spacing:.06em">${esc(w.pri)}</span></td>
      <td><b>${esc(w.room)}</b></td>
      <td>${esc(w.detail)}</td>
      <td class="dim">${esc(w.action)}</td>
      <td class="r">${w.hrs}h</td>
    </tr>
  `,
    )
    .join("");

  // Photo grid (before/after pairs)
  const beforePhotos = photos.filter((p) => p.type === "before");
  const afterPhotos = photos.filter((p) => p.type === "after");
  const workPhotos = photos.filter((p) => p.type === "work");

  const photoSection = (title: string, list: typeof photos) =>
    list.length === 0
      ? ""
      : `
    <h3>${esc(title)}</h3>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
      ${list
        .map(
          (p) =>
            `<div style="text-align:center"><img src="${esc(p.url)}" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:6px;border:1px solid #ddd" /><div style="font-size:11px;color:#666;margin-top:3px">${esc(p.label || "")}</div></div>`,
        )
        .join("")}
    </div>
  `;

  const photoHtml =
    photos.length > 0
      ? `
    <h2>Photos</h2>
    ${photoSection("Before", beforePhotos)}
    ${photoSection("During Work", workPhotos)}
    ${photoSection("After", afterPhotos)}
  `
      : "";

  const body = `
<section class="grid-3" style="margin-bottom:18px">
  <div class="box"><div class="label">Property</div><div class="value">${esc(job.property)}</div></div>
  <div class="box"><div class="label">Client</div><div class="value">${esc(job.client || "—")}</div></div>
  <div class="box"><div class="label">Status</div><div class="value" style="text-transform:capitalize">${esc(job.status)}</div></div>
  <div class="box"><div class="label">Job Date</div><div class="value">${esc(job.job_date || "—")}</div></div>
  <div class="box"><div class="label">Crew</div><div class="value">${esc(workerNames.length ? workerNames.join(", ") : "—")}</div></div>
  <div class="box"><div class="label">Total Hours</div><div class="value">${(job.total_hrs || 0).toFixed(1)} man-hrs</div></div>
</section>

<section style="display:flex;gap:12px;margin-bottom:18px">
  <div class="box" style="flex:1;text-align:center;padding:14px">
    <div style="font-family:Oswald,sans-serif;font-size:30px;font-weight:700;color:#00cc66;line-height:1">${completedItems.length}</div>
    <div class="label" style="margin-top:6px">Completed</div>
  </div>
  <div class="box" style="flex:1;text-align:center;padding:14px">
    <div style="font-family:Oswald,sans-serif;font-size:30px;font-weight:700;color:#ff8800;line-height:1">${pendingItems.length}</div>
    <div class="label" style="margin-top:6px">Pending</div>
  </div>
  <div class="box" style="flex:1;text-align:center;padding:14px">
    <div style="font-family:Oswald,sans-serif;font-size:30px;font-weight:700;color:#2E75B6;line-height:1">${workOrder.length}</div>
    <div class="label" style="margin-top:6px">Total Tasks</div>
  </div>
</section>

${
  pendingItems.length > 0
    ? `<div style="background:#fff8e1;border:1px solid #ff8800;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:12.5px"><b style="color:#ff8800">⚠ ${pendingItems.length} task${pendingItems.length !== 1 ? "s" : ""} still pending.</b> Please review before signing off.</div>`
    : `<div style="background:#e8f7ee;border:1px solid #00cc66;border-radius:8px;padding:12px 14px;margin-bottom:14px;font-size:12.5px"><b style="color:#00cc66">&#10003; All tasks completed.</b> This job is ready for sign-off.</div>`
}

<h2>Work Order Checklist</h2>
<table>
  <thead>
    <tr>
      <th style="width:34px;text-align:center">Done</th>
      <th style="width:54px">Pri</th>
      <th>Room</th>
      <th>Item</th>
      <th>Description</th>
      <th class="r" style="width:54px">Hrs</th>
    </tr>
  </thead>
  <tbody>${workRows || '<tr><td colspan="6" class="dim">No work order items</td></tr>'}</tbody>
</table>

${photoHtml}

<h2>Notes</h2>
<div style="min-height:70px;border:1px dashed #cfd4dc;border-radius:6px;padding:10px;font-size:11px;color:#888">
  Additional notes or observations:
  <br/><br/><br/>
</div>

<div class="sig-row">
  <div class="sig-line">Technician Signature / Date</div>
  <div class="sig-line">Client / Manager Approval / Date</div>
</div>
`;

  const html = wrapPrint(
    {
      orgName,
      orgPhone,
      orgEmail,
      orgAddress,
      orgLicense,
      orgLogo,
      docTitle: "Job Report",
      docNumber: reportNum,
      docDate: today,
      docSubtitle: job.property,
    },
    body,
  );
  if (!openPrint(html)) alert("Allow popups to export report");
}
