/**
 * One PDF that carries the whole layout to the homeowner's AI: the 3D picture
 * and the note on the first page, the layout file as text after it. Share
 * sheets in AI apps take a PDF when they drop other file types, and every AI
 * reads its text. Written by hand: standard fonts, one JPEG, no library.
 */

const PAGE = { w: 612, h: 792, margin: 36 };

export function layoutPdf({ title, note, json, jpeg }: { title: string; note: string[]; json: string; jpeg: { bytes: Uint8Array; width: number; height: number } | null }) {
  const pages: string[] = [];
  const usable = PAGE.w - PAGE.margin * 2;

  // First page: title, picture, note.
  let first = "";
  let y = PAGE.h - PAGE.margin - 16;
  first += text("F1", 16, PAGE.margin, y, title);
  y -= 14;
  if (jpeg) {
    const h = Math.min(usable * (jpeg.height / jpeg.width), 380);
    const w = h * (jpeg.width / jpeg.height);
    y -= h;
    first += `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${PAGE.margin} ${y.toFixed(2)} cm /Im1 Do Q\n`;
    y -= 22;
  }
  for (const paragraph of note) {
    for (const line of wrap(paragraph, 98)) {
      first += text("F1", 10, PAGE.margin, y, line);
      y -= 14;
    }
    y -= 8;
  }
  pages.push(first);

  // The layout file, in a fixed-width font so an AI can read it back exactly.
  const lines = json.split("\n").flatMap((l) => wrapJson(l, 118));
  const perPage = Math.floor((PAGE.h - PAGE.margin * 2) / 10);
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage).map((l, j) => text("F2", 7.5, PAGE.margin, PAGE.h - PAGE.margin - 8 - j * 10, l)).join(""));
  }

  // Objects: 1 catalog, 2 page tree, 3 and 4 fonts, 5 the picture, then a page and its content for each page.
  const objects: (string | Uint8Array[])[] = [];
  const kids = pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  objects.push(
    jpeg
      ? [
          bytes(`<< /Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.bytes.length} >>\nstream\n`),
          jpeg.bytes,
          bytes("\nendstream"),
        ]
      : "<< >>",
  );
  pages.forEach((content, i) => {
    const resources = `<< /Font << /F1 3 0 R /F2 4 0 R >>${jpeg && i === 0 ? " /XObject << /Im1 5 0 R >>" : ""} >>`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources ${resources} /Contents ${7 + i * 2} 0 R >>`);
    const stream = bytes(content);
    objects.push([bytes(`<< /Length ${stream.length} >>\nstream\n`), stream, bytes("\nendstream")]);
  });

  const chunks: Uint8Array[] = [bytes("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")];
  const offsets: number[] = [];
  let length = chunks[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const parts = [bytes(`${i + 1} 0 obj\n`), ...(typeof body === "string" ? [bytes(body)] : body), bytes("\nendobj\n")];
    for (const p of parts) {
      chunks.push(p);
      length += p.length;
    }
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(bytes(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

function text(font: string, size: number, x: number, y: number, value: string) {
  return `BT /${font} ${size} Tf ${x} ${y.toFixed(2)} Td (${escape(value)}) Tj ET\n`;
}

/** Breaks a long line of the layout between its fields, so the text still reads as valid JSON. */
function wrapJson(value: string, width: number): string[] {
  const out: string[] = [];
  const indent = value.match(/^ */)![0] + "  ";
  let rest = value;
  while (rest.length > width) {
    const at = rest.lastIndexOf(',"', width);
    if (at <= indent.length) break;
    out.push(rest.slice(0, at + 1));
    rest = indent + rest.slice(at + 1);
  }
  out.push(rest);
  return out;
}

/** Breaks text into lines between words. */
function wrap(value: string, width: number): string[] {
  if (value.length <= width) return [value];
  const out: string[] = [];
  let line = "";
  for (const word of value.split(" ")) {
    if (line && (line + " " + word).length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

/** PDF strings: escape the delimiters, and keep to characters the standard fonts have. */
const escape = (s: string) =>
  s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[\\()]/g, (c) => `\\${c}`);

/** Bytes for text that is plain ASCII once escaped; the header's marker bytes go in as they are. */
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
