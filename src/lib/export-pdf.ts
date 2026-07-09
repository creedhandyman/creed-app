import type { Room, RoomItem, JobDiscount } from "./types";
import { wrapPrint, openPrint } from "./print-template";
import { computeTax, resolveTaxMode, type TaxMode } from "./tax";
import { itemInTier, itemTiers, type TierKey } from "./tiers";

interface ExportOptions {
  property: string;
  client: string;
  clientPhone?: string;
  clientEmail?: string;
  rooms: Room[];
  rate: number;
  workers: { id: string; name: string }[];
  /** Ignored — the PDF recomputes labor/material/hour totals from
   *  `rooms` × the current `rate` so a stale saved value (e.g. org rate
   *  changed after the quote was created) doesn't leak into the print.
   *  Kept on the type for backward-compat with existing call sites. */
  grandTotal?: number;
  totalLabor?: number;
  totalMat?: number;
  totalHrs?: number;
  trade?: string;
  jobId?: string;
  orgName?: string;
  orgPhone?: string;
  orgEmail?: string;
  orgLicense?: string;
  orgAddress?: string;
  orgLogo?: string;
  /** Brand accent + optional gradient stop, threaded to the PDF template. */
  accent?: string;
  accent2?: string;
  statusUrl?: string;
  photos?: { url: string; label: string; type: string }[];
  /** AI "proposed finish" before/after pairs (rendered photos flagged
   *  includeInQuote). Rendered as a Now → Done section in the estimate. */
  renders?: { sourceUrl?: string; url: string }[];
  markupPct?: number;
  taxPct?: number;
  taxAmount?: number;
  tripFee?: number;
  /** Per-quote discount (Feature 1). Rendered as a -$XXX.XX line in the
   *  totals table between Trip Fee and Tax. Null/undefined = none. */
  discount?: JobDiscount | null;
  /** Effective minimum-labor-hours floor. When the sum of line-item
   *  labor hours falls below this, the PDF rebills labor at
   *  `minLaborHours × rate` and adds a "minimum service charge" note
   *  under the labor line. 0 / null / undefined = no floor. */
  minLaborHours?: number | null;
  /** Resolved tax mode for this quote. Caller should pre-resolve the
   *  per-quote override against the org default; the PDF treats this
   *  as authoritative. Defaults to "total" (legacy behavior) when
   *  undefined. */
  taxMode?: TaxMode;
  /** Quote terms shown in the PDF's "Notes & Exclusions" — org settings so the
   *  bottom of the quote reflects this business, not a fixed template.
   *  depositPct 0 = no deposit line. quoteTerms = extra bullets (one per line). */
  depositPct?: number;
  quoteValidDays?: number;
  quoteTerms?: string;
  /** Good-Better-Best tiered quote. When true (and some items are tagged
   *  better/best), the PDF renders a compact 3-column "Choose your option"
   *  block with each cumulative option's total + what it adds. tierNames
   *  relabels the Better/Best columns. */
  tieredQuote?: boolean;
  tierNames?: { better: string; best: string };
}

