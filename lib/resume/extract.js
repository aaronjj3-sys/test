/* Resume text extraction with zero dependencies.
   PDF: inflate FlateDecode content streams and read the text-showing
   operators (Tj / TJ / '). Handles the common resume exporters (Word,
   Google Docs, Canva-lite). CID-encoded fonts come out as garbage, so the
   result is quality-checked before it's trusted.
   DOCX: a .docx is a ZIP; walk the central directory, inflate
   word/document.xml, and strip the XML. */

import zlib from "node:zlib";

/* ---------------- PDF ---------------- */

function decodePdfString(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out += c; continue; }
    const n = s[++i];
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "b" || n === "f") out += " ";
    else if (n >= "0" && n <= "7") {
      let oct = n;
      while (oct.length < 3 && s[i + 1] >= "0" && s[i + 1] <= "7") oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += n; /* \\ \( \) and escaped newline */
  }
  return out;
}

function textFromContentStream(stream) {
  const out = [];
  /* (string) Tj | (string) ' | [array] TJ — with positioning ops as separators */
  const re = /\((?:[^()\\]|\\.)*\)\s*(Tj|')|\[((?:[^\[\]\\]|\\.)*)\]\s*TJ|(T\*|TD|Td|TL|BT|ET)/g;
  let m;
  while ((m = re.exec(stream))) {
    if (m[3]) { /* positioning operator → line-ish break */
      if (m[3] !== "TL") out.push("\n");
    } else if (m[2] !== undefined) {
      const inner = /\((?:[^()\\]|\\.)*\)/g;
      let s;
      while ((s = inner.exec(m[2]))) out.push(decodePdfString(s[0].slice(1, -1)));
      out.push(" ");
    } else {
      const lit = m[0].slice(0, m[0].lastIndexOf(")") + 1);
      out.push(decodePdfString(lit.slice(1, -1)), " ");
    }
  }
  return out.join("");
}

export function extractPdfText(buf) {
  const raw = buf.toString("latin1");
  const pieces = [];
  const streamRe = /stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;
    const slice = buf.subarray(start, end);
    let content = null;
    try { content = zlib.inflateSync(slice).toString("latin1"); }
    catch {
      /* not Flate (or not compressed) — use it raw if it looks like a content stream */
      const s = slice.toString("latin1");
      if (/\b(Tj|TJ|BT)\b/.test(s)) content = s;
    }
    if (content && /\b(Tj|TJ)\b/.test(content)) pieces.push(textFromContentStream(content));
    streamRe.lastIndex = end;
  }
  const text = cleanText(pieces.join("\n"));
  /* quality gate: CID/Identity-encoded fonts decode to binary noise */
  const printable = (text.match(/[\x20-\x7E\n]/g) || []).length;
  if (text.length < 80 || printable / Math.max(text.length, 1) < 0.85) return "";
  return text;
}

/* ---------------- DOCX (ZIP) ---------------- */

export function extractDocxText(buf) {
  /* find end-of-central-directory, then walk entries for word/document.xml */
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return "";
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (name === "word/document.xml") {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      try {
        const xml = method === 8 ? zlib.inflateRawSync(data).toString("utf8") : data.toString("utf8");
        return cleanText(
          xml
            .replace(/<w:tab[^>]*\/>/g, "\t")
            .replace(/<\/w:p>/g, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&apos;|&#8217;/g, "'")
        );
      } catch { return ""; }
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return "";
}

function cleanText(t) {
  return t
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Main entry: fileName + Buffer → plain text ("" when unreadable). */
export function extractText(fileName, buf) {
  const ext = (fileName || "").toLowerCase().split(".").pop();
  if (ext === "pdf" || buf.subarray(0, 5).toString() === "%PDF-") return extractPdfText(buf);
  if (ext === "docx" || (buf[0] === 0x50 && buf[1] === 0x4b)) return extractDocxText(buf);
  return cleanText(buf.toString("utf8"));
}
