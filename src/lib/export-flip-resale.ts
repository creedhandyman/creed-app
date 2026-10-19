import type { FlipProject, Organization } from "./types";
import type { ResaleData, ResalePhoto } from "./flip";
import { compsArv } from "./flip";
import { wrapPrint } from "./print-template";

/* Flip Mode — the resale package: a one-page-ish sheet for the listing agent,
   buyers or an appraiser. What was done (finished work only, from the linked
   jobs), before/after photos, permits, and the nearby sales behind the price.
   Data comes from resaleData() + the flip row; this file only renders. */

export interface ResaleOptions {
  photos: boolean;
  /** AI "proposed finish" renders — labelled as renderings, never as photos. */
  renders: boolean;
  permits: boolean;
  comps: boolean;
  /** What the rehab cost so far. Off by default: buyers who see the cost
   *  negotiate against it. */
  invested: boolean;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

const PERMIT_LABEL: Record<string, string> = {
  needed: "Permit needed",
  applied: "Applied for",
  issued: "Issued — inspection pending",
  final: "Final inspection passed",
};

export function buildResaleHtml(args: {
  project: FlipProject;
  data: ResaleData;
  spent: number;
  org: Partial<Organization> | null;
  opts: ResaleOptions;
}): string {
  const { project: p, data, spent, org, opts } = args;
  const orgName = org?.name || "";
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const facts = [
    p.beds ? { l: "Bedrooms", v: String(p.beds) } : null,
    p.baths ? { l: "Bathrooms", v: String(p.baths) } : null,
    p.sqft ? { l: "Square feet", v: Number(p.sqft).toLocaleString() } : null,
    data.areas.length ? { l: "Areas renovated", v: String(data.areas.length) } : null,
    orgName ? { l: "Renovated by", v: orgName } : null,
    opts.invested && spent > 0 ? { l: "Invested in improvements", v: money(spent) } : null,
  ].filter(Boolean) as { l: string; v: string }[];

  const factsHtml = facts.length
    ? `<section class="grid-3" style="margin-bottom:18px">${facts
        .map((f) => `<div class="box"><div class="label">${esc(f.l)}</div><div class="value">${esc(f.v)}</div></div>`)
        .join("")}</section>`
    : "";

  const workHtml = data.areas.length
    ? `<h2>What Was Done</h2>
<div style="columns:2;column-gap:22px;margin-bottom:14px">${data.areas
        .map(
          (a) => `<div style="break-inside:avoid;margin-bottom:12px">
  <h3 style="margin:0 0 4px">${esc(a.area)}</h3>
  <ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.55">${a.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
</div>`,
        )
        .join("")}</div>`
    : "";

  const subs = (p.subs || []).filter((s) => s?.trade && s.permit && s.permit.status !== "none");
  const permitsHtml = opts.permits && subs.length
    ? `<h2>Permits</h2>
<table><thead><tr><th>Trade</th><th>Permit #</th><th>Status</th></tr></thead><tbody>${subs
        .map((s) => `<tr><td><b>${esc(s.trade)}</b></td><td>${esc(s.permit?.number || "—")}</td><td>${esc(PERMIT_LABEL[s.permit!.status] || s.permit!.status)}</td></tr>`)
        .join("")}</tbody></table>`
    : "";

  const grid = (list: ResalePhoto[]) =>
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">${list
      .map(
        (ph) => `<div style="break-inside:avoid;text-align:center"><img src="${esc(ph.url)}" alt="" style="width:100%;height:190px;object-fit:cover;border-radius:6px;border:1px solid #ddd" />${
          ph.label ? `<div style="font-size:11px;color:#666;margin-top:3px">${esc(ph.label)}</div>` : ""
        }</div>`,
      )
      .join("")}</div>`;
  const photosHtml = opts.photos && (data.before.length || data.after.length)
    ? `<h2>Photos</h2>
${data.before.length ? `<h3>Before</h3>${grid(data.before)}` : ""}
${data.after.length ? `<h3>After</h3>${grid(data.after)}` : ""}`
    : "";
  const rendersHtml = opts.renders && data.renders.length
    ? `<h2>Design Concepts</h2>
<div class="dim" style="font-size:11px;margin:-4px 0 8px">AI renderings made during planning — not photographs of the finished home.</div>
${grid(data.renders)}`
    : "";

  const comps = (p.comps || []).filter((c) => c && (c.address || c.price));
  const est = compsArv(comps, p.sqft);
  const compsHtml = opts.comps && comps.length
    ? `<h2>Nearby Sales</h2>
<table><thead><tr><th>Address</th><th>Status</th><th class="r">Price</th><th class="r">Sq ft</th><th class="r">$/sq ft</th></tr></thead><tbody>${comps
        .map(
          (c) => `<tr><td>${esc(c.address || "—")}</td><td>${c.status === "pending" ? "Pending" : "Sold"}</td><td class="r">${c.price ? money(c.price) : "—"}</td><td class="r">${c.sqft ? Number(c.sqft).toLocaleString() : "—"}</td><td class="r">${c.price && c.sqft ? `$${Math.round(c.price / c.sqft)}` : "—"}</td></tr>`,
        )
        .join("")}</tbody></table>
${est ? `<div style="font-size:12.5px;margin:8px 0 14px">Average <b>$${Math.round(est.ppsf)}/sq ft</b> across ${est.count} sale${est.count === 1 ? "" : "s"}${
        est.arv > 0 ? ` &times; ${Number(p.sqft).toLocaleString()} sq ft = <b>${money(est.arv)}</b>` : ""
      }.</div>` : ""}`
    : "";

  const body = `
${factsHtml}
${workHtml || `<div class="dim" style="font-size:12px;margin-bottom:14px">No finished work recorded yet.</div>`}
${permitsHtml}
${photosHtml}
${rendersHtml}
${compsHtml}
<div class="dim" style="font-size:10.5px;margin-top:18px;border-top:1px solid #e3e6ea;padding-top:8px">
  Prepared${orgName ? ` by ${esc(orgName)}` : ""} on ${esc(today)}. Provided for reference; buyers should verify all details independently.
</div>`;

  return wrapPrint(
    {
      orgName,
      orgPhone: org?.phone,
      orgEmail: org?.email,
      orgAddress: org?.address,
      orgLicense: org?.license_num,
      orgLogo: org?.logo_url,
      accent: org?.brand_color,
      accent2: org?.brand_color_2,
      docTitle: "Property Improvements",
      docDate: today,
      docSubtitle: p.address,
    },
    body,
  );
}
