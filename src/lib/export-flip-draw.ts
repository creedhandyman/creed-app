import type { FlipDraw, FlipProject, Organization } from "./types";
import type { FlipLine, ResaleData } from "./flip";
import { drawFee } from "./flip";
import { wrapPrint } from "./print-template";

/* Flip Mode — a draw request for the lender: the loan, where this draw sits
   against the rehab holdback, the finished work and per-job progress behind
   it, and recent photos. Numbers come from the flip row; work + photos from
   resaleData / flipActuals (src/lib/flip.ts). This file only renders. */

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const fmtDate = (ymd?: string) => (ymd ? new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");

export function buildDrawRequestHtml(args: {
  project: FlipProject;
  draw: FlipDraw;
  lines: FlipLine[];
  work: ResaleData;
  org: Partial<Organization> | null;
}): string {
  const { project: p, draw, lines, work, org } = args;
  const loan = p.loan || {};
  const draws = loan.draws || [];
  const idx = Math.max(0, draws.findIndex((d) => d.id === draw.id));
  const holdback = n(loan.holdback);
  // Every OTHER draw already funded, and every other one sent to the lender
  // but not paid yet — both come out of the holdback before this one.
  const others = draws.filter((d) => d.id !== draw.id);
  const fundedDraws = others.filter((d) => d.status === "funded");
  const prior = fundedDraws.reduce((s, d) => s + n(d.amount), 0);
  const pendingOther = others
    .filter((d) => d.status === "requested" || d.status === "inspected")
    .reduce((s, d) => s + n(d.amount), 0);
  const amount = n(draw.amount);
  const fee = drawFee(loan, draw);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const box = (l: string, v: string) => `<div class="box"><div class="label">${esc(l)}</div><div class="value">${esc(v || "—")}</div></div>`;
  const facts = `<section class="grid-3" style="margin-bottom:16px">
  ${box("Lender", loan.lender || "")}
  ${box("Loan #", loan.loan_no || "")}
  ${box("Borrower", org?.name || "")}
  ${box("Property", p.address)}
  ${box("Draw", `#${idx + 1}${draw.label ? ` — ${draw.label}` : ""}`)}
  ${box("Requested", fmtDate(draw.requested_at) || today)}
</section>`;

  const row = (l: string, v: string, strong = false) =>
    `<tr${strong ? ' style="font-weight:700"' : ""}><td>${esc(l)}</td><td class="r">${v}</td></tr>`;
  const budget = `<h2>Draw Summary</h2>
<table><tbody>
  ${holdback ? row("Rehab holdback (total)", money(holdback)) : ""}
  ${row(`Funded to date (${fundedDraws.length} draw${fundedDraws.length === 1 ? "" : "s"})`, money(prior))}
  ${pendingOther ? row("Other requests not yet funded", money(pendingOther)) : ""}
  ${row("This request", money(amount), true)}
  ${fee ? row("Draw / inspection fee", money(fee)) : ""}
  ${holdback ? row("Holdback remaining after this draw", money(Math.max(0, holdback - prior - pendingOther - amount))) : ""}
</tbody></table>
${draw.note ? `<div style="font-size:12px;margin:-6px 0 14px"><b>Note:</b> ${esc(draw.note)}</div>` : ""}`;

  const progress = lines.length
    ? `<h2>Progress by Job</h2>
<table><thead><tr><th>Scope</th><th>Status</th><th class="r">Tasks done</th></tr></thead><tbody>${lines
        .map((l) => `<tr><td><b>${esc(l.label || "Job")}</b></td><td style="text-transform:capitalize">${esc(l.status)}</td><td class="r">${
          l.tasksTotal ? `${l.tasksDone} of ${l.tasksTotal} (${Math.round((l.tasksDone / l.tasksTotal) * 100)}%)` : "—"
        }</td></tr>`)
        .join("")}</tbody></table>`
    : "";

  const done = work.areas.length
    ? `<h2>Work Completed to Date</h2>
<div style="columns:2;column-gap:22px;margin-bottom:12px">${work.areas
        .map((a) => `<div style="break-inside:avoid;margin-bottom:10px"><h3 style="margin:0 0 3px">${esc(a.area)}</h3><ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.5">${a.items
          .map((i) => `<li>${esc(i)}</li>`)
          .join("")}</ul></div>`)
        .join("")}</div>`
    : "";

  // Most recent progress photos first: after shots, then in-progress ones.
  const photos = [...work.after, ...work.work].slice(-6).reverse();
  const photoHtml = photos.length
    ? `<h2>Photos</h2>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">${photos
        .map((ph) => `<div style="break-inside:avoid;text-align:center"><img src="${esc(ph.url)}" alt="" style="width:100%;height:140px;object-fit:cover;border-radius:6px;border:1px solid #ddd" />${
          ph.label ? `<div style="font-size:10.5px;color:#666;margin-top:2px">${esc(ph.label)}</div>` : ""
        }</div>`)
        .join("")}</div>`
    : "";

  const body = `
${facts}
${budget}
${progress}
${done}
${photoHtml}
<div class="dim" style="font-size:11px;margin-top:10px">I certify the work above is complete as described and request release of the amount shown.</div>
<div class="sig-row">
  <div class="sig-line">Borrower Signature / Date</div>
  <div class="sig-line">Lender / Inspector Approval / Date</div>
</div>`;

  return wrapPrint(
    {
      orgName: org?.name || "",
      orgPhone: org?.phone,
      orgEmail: org?.email,
      orgAddress: org?.address,
      orgLicense: org?.license_num,
      orgLogo: org?.logo_url,
      accent: org?.brand_color,
      accent2: org?.brand_color_2,
      docTitle: "Draw Request",
      docNumber: `Draw #${idx + 1}`,
      docDate: today,
      docSubtitle: p.address,
    },
    body,
  );
}
