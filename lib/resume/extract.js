/* Resume text extraction with zero dependencies.
   PDF: inflate FlateDecode content streams and read the text-showing
   operators (Tj / TJ / '). Handles the common resume exporters (Word,
   Google Docs, Canva-lite). CID-encoded fonts come out as garbage, so the
   result is quality-checked before it's trusted.
   DOCX: a .docx is a ZIP; walk the central directory, inflate
   word/document.xml, and strip the XML. */

import zlib from "node:zlib";

/* ---------------- PDF ---------------- */

function pdfObjects(raw) {
  const objects = [];
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = re.exec(raw))) {
    const bodyStart = re.lastIndex;
    const end = raw.indexOf("endobj", bodyStart);
    if (end === -1) break;
    objects.push({ id: m[1], bodyStart, end, body: raw.slice(bodyStart, end) });
    re.lastIndex = end + 6;
  }
  return objects;
}

function inflatePdfStream(obj, buf, raw) {
  const streamIdx = raw.indexOf("stream", obj.bodyStart);
  if (streamIdx === -1 || streamIdx > obj.end) return null;
  let start = streamIdx + "stream".length;
  if (raw[start] === "\r" && raw[start + 1] === "\n") start += 2;
  else if (raw[start] === "\n" || raw[start] === "\r") start += 1;
  const markerEnd = raw.indexOf("endstream", start);
  if (markerEnd === -1) return null;
  const lengthMatch = raw.slice(obj.bodyStart, streamIdx).match(/\/Length\s+(\d+)/);
  const end = lengthMatch ? Math.min(start + Number(lengthMatch[1]), markerEnd) : markerEnd;
  const slice = buf.subarray(start, end);
  if (/\/FlateDecode\b/.test(obj.body)) {
    try { return zlib.inflateSync(slice).toString("latin1"); }
    catch {
      try { return zlib.inflateRawSync(slice).toString("latin1"); }
      catch { return null; }
    }
  }
  return slice.toString("latin1");
}

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

function hexToUnicodeString(hex) {
  const clean = hex.replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const cp = parseInt(clean.slice(i, i + 4), 16);
    if (Number.isFinite(cp) && cp > 0) out += String.fromCodePoint(cp);
  }
  return out;
}

function parseCMap(text) {
  const map = new Map();
  const bfchar = /beginbfchar([\s\S]*?)endbfchar/g;
  let block;
  while ((block = bfchar.exec(text))) {
    const pair = /<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = pair.exec(block[1]))) map.set(m[1].toUpperCase(), hexToUnicodeString(m[2]));
  }
  const bfrange = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = bfrange.exec(text))) {
    for (const line of block[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      let m = line.match(/^<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>/);
      if (m) {
        const [from, to, dst] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
        const width = m[1].length;
        for (let code = from; code <= to; code++) {
          map.set(code.toString(16).toUpperCase().padStart(width, "0"), String.fromCodePoint(dst + (code - from)));
        }
        continue;
      }
      m = line.match(/^<([0-9A-Fa-f]+)>\s+<([0-9A-Fa-f]+)>\s+\[(.+)\]/);
      if (m) {
        const from = parseInt(m[1], 16);
        const width = m[1].length;
        [...m[3].matchAll(/<([0-9A-Fa-f]+)>/g)]
          .forEach((value, i) => map.set((from + i).toString(16).toUpperCase().padStart(width, "0"), hexToUnicodeString(value[1])));
      }
    }
  }
  return map;
}

function buildPdfFontMaps(objects, buf, raw) {
  const objectById = new Map(objects.map((obj) => [obj.id, obj]));
  const unicodeByObject = new Map();
  for (const obj of objects) {
    const cmapRef = obj.body.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    if (!cmapRef) continue;
    const cmapObj = objectById.get(cmapRef[1]);
    const cmap = cmapObj ? inflatePdfStream(cmapObj, buf, raw) : "";
    if (cmap) unicodeByObject.set(obj.id, parseCMap(cmap));
  }
  const fonts = new Map();
  const fontRef = /\/([A-Za-z][A-Za-z0-9_.-]*)\s+(\d+)\s+\d+\s+R/g;
  let m;
  while ((m = fontRef.exec(raw))) {
    const cmap = unicodeByObject.get(m[2]);
    if (cmap?.size) fonts.set(m[1], cmap);
  }
  return fonts;
}

function decodePdfHexString(hex, cmap) {
  const clean = hex.replace(/\s+/g, "").toUpperCase();
  if (!clean) return "";
  const widths = cmap?.size
    ? [...new Set([...cmap.keys()].map((k) => k.length))].sort((a, b) => b - a)
    : [4, 2];
  let out = "";
  for (let i = 0; i < clean.length;) {
    let width = 0;
    for (const w of widths) {
      const key = clean.slice(i, i + w);
      if (key.length === w && cmap?.has(key)) {
        out += cmap.get(key);
        width = w;
        break;
      }
    }
    if (width) {
      i += width;
    } else if (clean.length - i >= 4) {
      const cp = parseInt(clean.slice(i, i + 4), 16);
      out += cp >= 32 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
      i += 4;
    } else {
      const cp = parseInt(clean.slice(i, i + 2), 16);
      out += cp >= 32 && cp <= 126 ? String.fromCharCode(cp) : "";
      i += 2;
    }
  }
  return out;
}

