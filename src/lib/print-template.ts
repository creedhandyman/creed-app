/**
 * Shared print/PDF template — every customer-facing or admin-print
 * document (quotes, invoices, pay stubs, job reports, schedules,
 * inspections) renders through these helpers so the logo, brand
 * colors, header layout, and footer are identical across outputs.
 */

export interface PrintBrand {
  orgName: string;
  orgPhone?: string;
  orgEmail?: string;
  orgAddress?: string;
  orgLicense?: string;
  orgLogo?: string;
  /** Optional accent color override; defaults to brand blue */
  accent?: string;
  /** Document title shown in the header right column (e.g. "INVOICE") */
  docTitle: string;
  /** Document number / id (e.g. "INV-A1B2C3") */
  docNumber?: string;
  /** Date string for header */
  docDate?: string;
  /** Optional secondary line under doc title (e.g. property address) */
  docSubtitle?: string;
}

const ACCENT = "#2E75B6";
const ACCENT_DARK = "#1f5d94";

/**
 * Returns the shared <style> CSS as a string. Caller sticks it inside
 * the document <head>.
 */
export function printStyles(brand?: { accent?: string }): string {
  const accent = brand?.accent || ACCENT;
  return `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600;700&display=swap');
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Source Sans 3', sans-serif;
  color: #1a1a2a;
  font-size: 13px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  background: #fff;
}
.page { max-width: 800px; margin: 0 auto; padding: 36px 44px; }

/* Headings */
h1 {
  font-family: Oswald, sans-serif;
  font-size: 26px;
  color: ${accent};
  text-transform: uppercase;
  letter-spacing: .04em;
  font-weight: 600;
  line-height: 1.1;
}
h2 {
  font-family: Oswald, sans-serif;
  font-size: 15px;
  color: ${accent};
  text-transform: uppercase;
  letter-spacing: .06em;
  font-weight: 600;
  margin: 22px 0 8px;
  border-bottom: 2px solid ${accent};
  padding-bottom: 5px;
}
h3 {
  font-family: Oswald, sans-serif;
  font-size: 13px;
  color: #444;
  text-transform: uppercase;
  letter-spacing: .06em;
  margin: 14px 0 6px;
}
h4 {
  font-family: Oswald, sans-serif;
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: .1em;
}

/* Header */
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 3px solid ${accent};
}
.head .brand {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
  min-width: 0;
}
.head .logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
  border-radius: 8px;
  background: #fff;
  flex-shrink: 0;
}
.head .brand-text { min-width: 0; }
.head .brand-text h1 { line-height: 1; margin-bottom: 6px; }
.head .info {
  font-size: 11.5px;
  color: #555;
  line-height: 1.6;
}
.head .info .info-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head .doc {
  text-align: right;
  flex-shrink: 0;
}
.head .doc-title {
  font-family: Oswald, sans-serif;
  font-size: 18px;
  color: ${accent};
  text-transform: uppercase;
  letter-spacing: .12em;
  font-weight: 600;
}
.head .doc-num {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 11px;
  color: #888;
  margin-top: 2px;
  letter-spacing: .04em;
}
.head .doc-date {
  font-family: 'Source Sans 3', sans-serif;
  font-size: 11px;
  color: #888;
  margin-top: 1px;
}
.head .doc-sub {
  font-size: 11px;
  color: #555;
  margin-top: 4px;
  max-width: 260px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Tables */
table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 12px;
  font-size: 12px;
}
th {
  font-family: Oswald, sans-serif;
  text-transform: uppercase;
  font-size: 10.5px;
  letter-spacing: .08em;
  color: #fff;
  background: ${accent};
  padding: 8px 10px;
  text-align: left;
  font-weight: 500;
}
td {
  padding: 7px 10px;
  border-bottom: 1px solid #e8e8e8;
  vertical-align: top;
}
tr:nth-child(even) td { background: #fafbfd; }
.r { text-align: right; }
.dim { color: #888; }
.muted { color: #6a6a7a; }

/* Cards / boxes */
.box {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 12px 14px;
}
.box .label {
  font-family: Oswald, sans-serif;
  font-size: 10.5px;
  text-transform: uppercase;
  color: #888;
  letter-spacing: .1em;
}
.box .value {
  font-size: 13.5px;
  font-weight: 600;
  margin-top: 3px;
}
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }

/* Status / accent strips */
.accent-stripe {
  height: 4px;
  background: linear-gradient(90deg, ${accent}, ${ACCENT_DARK});
  border-radius: 2px;
  margin-bottom: 14px;
}
.tape {
  height: 4px;
  background: repeating-linear-gradient(
    -45deg, #ffcc00, #ffcc00 5px, #1a1a1a 5px, #1a1a1a 10px
  );
  border-radius: 1px;
  margin: 18px 0;
  opacity: .7;
}

/* Footer */
.foot {
  border-top: 1px solid #ddd;
  padding-top: 10px;
  margin-top: 28px;
  font-size: 10px;
  color: #888;
  text-align: center;
  letter-spacing: .04em;
}
.foot .brand-mark {
  font-family: Oswald, sans-serif;
  color: ${accent};
  letter-spacing: .12em;
}

/* Signatures */
.sig-row { display: flex; gap: 36px; margin-top: 24px; }
.sig-line {
  flex: 1;
  border-top: 1px solid #999;
  padding-top: 6px;
  text-align: center;
  font-size: 11px;
  color: #666;
}

/* Print */
@media print {
  body { background: #fff; }
  .page { padding: 18mm 16mm; max-width: 100%; }
  h2 { break-after: avoid; }
  table, .box, .head { break-inside: avoid; }
  tr { break-inside: avoid; }
}
`;
}

