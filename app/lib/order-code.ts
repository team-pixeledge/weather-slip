// Scannable order number on the slip: a QR code or a Code 128 barcode, as
// inline SVG (the print page's CSP allows no image hosts and no style=""
// attributes — sizes come from CSS classes). Pure: the preview uses it too.
import makeQr from "qrcode-generator";

/**
 * "qr" opens the customer's order status page (what they ordered, tracking)
 * — user decision 2026-10-15; "barcode" carries the order number for
 * warehouse scanners. (An order-number QR was removed 2026-10-16; saved
 * designs that chose it print the barcode — see sanitizeDesign.)
 */
export type OrderCodeKind = "none" | "qr" | "barcode";

/** QR code for `text` as one SVG path (dark modules), 4-module quiet zone. */
export function qrSvg(text: string): string {
  // A link is long: level L keeps its modules big enough to scan off paper.
  const link = /^https:\/\//.test(text);
  const qr = makeQr(0, link ? "L" : "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const q = 4;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
    }
  }
  const size = n + q * 2;
  return `<svg class="ocode qr${link ? " link" : ""}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code ${escapeAttr(text)}"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Code 128 bar/space widths for values 0–105, then STOP (106).
export const CODE128_PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
const START_B = 104;
const STOP = 106;

/** Code 128 (set B) symbol values incl. start, checksum and stop; null if not printable ASCII. */
export function code128Values(text: string): number[] | null {
  if (!text || text.length > 40 || !/^[\x20-\x7e]+$/.test(text)) return null;
  const data = [...text].map((ch) => ch.charCodeAt(0) - 32);
  const check = data.reduce((sum, v, i) => sum + v * (i + 1), START_B) % 103;
  return [START_B, ...data, check, STOP];
}

/** Code 128 barcode for `text`, or "" if it can't be encoded. */
export function barcodeSvg(text: string): string {
  const values = code128Values(text);
  if (!values) return "";
  const quiet = 10;
  let x = quiet;
  let d = "";
  for (const v of values) {
    const widths = CODE128_PATTERNS[v]!;
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]);
      if (i % 2 === 0) d += `M${x} 0h${w}v40h-${w}z`; // bars on even positions
      x += w;
    }
  }
  const width = x + quiet;
  return `<svg class="ocode bc" viewBox="0 0 ${width} 40" preserveAspectRatio="none" shape-rendering="crispEdges" role="img" aria-label="Barcode ${escapeAttr(text)}"><rect width="${width}" height="40" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** The chosen code for an order number ("" for none). */
export function orderCodeSvg(kind: OrderCodeKind, orderName: string, statusPageUrl?: string | null): string {
  // Only Shopify's own https link; otherwise fall back to the order number.
  if (kind === "qr") return qrSvg(statusPageUrl && /^https:\/\//.test(statusPageUrl) ? statusPageUrl : orderName);
  if (kind === "barcode") return barcodeSvg(orderName);
  return "";
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
