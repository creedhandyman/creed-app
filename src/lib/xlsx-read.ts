/**
 * Minimal .xlsx reader for importing a material spec: the FIRST sheet's
 * cells as rows of strings. No dependency — an .xlsx file is a zip of XML,
 * and browsers inflate with DecompressionStream("deflate-raw").
 *
 * The XML parts (`sheetRows`, `sharedStrings`, `firstSheetPath`) are pure
 * and tested (src/__tests__/xlsx-read.test.ts); `readXlsx` does the zip I/O.
 * Formulas give their cached value; dates come through as Excel serial
 * numbers (fine for a product list). .xls (old binary) is not supported:
 * the import screen asks for .xlsx or CSV.
 */

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

/** Text of every <t> in a fragment (rich-text runs joined). */
const textOf = (xml: string) => {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += m[1] ? decodeEntities(m[1]) : "";
  return out;
};

/** xl/sharedStrings.xml → the string table. */
export function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml || ""))) out.push(m[1] ? textOf(m[1]) : "");
  return out;
}

/** "AB12" → 27 (zero-based column). */
export function columnIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/i)?.[0] || "A").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** A worksheet's XML → rows of cell strings (gaps filled with ""). */
export function sheetRows(xml: string, strings: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(xml || ""))) {
    const body = rm[1] || "";
    const row: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let next = 0;
    while ((cm = cellRe.exec(body))) {
      const attrs = cm[1] || "";
      const inner = cm[2] || "";
      const ref = attrs.match(/\br="([A-Z]+)\d*"/i)?.[1];
      const col = ref ? columnIndex(ref) : next;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = "";
      if (type === "s") val = strings[Number(v)] ?? "";
      else if (type === "inlineStr") val = textOf(inner.match(/<is>([\s\S]*?)<\/is>/)?.[1] || "");
      else if (type === "b") val = v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      else if (v !== undefined) val = decodeEntities(v);
      while (row.length < col) row.push("");
      row[col] = val.trim();
      next = col + 1;
    }
    if (row.some((c) => c)) rows.push(row);
  }
  return rows;
}

/** The first sheet's zip path, from workbook.xml + its rels. */
export function firstSheetPath(workbookXml: string, relsXml: string, names: string[]): string | null {
  const rid = workbookXml.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (rid) {
    const rel = new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*>`).exec(relsXml)?.[0];
    const target = rel?.match(/\bTarget="([^"]+)"/)?.[1];
    if (target) {
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      if (names.includes(path)) return path;
    }
  }
  const sheets = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return sheets[0] || null;
}

/* ── zip I/O (browser) ─────────────────────────────────────────────────── */

interface ZipEntry { name: string; method: number; compSize: number; offset: number }

function zipEntries(buf: ArrayBuffer): ZipEntry[] {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    // Some zip tools write Windows backslashes; Excel itself uses "/".
    const name = dec.decode(new Uint8Array(buf, p + 46, nameLen)).replace(/\\/g, "/");
    out.push({ name, method, compSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function entryText(buf: ArrayBuffer, e: ZipEntry): Promise<string> {
  const dv = new DataView(buf);
  const nameLen = dv.getUint16(e.offset + 26, true);
  const extraLen = dv.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = new Uint8Array(buf, start, e.compSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error("unsupported zip compression");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

/** First sheet of an .xlsx file as rows of strings. Throws on a file that
 *  isn't an .xlsx (the caller shows "save it as .xlsx or CSV"). */
export async function readXlsx(file: Blob): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const entries = zipEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = async (n: string) => { const e = byName.get(n); return e ? entryText(buf, e) : ""; };
  const sheet = firstSheetPath(await read("xl/workbook.xml"), await read("xl/_rels/workbook.xml.rels"), entries.map((e) => e.name));
  if (!sheet) throw new Error("no worksheet");
  return sheetRows(await read(sheet), sharedStrings(await read("xl/sharedStrings.xml")));
}
