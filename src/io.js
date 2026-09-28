/* ---------- poke~pcb: file readers (zip, xlsx, csv, text) ---------- */
const PokeIO = (() => {
  async function sliceBytes(blob, a, b) { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); }

  function decodeName(bytes, flags) {
    if (flags & 0x800) return new TextDecoder("utf-8").decode(bytes);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (e) { try { return new TextDecoder("gbk").decode(bytes); } catch (e2) { return new TextDecoder("latin1").decode(bytes); } }
  }

  async function openZip(blob) {
    const size = blob.size;
    const tailLen = Math.min(size, 65536 + 22);
    const tail = await sliceBytes(blob, size - tailLen, size);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This file isn't a readable zip archive.");
    const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdOff = dv.getUint32(eocd + 16, true);
    if (cdOff === 0xffffffff || count === 0xffff || cdSize === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && dv.getUint32(loc, true) === 0x07064b50) {
        const z64 = Number(dv.getBigUint64(loc + 8, true));
        const z = await sliceBytes(blob, z64, z64 + 56), zd = new DataView(z.buffer);
        count = Number(zd.getBigUint64(32, true)); cdSize = Number(zd.getBigUint64(40, true)); cdOff = Number(zd.getBigUint64(48, true));
      }
    }
    const cd = await sliceBytes(blob, cdOff, cdOff + cdSize), cv = new DataView(cd.buffer);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cv.getUint32(p, true) !== 0x02014b50) break;
      const flags = cv.getUint16(p + 8, true), method = cv.getUint16(p + 10, true);
      let csize = cv.getUint32(p + 20, true), usize = cv.getUint32(p + 24, true);
      const nlen = cv.getUint16(p + 28, true), xlen = cv.getUint16(p + 30, true), clen = cv.getUint16(p + 32, true);
      let off = cv.getUint32(p + 42, true);
      if (csize === 0xffffffff || usize === 0xffffffff || off === 0xffffffff) {
        let q = p + 46 + nlen; const qe = q + xlen;
        while (q + 4 <= qe) {
          const id = cv.getUint16(q, true), sz = cv.getUint16(q + 2, true);
          if (id === 1) {
            let r = q + 4;
            if (usize === 0xffffffff) { usize = Number(cv.getBigUint64(r, true)); r += 8; }
            if (csize === 0xffffffff) { csize = Number(cv.getBigUint64(r, true)); r += 8; }
            if (off === 0xffffffff) { off = Number(cv.getBigUint64(r, true)); r += 8; }
          }
          q += 4 + sz;
        }
      }
      const name = decodeName(cd.subarray(p + 46, p + 46 + nlen), flags).replace(/\\/g, "/");
      entries.push({ name, method, csize, usize, off, dir: name.endsWith("/") });
      p += 46 + nlen + xlen + clen;
    }
    async function read(e) {
      const lh = await sliceBytes(blob, e.off, e.off + 30);
      const lv = new DataView(lh.buffer);
      if (lv.getUint32(0, true) !== 0x04034b50) throw new Error("Damaged zip entry: " + e.name);
      const start = e.off + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
      const data = blob.slice(start, start + e.csize);
      if (e.method === 0) return new Uint8Array(await data.arrayBuffer());
      if (e.method === 8) {
        if (typeof DecompressionStream === "undefined") throw new Error("This browser can't unzip files. Try a current Chrome, Edge, Firefox or Safari.");
        const ds = data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(ds).arrayBuffer());
      }
      throw new Error(`Unsupported zip compression (method ${e.method}) in ${e.name}`);
    }
    return { entries: entries.filter(e => !e.dir), read };
  }

  function decodeText(bytes, hint) {
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
    // UTF-16LE without BOM (EasyEDA sometimes): many zero bytes at odd positions
    if (bytes.length > 8) {
      let z = 0; for (let i = 1; i < Math.min(bytes.length, 400); i += 2) if (bytes[i] === 0) z++;
      if (z > Math.min(bytes.length, 400) / 2 * 0.8) return new TextDecoder("utf-16le").decode(bytes);
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (e) {
      try { return new TextDecoder(hint === "gbk" ? "gbk" : "windows-1252").decode(bytes); }
      catch (e2) { return new TextDecoder("latin1").decode(bytes); }
    }
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).slice(0, 12).join("\n");
    const cands = [",", ";", "\t", "|"];
    let delim = ",", best = -1;
    for (const d of cands) {
      const n = lines.split("\n").map(l => l.split(d).length - 1);
      const score = n.reduce((a, b) => a + b, 0);
      if (score > best) { best = score; delim = d; }
    }
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell.trim() === "") { q = true; cell = ""; }
      else if (c === delim) { row.push(cell.trim()); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell.trim()); cell = "";
        if (row.some(v => v !== "")) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell.trim());
    if (row.some(v => v !== "")) rows.push(row);
    return rows;
  }

  function xmlUnescape(s) {
    return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&");
  }
  async function parseXLSX(bytes) {
    const z = await openZip(new Blob([bytes]));
    const find = n => z.entries.find(e => e.name.toLowerCase() === n.toLowerCase());
    const get = async n => { const e = find(n); return e ? new TextDecoder("utf-8").decode(await z.read(e)) : null; };
    const wb = await get("xl/workbook.xml");
    if (!wb) throw new Error("This .xlsx has no workbook inside.");
    const rels = (await get("xl/_rels/workbook.xml.rels")) || "";
    const sheetTag = wb.match(/<(?:\w+:)?sheet\b[^>]*>/);
    let target = "xl/worksheets/sheet1.xml";
    if (sheetTag) {
      const rid = (sheetTag[0].match(/r:id="([^"]+)"/) || [])[1];
      if (rid) {
        const rel = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`));
        const t = rel && (rel[0].match(/Target="([^"]+)"/) || [])[1];
        if (t) target = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, "");
      }
    }
    const ssXml = (await get("xl/sharedStrings.xml")) || "";
    const shared = [];
    ssXml.replace(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g, (m, inner) => {
      let s = ""; inner.replace(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g, (m2, t) => { s += t; return ""; });
      shared.push(xmlUnescape(s)); return "";
    });
    const sheet = await get(target);
    if (!sheet) throw new Error("Couldn't find the first sheet in this .xlsx.");
    const rows = [];
    const colIdx = ref => { const L = ref.replace(/\d+/g, ""); let n = 0; for (const ch of L) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
    sheet.replace(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g, (m, inner) => {
      const row = [];
      inner.replace(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g, (m2, attrs, body) => {
        const r = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
        const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
        let v = "";
        if (body) {
          if (t === "inlineStr") { body.replace(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g, (m3, s) => { v += xmlUnescape(s); return ""; }); }
          else {
            const vv = (body.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/) || [])[1];
            if (vv !== undefined) v = t === "s" ? (shared[+vv] || "") : xmlUnescape(vv);
          }
        }
        const ci = r ? colIdx(r) : row.length;
        row[ci] = String(v).trim();
        return "";
      });
      for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
      if (row.some(x => x !== "")) rows.push(row);
      return "";
    });
    return rows;
  }

  return { openZip, decodeText, parseCSV, parseXLSX };
})();
if (typeof module !== "undefined") module.exports = PokeIO;