/**
 * Renders the standard header — logo + brand info on the left,
 * doc title + number + date on the right, accent stripe below.
 */
export function printHeader(brand: PrintBrand): string {
  const {
    orgName,
    orgPhone,
    orgEmail,
    orgAddress,
    orgLicense,
    orgLogo,
    docTitle,
    docNumber,
    docDate,
    docSubtitle,
  } = brand;

  const logoHtml = orgLogo
    ? `<img src="${escapeAttr(orgLogo)}" alt="" class="logo" onerror="this.style.display='none'" />`
    : "";

  const infoLines: string[] = [];
  if (orgPhone) infoLines.push(`<div class="info-line">☎ ${escape(orgPhone)}</div>`);
  if (orgEmail) infoLines.push(`<div class="info-line">✉ ${escape(orgEmail)}</div>`);
  if (orgAddress) infoLines.push(`<div class="info-line">${escape(orgAddress)}</div>`);
  if (orgLicense) infoLines.push(`<div class="info-line">License #${escape(orgLicense)}</div>`);

  return `
<header class="head">
  <div class="brand">
    ${logoHtml}
    <div class="brand-text">
      <h1>${escape(orgName)}</h1>
      <div class="info">${infoLines.join("")}</div>
    </div>
  </div>
  <div class="doc">
    <div class="doc-title">${escape(docTitle)}</div>
    ${docNumber ? `<div class="doc-num">${escape(docNumber)}</div>` : ""}
    ${docDate ? `<div class="doc-date">${escape(docDate)}</div>` : ""}
    ${docSubtitle ? `<div class="doc-sub">${escape(docSubtitle)}</div>` : ""}
  </div>
</header>
<div class="accent-stripe"></div>
`;
}

/**
 * Branded footer — small org line + Creed-App attribution mark.
 */
export function printFooter(brand: PrintBrand): string {
  const parts = [brand.orgName];
  if (brand.orgAddress) parts.push(brand.orgAddress);
  if (brand.orgPhone) parts.push(brand.orgPhone);
  if (brand.orgLicense) parts.push("Lic #" + brand.orgLicense);
  return `
<footer class="foot">
  ${parts.map(escape).join(" &middot; ")}
  <div style="margin-top:4px"><span class="brand-mark">Creed App</span> &middot; ${escape(brand.docDate || "")}</div>
</footer>
`;
}

/**
 * Wraps a doc with full HTML5 boilerplate, the shared styles, and the
 * standard header + footer. Caller provides the body content.
 *
 * Includes a "print on full load" script so the browser doesn't fire
 * window.print() before remote images (logo, photos) finish loading —
 * the previous 600ms timeout was racing slow Supabase storage images
 * and printing a logo-less page.
 */
export function wrapPrint(brand: PrintBrand, bodyHtml: string): string {
  const title = `${brand.docTitle}${brand.docNumber ? " " + brand.docNumber : ""}${
    brand.docSubtitle ? " — " + brand.docSubtitle : ""
  }`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escape(title)}</title>
  <style>${printStyles({ accent: brand.accent })}</style>
</head>
<body>
  <div class="page">
    ${printHeader(brand)}
    ${bodyHtml}
    ${printFooter(brand)}
  </div>
  <script>
    // Wait for images (logo + photos) to load before printing. Falls
    // through after 6s if any image hangs so the user isn't stuck.
    (function () {
      var imgs = Array.prototype.slice.call(document.images || []);
      function ready(img) {
        return img.complete && img.naturalWidth > 0;
      }
      function fire() { try { window.focus(); window.print(); } catch (e) {} }
      if (imgs.length === 0) { setTimeout(fire, 200); return; }
      var done = 0;
      var fired = false;
      function check() {
        if (fired) return;
        done++;
        if (done >= imgs.length) { fired = true; setTimeout(fire, 150); }
      }
      imgs.forEach(function (img) {
        if (ready(img)) check();
        else { img.addEventListener("load", check); img.addEventListener("error", check); }
      });
      // Hard timeout so we never block forever
      setTimeout(function () { if (!fired) { fired = true; fire(); } }, 6000);
    })();
  </script>
</body>
</html>`;
}

/**
 * Open the rendered HTML in a new tab. The HTML's embedded script
 * triggers window.print() once all images have loaded.
 */
export function openPrint(html: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

// ── Tiny escape helpers — these run on user-supplied org data so HTML
//    injection isn't a paranoid concern but it's still cleaner to escape.
function escape(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escape(s).replace(/"/g, "&quot;");
}
