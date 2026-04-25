import type { Room } from "./types";
import { calculateCost, makeGuide } from "./parser";
import { wrapPrint, openPrint } from "./print-template";

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

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  const statusUrl = opts.statusUrl || "";
  const photos = opts.photos || [];
  const markupPct = opts.markupPct || 0;
  const taxPct = opts.taxPct || 0;
  const taxAmount = opts.taxAmount || 0;
  const tripFee = opts.tripFee || 0;
  const jobId = opts.jobId || "";

  const quoteNum = jobId
    ? "QT-" + jobId.slice(0, 6).toUpperCase()
    : "QT-" + Date.now().toString(36).toUpperCase().slice(-6);

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const guide = makeGuide(rooms);

  // Build summary rows per trade/room category
  const summaryRows = rooms.map((rm) => {
    const items = rm.items;
    const hrs = items.reduce((s, it) => s + it.laborHrs, 0);
    const labor = hrs * rate;
    const mat = items.reduce(
      (s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0),
      0,
    );
    return { name: rm.name, hrs, labor, mat, total: labor + mat, itemCount: items.length };
  });

  // Build detailed breakdown sections — consolidate duplicate materials per
  // section so the PDF reads like a real estimate, not a dump of every line.
  let breakdownHtml = "";
  rooms.forEach((rm) => {
    if (rm.items.length === 0) return;
    const sectionHrs = rm.items.reduce((s, it) => s + it.laborHrs, 0);
    const sectionLabor = sectionHrs * rate;
    const sectionMat = rm.items.reduce(
      (s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0),
      0,
    );

    const matMap: Record<
      string,
      { n: string; unitPrice: number; qty: number; total: number; notes: string[] }
    > = {};
    rm.items.forEach((it) => {
      it.materials.forEach((m) => {
        if (m.c > 0) {
          const matQty = (m as unknown as Record<string, unknown>).qty as number || 1;
          const matUnit = (m as unknown as Record<string, unknown>).unitPrice as number || m.c;
          const key = m.n + "|" + matUnit;
          if (matMap[key]) {
            matMap[key].qty += matQty;
            matMap[key].total += m.c;
            if (it.detail && !matMap[key].notes.includes(it.detail))
              matMap[key].notes.push(it.detail);
          } else {
            matMap[key] = {
              n: m.n,
              unitPrice: matUnit,
              qty: matQty,
              total: m.c,
              notes: it.detail ? [it.detail] : [],
            };
          }
        }
      });
    });
    let matRows = "";
    Object.values(matMap).forEach((m) => {
      matRows += `<tr><td>${esc(m.n)}</td><td class="r">${m.qty}</td><td class="r">$${m.unitPrice.toFixed(2)}</td><td class="r">$${m.total.toFixed(2)}</td><td class="dim">${esc(m.notes.slice(0, 3).join(", "))}</td></tr>`;
    });

    const crewSize = sectionHrs > 8 ? 2 : 1;
    const clockHrs = crewSize > 1 ? (sectionHrs / crewSize).toFixed(1) : sectionHrs.toFixed(1);

    breakdownHtml += `
    <div style="margin-bottom:18px;page-break-inside:avoid">
      <h3>${esc(rm.name)}</h3>
      <table>
        <thead><tr><th>Material</th><th class="r" style="width:50px">Qty</th><th class="r" style="width:80px">Unit Price</th><th class="r" style="width:80px">Total</th><th>Notes</th></tr></thead>
        <tbody>${matRows || '<tr><td colspan="5" class="dim">Labor only</td></tr>'}</tbody>
      </table>
      <div style="background:#f5f7fa;border-radius:6px;padding:10px 14px;font-size:12px;margin-top:6px">
        <div>Material Subtotal: <b>$${sectionMat.toFixed(2)}</b></div>
        <div>Labor (${clockHrs} clock hrs × ${crewSize} crew = ${sectionHrs.toFixed(1)} man-hrs at $${rate}/hr): <b>$${sectionLabor.toFixed(2)}</b></div>
        <div style="font-size:13px;margin-top:6px;padding-top:6px;border-top:1px solid #ddd;color:#2E75B6;font-weight:600">
          Material: $${sectionMat.toFixed(2)} &nbsp;·&nbsp; Labor: $${sectionLabor.toFixed(2)} &nbsp;·&nbsp;
          <b>Section Total: $${(sectionLabor + sectionMat).toFixed(2)}</b>
        </div>
      </div>
    </div>`;
  });

  // Tools checklist
  const toolsHtml = guide.tools
    .map((t) => `<span style="min-width:140px;display:inline-block;font-size:12px">☐ ${esc(t)}</span>`)
    .join("");

  // Subtotal before markup/tax
  const subtotal = totalLabor + totalMat;

  const body = `
${(client || clientEmail || clientPhone) ? `
<section style="background:#f5f7fa;border-radius:8px;padding:14px 16px;margin-bottom:14px">
  <h4>Client</h4>
  <div style="font-size:14px;font-weight:600;margin-top:2px">${esc(client || "—")}</div>
  ${clientEmail ? `<div style="font-size:12px;color:#666">${esc(clientEmail)}</div>` : ""}
  ${clientPhone ? `<div style="font-size:12px;color:#666">${esc(clientPhone)}</div>` : ""}
