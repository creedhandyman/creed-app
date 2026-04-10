import type { Room } from "./types";
import { calculateCost } from "./parser";

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

  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Build room rows
  let roomsHtml = "";
  rooms.forEach((rm) => {
    roomsHtml += `<tr class="room-header"><td colspan="5">${rm.name}</td></tr>`;
    rm.items.forEach((it) => {
      const { lc, mc, tot } = calculateCost(it, rate);
      roomsHtml += `
        <tr>
          <td class="item-detail">
            <strong>${it.detail}</strong>
            <div class="item-comment">${it.comment}</div>
          </td>
          <td class="num">${it.laborHrs}</td>
          <td class="num">$${lc.toFixed(0)}</td>
          <td class="num">$${mc.toFixed(0)}</td>
          <td class="num total-col">$${tot.toFixed(2)}</td>
        </tr>`;
    });
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Quote — ${property}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Source Sans 3', sans-serif; color: #1a1a2a; padding: 0; }

  .page { max-width: 800px; margin: 0 auto; padding: 40px; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #2E75B6; }
  .brand h1 { font-family: 'Oswald', sans-serif; font-size: 28px; color: #2E75B6; text-transform: uppercase; letter-spacing: .05em; }
  .brand .llc { font-family: 'Oswald', sans-serif; font-size: 12px; color: #C00000; letter-spacing: .15em; }
  .brand .info { font-size: 11px; color: #666; margin-top: 6px; line-height: 1.6; }
  .quote-label { text-align: right; }
  .quote-label h2 { font-family: 'Oswald', sans-serif; font-size: 22px; color: #2E75B6; text-transform: uppercase; }
  .quote-label .date { font-size: 12px; color: #666; margin-top: 4px; }

  /* Client block */
  .client-block { display: flex; justify-content: space-between; margin-bottom: 24px; gap: 20px; }
  .client-box { flex: 1; background: #f5f7fa; border-radius: 8px; padding: 14px 18px; }
  .client-box .label { font-family: 'Oswald', sans-serif; font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: .1em; margin-bottom: 4px; }
  .client-box .value { font-size: 14px; font-weight: 600; }

  /* Table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px; }
  th { font-family: 'Oswald', sans-serif; text-transform: uppercase; font-size: 10px; letter-spacing: .08em; color: #fff; background: #2E75B6; padding: 8px 10px; text-align: left; }
  th.num { text-align: right; }
  td { padding: 6px 10px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.num { text-align: right; font-family: 'Oswald', sans-serif; }
  td.total-col { font-weight: 600; color: #2E75B6; }
  .room-header td { font-family: 'Oswald', sans-serif; font-size: 13px; font-weight: 600; color: #2E75B6; background: #f0f4f8; padding: 8px 10px; text-transform: uppercase; letter-spacing: .04em; }
  .item-detail { max-width: 320px; }
  .item-comment { font-size: 11px; color: #888; margin-top: 2px; }

  /* Totals */
  .totals { display: flex; justify-content: flex-end; margin-bottom: 30px; }
  .totals-box { background: #f5f7fa; border-radius: 8px; padding: 16px 24px; min-width: 260px; }
  .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
  .totals-row.grand { border-top: 2px solid #2E75B6; margin-top: 8px; padding-top: 10px; font-size: 18px; font-family: 'Oswald', sans-serif; font-weight: 700; color: #2E75B6; }

  /* Footer */
  .footer { border-top: 1px solid #ddd; padding-top: 16px; text-align: center; font-size: 10px; color: #888; }
  .footer .sig { margin-top: 30px; display: flex; justify-content: space-between; gap: 40px; }
  .footer .sig-line { flex: 1; border-top: 1px solid #999; padding-top: 6px; text-align: center; font-size: 11px; color: #666; }

  @media print {
    body { padding: 0; }
    .page { padding: 20px; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="brand">
      <h1>Creed Handyman</h1>
      <div class="llc">LLC</div>
      <div class="info">
        Wichita, KS<br/>
        (316) 252-6335<br/>
        License #8145054
      </div>
    </div>
    <div class="quote-label">
      <h2>Quote</h2>
      <div class="date">${today}</div>
    </div>
  </div>

  <!-- Client info -->
  <div class="client-block">
    <div class="client-box">
      <div class="label">Property</div>
      <div class="value">${property || "—"}</div>
    </div>
    <div class="client-box">
      <div class="label">Client</div>
      <div class="value">${client || "—"}</div>
    </div>
    <div class="client-box">
      <div class="label">Est. Duration</div>
      <div class="value">${totalHrs.toFixed(1)} hrs (${(totalHrs / 8).toFixed(1)} days)</div>
    </div>
  </div>

  <!-- Items table -->
  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num">Hours</th>
        <th class="num">Labor</th>
        <th class="num">Materials</th>
        <th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${roomsHtml}
    </tbody>
  </table>

  <!-- Totals -->
  <div class="totals">
    <div class="totals-box">
      <div class="totals-row"><span>Labor (${totalHrs.toFixed(1)} hrs × $${rate}/hr)</span><span>$${totalLabor.toFixed(2)}</span></div>
      <div class="totals-row"><span>Materials</span><span>$${totalMat.toFixed(2)}</span></div>
      <div class="totals-row grand"><span>Total</span><span>$${grandTotal.toFixed(2)}</span></div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer">
    <p>This quote is valid for 30 days from the date above. Prices may vary based on actual conditions found during work.</p>

    <div class="sig">
      <div class="sig-line">Client Signature / Date</div>
      <div class="sig-line">Creed Handyman LLC / Date</div>
    </div>

    <p style="margin-top: 20px;">Creed Handyman LLC · Wichita, KS · (316) 252-6335 · Lic #8145054</p>
  </div>

</div>
</body>
</html>`;

  // Open in new window and trigger print
  const win = window.open("", "_blank");
  if (!win) {
    alert("Please allow popups to export PDF");
    return;
  }
  win.document.write(html);
  win.document.close();
  // Let fonts load before printing
  setTimeout(() => win.print(), 600);
}