function decodePdfTextToken(token, cmap) {
  if (!token) return "";
  if (token[0] === "(") return decodePdfString(token.slice(1, -1));
  if (token[0] === "<") return decodePdfHexString(token.slice(1, -1), cmap);
  return "";
}

function textFromContentStream(stream, fontMaps = new Map()) {
  const fragments = [];
  const graphicsStack = [{ x: 0, y: 0 }];
  let graphics = graphicsStack[0];
  let currentFont = null;
  let tm = { x: 0, y: 0 };
  let td = { x: 0, y: 0 };
  const addText = (text) => {
    if (!text) return;
    fragments.push({ x: graphics.x + tm.x + td.x, y: graphics.y + tm.y + td.y, text, order: fragments.length });
  };

  const tokenRe = /q\b|Q\b|([-+]?\d*\.?\d+(?:\s+[-+]?\d*\.?\d+){5})\s+cm|\/([A-Za-z][A-Za-z0-9_.-]*)\s+[-+]?\d*\.?\d+\s+Tf|([-+]?\d*\.?\d+(?:\s+[-+]?\d*\.?\d+){5})\s+Tm|([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s+T[dD]|T\*|(<[0-9A-Fa-f\s]+>|\((?:[^()\\]|\\.)*\))\s*(?:Tj|')|\[((?:[^\[\]]|\\.)*)\]\s*TJ/g;
  let m;
  while ((m = tokenRe.exec(stream))) {
    const op = m[0];
    if (op === "q") {
      graphicsStack.push({ ...graphics });
      graphics = graphicsStack[graphicsStack.length - 1];
    } else if (op === "Q") {
      if (graphicsStack.length > 1) graphicsStack.pop();
      graphics = graphicsStack[graphicsStack.length - 1];
    } else if (m[1]) {
      const nums = m[1].trim().split(/\s+/).map(Number);
      graphics.x = nums[4] || 0;
      graphics.y = nums[5] || 0;
    } else if (m[2]) {
      currentFont = m[2];
    } else if (m[3]) {
      const nums = m[3].trim().split(/\s+/).map(Number);
      tm = { x: nums[4] || 0, y: nums[5] || 0 };
      td = { x: 0, y: 0 };
    } else if (m[4] !== undefined) {
      td.x += Number(m[4]) || 0;
      td.y += Number(m[5]) || 0;
    } else if (op === "T*") {
      td.x = 0;
      td.y += 12;
    } else if (m[6]) {
      addText(decodePdfTextToken(m[6], fontMaps.get(currentFont)));
    } else if (m[7] !== undefined) {
      addText([...m[7].matchAll(/<[0-9A-Fa-f\s]+>|\((?:[^()\\]|\\.)*\)/g)]
        .map((part) => decodePdfTextToken(part[0], fontMaps.get(currentFont)))
        .join(""));
    }
  }
  if (!fragments.length) return "";
  const lines = [];
  for (const frag of fragments) {
    let line = lines.find((l) => Math.abs(l.y - frag.y) <= 2.5);
    if (!line) {
      line = { y: frag.y, order: frag.order, parts: [] };
      lines.push(line);
    }
    line.parts.push(frag);
  }
  lines.sort((a, b) => a.order - b.order);
  return lines
    .map((line) => line.parts
      .sort((a, b) => a.x - b.x || a.order - b.order)
      .map((p) => p.text)
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .trim())
    .filter(Boolean)
    .join("\n");
}

export function extractPdfText(buf) {
  const raw = buf.toString("latin1");
  const objects = pdfObjects(raw);
  const fontMaps = buildPdfFontMaps(objects, buf, raw);
  const pieces = [];
  for (const obj of objects) {
    if (!/stream\b/.test(obj.body) || /\/Subtype\s*\/Image\b/.test(obj.body)) continue;
    const content = inflatePdfStream(obj, buf, raw);
    if (content && /\b(Tj|TJ)\b/.test(content)) pieces.push(textFromContentStream(content, fontMaps));
  }
  const text = cleanText(pieces.join("\n"));
  /* quality gate: CID/Identity-encoded fonts decode to binary noise */
  const printable = (text.match(/[\x20-\x7E\n]/g) || []).length;
  if (text.length < 80 || printable / Math.max(text.length, 1) < 0.85) return "";
  return text;
}

/* ---------------- DOCX (ZIP) ---------------- */

function docxXmlToText(xml) {
  return cleanText(
    xml
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tr>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&apos;|&#8217;/g, "'")
  );
}

export function extractDocxText(buf) {
  /* find end-of-central-directory, then walk entries for document/header/footer XML */
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return "";
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const pieces = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (/^word\/(?:document|header\d*|footer\d*)\.xml$/.test(name)) {
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(dataStart, dataStart + compSize);
      try {
        const xml = method === 8 ? zlib.inflateRawSync(data).toString("utf8") : data.toString("utf8");
        pieces.push(docxXmlToText(xml));
      } catch { /* keep walking other docx parts */ }
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return cleanText(pieces.join("\n\n"));
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