</section>
` : ""}

<section class="grid-4" style="margin-bottom:18px">
  <div class="box"><div class="label">Property</div><div class="value">${esc(property || "—")}</div></div>
  <div class="box"><div class="label">Issue Date</div><div class="value">${today}</div></div>
  <div class="box"><div class="label">License No</div><div class="value">${esc(orgLicense || "—")}</div></div>
  <div class="box"><div class="label">Valid For</div><div class="value">30 Days</div></div>
</section>

<h2>Estimate Summary</h2>
<table>
  <thead>
    <tr>
      <th>Category</th>
      <th class="r" style="width:80px">Man-Hrs</th>
      <th class="r" style="width:90px">Labor</th>
      <th class="r" style="width:90px">Material</th>
      <th class="r" style="width:100px">Section Total</th>
    </tr>
  </thead>
  <tbody>
    ${summaryRows
      .map(
        (r) =>
          `<tr><td>${esc(r.name)}</td><td class="r">${r.hrs.toFixed(1)}</td><td class="r">$${r.labor.toFixed(2)}</td><td class="r">$${r.mat.toFixed(2)}</td><td class="r">$${r.total.toFixed(2)}</td></tr>`,
      )
      .join("")}
    <tr style="font-weight:700;background:#f0f4f8;border-top:2px solid #2E75B6;color:#2E75B6">
      <td>SUBTOTAL</td>
      <td class="r">${totalHrs.toFixed(1)}</td>
      <td class="r">$${totalLabor.toFixed(2)}</td>
      <td class="r">$${totalMat.toFixed(2)}</td>
      <td class="r">$${subtotal.toFixed(2)}</td>
    </tr>
  </tbody>
</table>

${(markupPct > 0 || taxPct > 0 || tripFee > 0) ? `
<table style="width:auto;margin-left:auto;font-size:12px;margin-bottom:14px">
  ${markupPct > 0 ? `<tr><td class="dim">Material Markup (${markupPct}%)</td><td class="r" style="padding-left:24px">Included in materials</td></tr>` : ""}
  ${tripFee > 0 ? `<tr><td class="dim">Trip Fee</td><td class="r" style="padding-left:24px">$${tripFee.toFixed(2)}</td></tr>` : ""}
  ${taxPct > 0 ? `<tr><td class="dim">Tax (${taxPct}%)</td><td class="r" style="padding-left:24px">$${taxAmount.toFixed(2)}</td></tr>` : ""}
  <tr style="font-weight:700;font-size:16px;color:#2E75B6;font-family:Oswald,sans-serif">
    <td>GRAND TOTAL</td>
    <td class="r" style="padding-left:24px">$${grandTotal.toFixed(2)}</td>
  </tr>
</table>
` : ""}

<h2>Project Breakdown &amp; Costs</h2>
${breakdownHtml}

${photos.length > 0 ? `
<h2>Project Photos</h2>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;page-break-inside:avoid">
  ${photos
    .map(
      (p) =>
        `<div style="text-align:center"><img src="${esc(p.url)}" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:6px;border:1px solid #ddd" /><div style="font-size:11px;color:#666;margin-top:3px">${esc(p.label || p.type || "")}</div></div>`,
    )
    .join("")}
</div>
` : ""}

<h2>Tools Checklist</h2>
<div style="display:flex;flex-wrap:wrap;gap:4px 16px;margin-bottom:16px">${toolsHtml}</div>

<h2>Notes &amp; Exclusions</h2>
<div style="font-size:12px;color:#444;line-height:1.8">
  <ul style="padding-left:20px">
    <li>Labor rate: <b>$${rate}.00/man-hour</b>. Man-hours = clock hours × crew size (2-man crew tasks billed at 2× clock time).</li>
    <li>Materials priced at current Home Depot/Lowe's retail. All material quantities and unit prices listed per line item above.</li>
    <li>Quote valid <b>30 days</b> from issue date. <b>50% deposit</b> to begin; balance due on completion.</li>
    <li>Any unforeseen conditions (mold, hidden water damage, structural issues) will be documented and quoted as a separate change order before proceeding.</li>
    <li>Items requiring licensed professionals (electrical panel work, major HVAC, gas lines) are NOT included unless noted.</li>
  </ul>
</div>

<section style="background:linear-gradient(135deg,#f0f4f8 0%,#e8eef5 100%);border:2px solid #2E75B6;border-radius:12px;padding:20px 24px;margin-top:22px;text-align:center;page-break-inside:avoid">
  <h3 style="font-family:Oswald,sans-serif;font-size:16px;color:#2E75B6;text-transform:uppercase;margin:0 0 8px;letter-spacing:.08em">Accept This Estimate</h3>
  <div style="font-family:Oswald,sans-serif;font-size:32px;font-weight:700;color:#2E75B6;margin:8px 0">$${grandTotal.toFixed(2)}</div>
  <div style="font-size:12px;color:#444;line-height:1.9">
    ${statusUrl ? `<div>🔗 <b>View &amp; approve online:</b> <a href="${esc(statusUrl)}" style="color:#2E75B6">${esc(statusUrl)}</a></div>` : ""}
    ${orgPhone ? `<div>☎ <b>Call:</b> ${esc(orgPhone)}</div>` : ""}
    ${orgEmail ? `<div>✉ <b>Email:</b> ${esc(orgEmail)}</div>` : ""}
  </div>
  <div style="font-size:11px;color:#888;margin-top:8px">Reference: ${quoteNum}</div>
</section>

<div class="sig-row">
  <div class="sig-line">Authorized Signature &nbsp; / &nbsp; Date</div>
  <div class="sig-line">Client Approval &nbsp; / &nbsp; Date</div>
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
      docTitle: "Estimate",
      docNumber: quoteNum,
      docDate: today,
      docSubtitle: property,
    },
    body,
  );

  if (!openPrint(html)) {
    if (typeof window !== "undefined") {
      const toast = (
        window as unknown as { __dbToast?: (m: string, t: "error") => void }
      ).__dbToast;
      if (toast) toast("Allow popups to export PDF", "error");
    }
  }
}