const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function exportQuotePdf(opts: ExportOptions) {
  const {
    property,
    client,
    rooms,
    rate,
  } = opts;

  const orgName = opts.orgName || "Service Provider";
  const orgPhone = opts.orgPhone || "";
  const orgEmail = opts.orgEmail || "";
  const orgLicense = opts.orgLicense || "";
  const orgAddress = opts.orgAddress || "";
  const orgLogo = opts.orgLogo || "";
  const accent = opts.accent || "#2E75B6";
  const accent2 = opts.accent2 || "#1f5d94";
  const depositPct = typeof opts.depositPct === "number" ? opts.depositPct : 50;
  const validDays = typeof opts.quoteValidDays === "number" && opts.quoteValidDays > 0 ? opts.quoteValidDays : 30;
  const quoteTerms = (opts.quoteTerms || "").trim();
  const clientPhone = opts.clientPhone || "";
  const clientEmail = opts.clientEmail || "";
  const statusUrl = opts.statusUrl || "";
  const photos = opts.photos || [];
  const renders = opts.renders || [];
  const markupPct = opts.markupPct || 0;
  const taxPct = opts.taxPct || 0;
  const tripFee = opts.tripFee || 0;
  const jobId = opts.jobId || "";
  const discount = opts.discount && opts.discount.value > 0 ? opts.discount : null;
  const minLaborHours = typeof opts.minLaborHours === "number" && opts.minLaborHours > 0
    ? opts.minLaborHours
    : 0;

  // Recompute totals from the rooms blob using the caller-supplied rate
  // (resolution: per-quote laborRate → current org default → $55). This
  // keeps the per-section labor rows, the SUBTOTAL row, the discount, the
  // tax line, and the Grand Total consistent with each other even when
  // the org's default rate changed AFTER the quote was saved — the saved
  // job.total_labor/job.total would be stale, but the PDF should reflect
  // the LATEST rate at generation time.
  const allItems = rooms.flatMap((r) => r.items);
  const rawTotalHrs = allItems.reduce((s, it) => s + it.laborHrs, 0);
  // Minimum-labor-hours floor (matches the QuoteForge live preview).
  // Only kicks in when the quote already has SOME labor on it — pure
  // material quotes don't trigger the floor.
  const minApplies = minLaborHours > 0 && rawTotalHrs > 0 && rawTotalHrs < minLaborHours;
  const totalHrs = minApplies ? minLaborHours : rawTotalHrs;
  const totalLabor = Math.round(totalHrs * rate * 100) / 100;
  // Material markup is applied per-item (matching QuoteForge.tm) so the
  // SUBTOTAL value matches the "Material Markup (X%) included in
  // materials" disclaimer below.
  const totalMat = allItems.reduce((s, it) => {
    const raw = it.materials.reduce((ss, m) => ss + (m.c || 0), 0);
    return s + (markupPct > 0 ? Math.round(raw * (1 + markupPct / 100) * 100) / 100 : raw);
  }, 0);

  // Pre-discount, pre-tax base. Line item material costs already include
  // markup (applied at quote save / edit time), so subtotal + trip fee is
  // the correct discount base.
  const _preDiscountBase = totalLabor + totalMat + tripFee;
  const discountAmount = discount
    ? (discount.type === "percent"
        ? Math.round(_preDiscountBase * (discount.value / 100) * 100) / 100
        : Math.min(_preDiscountBase, discount.value))
    : 0;
  const discountLabel = discount
    ? (discount.label && discount.label.trim()
        ? discount.label.trim()
        : (discount.type === "percent"
            ? `Discount (${discount.value}%)`
            : `Discount ($${discount.value.toFixed(2)} off)`))
    : "";

  const taxMode = resolveTaxMode(opts.taxMode);
  const baseAfterDiscount = Math.max(0, Math.round((_preDiscountBase - discountAmount) * 100) / 100);
  const taxCalc = computeTax({
    labor: totalLabor,
    materials: totalMat,
    tripFee,
    discountAmount,
    taxPct,
    taxMode,
  });
  const taxAmount = taxCalc.taxAmount;
  const taxLabel = taxCalc.taxLabel;
  const grandTotal = Math.round((baseAfterDiscount + taxAmount) * 100) / 100;

  // Good-Better-Best options. Each option re-runs the SAME labor/markup/
  // min-floor/discount/tax cascade over ITS OWN item set (membership-based, so
  // options can be mutually exclusive). itemInTier falls back to the legacy
  // cumulative reading for pre-membership quotes.
  const tieredQuote = opts.tieredQuote === true;
  const tierNames = {
    better: (opts.tierNames?.better || "").trim() || "Better",
    best: (opts.tierNames?.best || "").trim() || "Best",
  };
  const tierItemsOf = (t: TierKey): RoomItem[] => allItems.filter((i) => itemInTier(i, t));
  const tierTotalOf = (items: RoomItem[]): number => {
    const rawHrs = items.reduce((s, it) => s + it.laborHrs, 0);
    const mApplies = minLaborHours > 0 && rawHrs > 0 && rawHrs < minLaborHours;
    const hrs = mApplies ? minLaborHours : rawHrs;
    const labor = Math.round(hrs * rate * 100) / 100;
    const mat = items.reduce((s, it) => {
      const raw = it.materials.reduce((ss, m) => ss + (m.c || 0), 0);
      return s + (markupPct > 0 ? Math.round(raw * (1 + markupPct / 100) * 100) / 100 : raw);
    }, 0);
    const preDisc = labor + mat + tripFee;
    const dAmt = discount
      ? (discount.type === "percent"
          ? Math.round(preDisc * (discount.value / 100) * 100) / 100
          : Math.min(preDisc, discount.value))
      : 0;
    const baseAfter = Math.max(0, Math.round((preDisc - dAmt) * 100) / 100);
    const tax = computeTax({ labor, materials: mat, tripFee, discountAmount: dAmt, taxPct, taxMode }).taxAmount;
    return Math.round((baseAfter + tax) * 100) / 100;
  };
  // Options differ once any line isn't in all three (a membership split).
  const anySplit = allItems.some((i) => itemTiers(i).length !== 3);
  const showTiers = tieredQuote && anySplit;
  const tierCols = showTiers
    ? [
        { name: "Base", total: tierTotalOf(tierItemsOf("base")), items: tierItemsOf("base") },
        { name: tierNames.better, total: tierTotalOf(tierItemsOf("better")), items: tierItemsOf("better") },
        { name: tierNames.best, total: tierTotalOf(tierItemsOf("best")), items: tierItemsOf("best") },
      ]
    : [];
  // For a tiered quote the options can be mutually exclusive, so the sum of all
  // line items (grandTotal) is NOT a real price. Present a range instead; the
  // customer picks a specific option online.
  const tierColTotals = tierCols.map((c) => c.total);
  const tierMin = showTiers ? Math.min(...tierColTotals) : grandTotal;
  const tierMax = showTiers ? Math.max(...tierColTotals) : grandTotal;
  const tierRange = tierMin === tierMax ? `$${tierMax.toFixed(0)}` : `$${tierMin.toFixed(0)}–$${tierMax.toFixed(0)}`;
  const tiersHtml = showTiers
    ? `
<h2>Choose Your Option</h2>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:8px;page-break-inside:avoid">
  ${tierCols
    .map((col, idx) => {
      const hue = idx === 0 ? "#666" : idx === 1 ? accent : "#7a3fb8";
      const itemsList = col.items.length
        ? `<ul style="padding-left:16px;margin:6px 0 0;font-size:11px;color:#444;line-height:1.5">${col.items.slice(0, 6).map((a) => `<li>${esc(a.detail)}</li>`).join("")}${col.items.length > 6 ? `<li>+${col.items.length - 6} more</li>` : ""}</ul>`
        : `<div style="font-size:11px;color:#888;margin-top:6px">No work in this option</div>`;
      return `<div style="border:2px solid ${hue};border-radius:10px;padding:12px;page-break-inside:avoid">
      <div style="font-family:Oswald,sans-serif;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:${hue};font-weight:700">${esc(col.name)}</div>
      <div style="font-family:Oswald,sans-serif;font-size:24px;font-weight:700;color:${hue};margin:4px 0 2px">$${col.total.toFixed(0)}</div>
      <div style="font-size:11px;color:#666">${col.items.length} line item${col.items.length === 1 ? "" : "s"}</div>
      ${itemsList}
    </div>`;
    })
    .join("")}
</div>
<div style="font-size:11px;color:#888;margin-bottom:18px">Each option above is a complete, standalone scope — pick the one you want. The line-item breakdown that follows lists all quoted work across the options for reference.</div>
`
    : "";

  const quoteNum = jobId
    ? "QT-" + jobId.slice(0, 6).toUpperCase()
    : "QT-" + Date.now().toString(36).toUpperCase().slice(-6);

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Pre-aggregate rooms by trade category (case-insensitive name match) so
  // multiple Room objects with the same trade — e.g. two "Painting" rooms
  // from different parse batches — collapse into one PDF section. Without
  // this, the breakdown could render the same trade twice and the per-room
  // material dedup wouldn't bridge the gap.
  type Category = { name: string; items: RoomItem[] };
  const byCategory: Record<string, Category> = {};
  const categoryOrder: string[] = [];
  rooms.forEach((rm) => {
    if (rm.items.length === 0) return;
    const key = rm.name.trim().toLowerCase();
    if (!byCategory[key]) {
      byCategory[key] = { name: rm.name, items: [] };
      categoryOrder.push(key);
    }
    byCategory[key].items.push(...rm.items);
  });
  const categories = categoryOrder.map((k) => byCategory[k]);

  // Build summary rows per trade category (one row per category, not per
  // raw Room — so duplicate trade entries fold together).
  const summaryRows = categories.map((cat) => {
    const hrs = cat.items.reduce((s, it) => s + it.laborHrs, 0);
    const labor = hrs * rate;
    const mat = cat.items.reduce(
      (s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0),
      0,
    );
    return { name: cat.name, hrs, labor, mat, total: labor + mat, itemCount: cat.items.length };
  });

  // Virtual "Minimum service charge" row inserted between per-trade rows
  // and the SUBTOTAL. It bridges the gap between the actual sum of
  // section labors (= rawTotalHrs × rate) and the floored total
  // (= totalHrs × rate) so the column-sum math is self-consistent on
  // the printed estimate.
  const minRow = minApplies
    ? (() => {
        const deltaHrs = Math.round((minLaborHours - rawTotalHrs) * 100) / 100;
        const deltaLabor = Math.round(deltaHrs * rate * 100) / 100;
        return { hrs: deltaHrs, labor: deltaLabor };
      })()
    : null;

  // Build detailed breakdown sections — consolidate duplicate materials
  // across ALL items in the category by (normalized name + rounded unit
  // price) so the same SKU from different rooms merges into one row with
  // summed qty, summed total, and a deduped, comma-separated note listing
  // every room/task that needed it. Different SKUs of the same product
  // family ("Wall paint (1 gal)" vs "Wall paint (3 gal)") stay separate
  // because their unit prices differ.
  let breakdownHtml = "";
  categories.forEach((cat) => {
    const sectionHrs = cat.items.reduce((s, it) => s + it.laborHrs, 0);
    const sectionLabor = sectionHrs * rate;
    const sectionMat = cat.items.reduce(
      (s, it) => s + it.materials.reduce((ss, m) => ss + (m.c || 0), 0),
      0,
    );

    const matMap: Record<
      string,
      { n: string; unitPrice: number; qty: number; total: number; notes: string[] }
    > = {};
    cat.items.forEach((it) => {
      it.materials.forEach((m) => {
        if (m.c > 0) {
          const matQty = m.qty && m.qty > 0 ? m.qty : 1;
          // unitPrice falls back to c/qty so a lump-sum entry still divides
          // correctly across qty when the AI only set one of the two.
          // Rounded to 2dp so trivial floating-point variance ($30.00 vs
          // $30.0000001) doesn't split rows.
          const matUnit = Math.round(
            (m.unitPrice && m.unitPrice > 0 ? m.unitPrice : m.c / matQty) * 100,
          ) / 100;
          // Normalize the name for keying (trim + lowercase) so casing or
          // trailing-space differences in AI output don't split rows.
          // Display name preserves original casing (first-seen).
          const nameKey = m.n.trim().toLowerCase();
          const key = nameKey + "|" + matUnit;
          if (matMap[key]) {
            matMap[key].qty += matQty;
            matMap[key].total += m.c;
            if (it.detail && !matMap[key].notes.includes(it.detail))
              matMap[key].notes.push(it.detail);
          } else {
            matMap[key] = {
              n: m.n.trim(),
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
      matRows += `<tr><td>${esc(m.n)}</td><td class="r">${m.qty}</td><td class="r">$${m.unitPrice.toFixed(2)}</td><td class="r">$${m.total.toFixed(2)}</td><td class="dim">${esc(m.notes.join(", "))}</td></tr>`;
    });

    const crewSize = sectionHrs > 8 ? 2 : 1;
    const clockHrs = crewSize > 1 ? (sectionHrs / crewSize).toFixed(1) : sectionHrs.toFixed(1);

    breakdownHtml += `
    <div style="margin-bottom:10px">
      <h3>${esc(cat.name)}</h3>
      <table>
        <thead><tr><th>Material</th><th class="r" style="width:50px">Qty</th><th class="r" style="width:80px">Unit Price</th><th class="r" style="width:80px">Total</th><th>Notes</th></tr></thead>
        <tbody>${matRows || '<tr><td colspan="5" class="dim">Labor only</td></tr>'}</tbody>
      </table>
      <div class="box" style="background:#f5f7fa;border-radius:6px;padding:6px 12px;font-size:12px;margin-top:4px;color:${accent};font-weight:600">
        Labor (${clockHrs}h × ${crewSize} crew = ${sectionHrs.toFixed(1)} man-hrs @ $${rate}/hr): $${sectionLabor.toFixed(2)}
        &nbsp;·&nbsp; Material: $${sectionMat.toFixed(2)}
        &nbsp;·&nbsp; <b>Section Total: $${(sectionLabor + sectionMat).toFixed(2)}</b>
      </div>
    </div>`;
  });

  // Subtotal before markup/tax
  const subtotal = totalLabor + totalMat;

  // Build the licensed-pro exclusion line dynamically. The boilerplate
  // ("electrical panel work, major HVAC, gas lines are NOT included") read
  // wrong on quotes that DID include some of that scope, so list only the
  // categories we don't see in the line items. If everything's covered, drop
  // the bullet entirely.
  const scopeText = categories
    .flatMap((c) =>
      c.items.flatMap((it) => [
        it.detail || "",
        it.comment || "",
        ...(it.materials || []).map((m) => m.n || ""),
      ]),
    )
    .join(" ")
    .toLowerCase();
  const includesPanel = /breaker (panel|box)|electrical panel|sub.?panel|service upgrade|main panel|amperage upgrade|meter base/.test(scopeText);
  const includesHvac = /furnace|condenser|heat pump|mini.?split|evaporator|air handler|new ductwork|ductwork install|hvac (replace|install|new|unit)/.test(scopeText);
  const includesGas = /gas line|gas pipe|gas valve|gas connection|propane line|natural gas/.test(scopeText);
  const excluded: string[] = [];
  if (!includesPanel) excluded.push("electrical panel work");
  if (!includesHvac) excluded.push("major HVAC");
  if (!includesGas) excluded.push("gas lines");
  const licensedDisclaimer = excluded.length
    ? `<li>Items requiring licensed professionals (${excluded.join(", ")}) are NOT included unless noted.</li>`
    : "";

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

${tiersHtml}

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
    ${minRow ? `<tr style="color:#666;font-style:italic"><td>Minimum service charge</td><td class="r">${minRow.hrs.toFixed(1)}</td><td class="r">$${minRow.labor.toFixed(2)}</td><td class="r">—</td><td class="r">$${minRow.labor.toFixed(2)}</td></tr>` : ""}
    <tr style="font-weight:700;background:#f0f4f8;border-top:2px solid ${accent};color:${accent}">
      <td>${showTiers ? "ALL QUOTED WORK (reference)" : "SUBTOTAL"}</td>
      <td class="r">${totalHrs.toFixed(1)}</td>
      <td class="r">$${totalLabor.toFixed(2)}</td>
      <td class="r">$${totalMat.toFixed(2)}</td>
      <td class="r">$${subtotal.toFixed(2)}</td>
    </tr>
  </tbody>
</table>

${(markupPct > 0 || taxPct > 0 || tripFee > 0 || discount) ? `
<table style="width:auto;margin-left:auto;font-size:12px;margin-bottom:14px">
  ${markupPct > 0 ? `<tr><td class="dim">Material Markup (${markupPct}%)</td><td class="r" style="padding-left:24px">Included in materials</td></tr>` : ""}
  ${tripFee > 0 ? `<tr><td class="dim">Trip Fee</td><td class="r" style="padding-left:24px">$${tripFee.toFixed(2)}</td></tr>` : ""}
  ${discount ? `<tr style="color:#C00000"><td>${esc(discountLabel)}</td><td class="r" style="padding-left:24px">-$${discountAmount.toFixed(2)}</td></tr>` : ""}
  ${taxPct > 0 && taxMode !== "none" ? `<tr><td class="dim">${esc(taxLabel)}</td><td class="r" style="padding-left:24px">$${taxAmount.toFixed(2)}</td></tr>` : ""}
  <tr style="font-weight:700;font-size:16px;color:${accent};font-family:Oswald,sans-serif">
    <td>${showTiers ? "OPTIONS" : "GRAND TOTAL"}</td>
    <td class="r" style="padding-left:24px">${showTiers ? tierRange : `$${grandTotal.toFixed(2)}`}</td>
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
        `<div style="text-align:center"><img src="${esc(p.url)}" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:6px;border:1px solid #ddd" /></div>`,
    )
    .join("")}
</div>
` : ""}

${renders.length > 0 ? `
<h2>Proposed Finish</h2>
<div style="font-size:12px;color:#666;margin-bottom:8px">AI preview of the completed work, generated from this estimate's scope.</div>
${renders
  .map(
    (r) => `
<div style="display:grid;grid-template-columns:${r.sourceUrl ? "1fr 1fr" : "1fr"};gap:8px;margin-bottom:12px;page-break-inside:avoid">
  ${r.sourceUrl ? `<div style="text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:3px">Now</div><img src="${esc(r.sourceUrl)}" alt="" style="width:100%;height:170px;object-fit:cover;border-radius:6px;border:1px solid #ddd" /></div>` : ""}
  <div style="text-align:center"><div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:${accent};margin-bottom:3px">Done</div><img src="${esc(r.url)}" alt="" style="width:100%;height:170px;object-fit:cover;border-radius:6px;border:1px solid ${accent}" /></div>
</div>`,
  )
  .join("")}
` : ""}

<h2>Notes &amp; Exclusions</h2>
<div style="font-size:12px;color:#444;line-height:1.8">
  <ul style="padding-left:20px">
    <li>Labor rate: <b>$${rate}.00/man-hour</b>. Man-hours = clock hours × crew size (2-man crew tasks billed at 2× clock time).</li>
    ${minRow ? `<li><b>Minimum service charge applied — ${minLaborHours} hr min.</b> Actual labor on this scope is ${rawTotalHrs.toFixed(2)} hr; quotes never bill less than ${minLaborHours} hr to cover trip time and overhead.</li>` : ""}
    <li>Materials priced at current Home Depot/Lowe's retail. All material quantities and unit prices listed per line item above.</li>
    <li>Quote valid <b>${validDays} days</b> from issue date.${depositPct > 0 ? ` <b>${depositPct}% deposit</b> to begin; balance due on completion.` : " Payment due on completion."}</li>
    <li>Any unforeseen conditions (mold, hidden water damage, structural issues) will be documented and quoted as a separate change order before proceeding.</li>
    ${licensedDisclaimer}
    ${quoteTerms ? quoteTerms.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean).map((l) => `<li>${esc(l)}</li>`).join("") : ""}
  </ul>
</div>

<section style="background:linear-gradient(135deg,#f0f4f8 0%,#e8eef5 100%);border:2px solid ${accent};border-radius:12px;padding:20px 24px;margin-top:22px;text-align:center;page-break-inside:avoid">
  <h3 style="font-family:Oswald,sans-serif;font-size:16px;color:${accent};text-transform:uppercase;margin:0 0 8px;letter-spacing:.08em">${showTiers ? "Choose Your Option" : "Accept This Estimate"}</h3>
  <div style="font-family:Oswald,sans-serif;font-size:32px;font-weight:700;color:${accent};margin:8px 0">${showTiers ? tierRange : `$${grandTotal.toFixed(2)}`}</div>
  <div style="font-size:12px;color:#444;line-height:1.9">
    ${statusUrl ? `<div>🔗 <b>View &amp; approve online:</b> <a href="${esc(statusUrl)}" style="color:${accent}">${esc(statusUrl)}</a></div>` : ""}
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
      accent,
      accent2,
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
