/* ---------- poke~pcb: Gerber + Excellon parsing ---------- */
const PokeGerber = (() => {
  const f3 = v => { const s = (Math.round(v * 1000) / 1000).toString(); return s === "-0" ? "0" : s; };

  function circlePath(cx, cy, r, ccw = true) {
    const s = ccw ? 1 : 0;
    return `M${f3(cx + r)} ${f3(cy)}A${f3(r)} ${f3(r)} 0 1 ${s} ${f3(cx - r)} ${f3(cy)}A${f3(r)} ${f3(r)} 0 1 ${s} ${f3(cx + r)} ${f3(cy)}Z`;
  }
  function signedArea(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function polyPath(pts, ccw = true) {
    if (pts.length < 3) return "";
    const a = signedArea(pts);
    if ((a > 0) !== ccw) pts = pts.slice().reverse();
    return "M" + pts.map(p => `${f3(p[0])} ${f3(p[1])}`).join("L") + "Z";
  }
  function rot(p, deg) {
    if (!deg) return p;
    const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  }
  function bbGrow(bb, x, y) { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; }
  const newBB = () => [Infinity, Infinity, -Infinity, -Infinity];

  /* aperture macro arithmetic: + - x / ( ), $n */
  function evalExpr(src, vars) {
    const s = src.replace(/\s+/g, "");
    let i = 0;
    const peek = () => s[i];
    function num() {
      if (peek() === "$") { i++; let d = ""; while (/\d/.test(peek())) d += s[i++]; return vars[d] || 0; }
      if (peek() === "(") { i++; const v = add(); if (peek() === ")") i++; return v; }
      let t = ""; while (i < s.length && /[\d.]/.test(peek())) t += s[i++];
      return t ? parseFloat(t) : 0;
    }
    function unary() { if (peek() === "-") { i++; return -unary(); } if (peek() === "+") { i++; return unary(); } return num(); }
    function mul() { let v = unary(); while (peek() === "x" || peek() === "X" || peek() === "/") { const o = s[i++]; const r = unary(); v = o === "/" ? v / r : v * r; } return v; }
    function add() { let v = mul(); while (peek() === "+" || peek() === "-") { const o = s[i++]; const r = mul(); v = o === "+" ? v + r : v - r; } return v; }
    return add();
  }

  function macroShape(body, params, u, x, y) {
    const vars = {}; params.forEach((p, k) => vars[k + 1] = p);
    let d = ""; const bb = newBB();
    const put = (pts, on) => {
      const P = pts.map(p => [x + p[0] * u, y + p[1] * u]);
      P.forEach(p => bbGrow(bb, p[0], p[1]));
      d += polyPath(P, on);
    };
    for (let raw of body) {
      raw = raw.trim(); if (!raw) continue;
      const asg = raw.match(/^\$(\d+)\s*=\s*(.+)$/);
      if (asg) { vars[asg[1]] = evalExpr(asg[2], vars); continue; }
      const parts = raw.split(",");
      const code = parseInt(parts[0], 10);
      if (code === 0 || isNaN(code)) continue;
      const a = parts.slice(1).map(t => evalExpr(t, vars));
      if (code === 1) {
        const on = a[0] !== 0, r = a[1] / 2; const c = rot([a[2] || 0, a[3] || 0], a[4] || 0);
        const cx = x + c[0] * u, cy = y + c[1] * u, R = r * u;
        if (R > 0) { d += circlePath(cx, cy, R, on); bbGrow(bb, cx - R, cy - R); bbGrow(bb, cx + R, cy + R); }
      } else if (code === 20 || code === 2) {
        const on = a[0] !== 0, w = a[1], sx = a[2], sy = a[3], ex = a[4], ey = a[5], r = a[6] || 0;
        const L = Math.hypot(ex - sx, ey - sy) || 1e-9, nx = -(ey - sy) / L * w / 2, ny = (ex - sx) / L * w / 2;
        put([[sx + nx, sy + ny], [ex + nx, ey + ny], [ex - nx, ey - ny], [sx - nx, sy - ny]].map(p => rot(p, r)), on);
      } else if (code === 21) {
        const on = a[0] !== 0, w = a[1], h = a[2], cx = a[3], cy = a[4], r = a[5] || 0;
        put([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]].map(p => rot(p, r)), on);
      } else if (code === 22) {
        const on = a[0] !== 0, w = a[1], h = a[2], lx = a[3], ly = a[4], r = a[5] || 0;
        put([[lx, ly], [lx + w, ly], [lx + w, ly + h], [lx, ly + h]].map(p => rot(p, r)), on);
      } else if (code === 4) {
        const on = a[0] !== 0, n = Math.round(a[1]); const pts = [];
        for (let k = 0; k <= n; k++) pts.push([a[2 + 2 * k], a[3 + 2 * k]]);
        const r = a[2 + 2 * (n + 1)] || 0;
        if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
        put(pts.map(p => rot(p, r)), on);
      } else if (code === 5) {
        const on = a[0] !== 0, n = Math.max(3, Math.round(a[1])), cx = a[2], cy = a[3], R = a[4] / 2, r = a[5] || 0;
        const pts = []; for (let k = 0; k < n; k++) { const t = 2 * Math.PI * k / n; pts.push([cx + R * Math.cos(t), cy + R * Math.sin(t)]); }
        put(pts.map(p => rot(p, r)), on);
      } else if (code === 7) {
        const c = rot([a[0], a[1]], a[5] || 0), cx = x + c[0] * u, cy = y + c[1] * u, ro = a[2] / 2 * u, ri = a[3] / 2 * u;
        if (ro > 0) { d += circlePath(cx, cy, ro, true); bbGrow(bb, cx - ro, cy - ro); bbGrow(bb, cx + ro, cy + ro); }
        if (ri > 0) d += circlePath(cx, cy, ri, false);
      } else if (code === 6) {
        const c = rot([a[0], a[1]], a[8] || 0), cx = x + c[0] * u, cy = y + c[1] * u, ro = a[2] / 2 * u;
        if (ro > 0) { d += circlePath(cx, cy, ro, true); bbGrow(bb, cx - ro, cy - ro); bbGrow(bb, cx + ro, cy + ro); }
      }
    }
    return { d, bb };
  }

  function apertureShape(ap, macros, x, y) {
    const u = ap.u, p = ap.params;
    switch (ap.type) {
      case "C": { const r = (p[0] || 0) * u / 2; if (r <= 0) return null; return { d: circlePath(x, y, r), bb: [x - r, y - r, x + r, y + r] }; }
      case "R": { const w = (p[0] || 0) * u / 2, h = (p[1] || p[0] || 0) * u / 2; if (w <= 0 || h <= 0) return null;
        return { d: `M${f3(x - w)} ${f3(y - h)}H${f3(x + w)}V${f3(y + h)}H${f3(x - w)}Z`, bb: [x - w, y - h, x + w, y + h] }; }
      case "O": {
        const w = (p[0] || 0) * u, h = (p[1] || p[0] || 0) * u; if (w <= 0 || h <= 0) return null;
        let d;
        if (Math.abs(w - h) < 1e-9) return { d: circlePath(x, y, w / 2), bb: [x - w / 2, y - h / 2, x + w / 2, y + h / 2] };
        if (w > h) { const r = h / 2, a = w / 2 - r;
          d = `M${f3(x - a)} ${f3(y - r)}H${f3(x + a)}A${f3(r)} ${f3(r)} 0 0 1 ${f3(x + a)} ${f3(y + r)}H${f3(x - a)}A${f3(r)} ${f3(r)} 0 0 1 ${f3(x - a)} ${f3(y - r)}Z`;
        } else { const r = w / 2, a = h / 2 - r;
          d = `M${f3(x + r)} ${f3(y - a)}V${f3(y + a)}A${f3(r)} ${f3(r)} 0 0 1 ${f3(x - r)} ${f3(y + a)}V${f3(y - a)}A${f3(r)} ${f3(r)} 0 0 1 ${f3(x + r)} ${f3(y - a)}Z`; }
        return { d, bb: [x - w / 2, y - h / 2, x + w / 2, y + h / 2] };
      }
      case "P": {
        const R = (p[0] || 0) * u / 2, n = Math.max(3, Math.round(p[1] || 3)), r0 = p[2] || 0; if (R <= 0) return null;
        const pts = []; const bb = newBB();
        for (let k = 0; k < n; k++) { const t = (r0 + 360 * k / n) * Math.PI / 180; const q = [x + R * Math.cos(t), y + R * Math.sin(t)]; pts.push(q); bbGrow(bb, q[0], q[1]); }
        return { d: polyPath(pts), bb };
      }
      default: {
        const m = macros[ap.type];
        if (!m) return null;
        const s = macroShape(m, p, u, x, y);
        return s.d ? s : null;
      }
    }
  }

  function arcInfo(x0, y0, x1, y1, cx, cy, ccw) {
    const r = Math.hypot(x0 - cx, y0 - cy);
    const a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(y1 - cy, x1 - cx);
    let sweep = ccw ? a1 - a0 : a0 - a1;
    while (sweep <= 1e-9) sweep += 2 * Math.PI;
    const full = Math.abs(x1 - x0) < 1e-7 && Math.abs(y1 - y0) < 1e-7;
    if (full) sweep = 2 * Math.PI;
    return { r, a0, sweep, full };
  }
  function arcSvg(x0, y0, x1, y1, cx, cy, ccw) {
    const { r, sweep, full } = arcInfo(x0, y0, x1, y1, cx, cy, ccw);
    const s = ccw ? 1 : 0;
    if (r < 1e-9) return `L${f3(x1)} ${f3(y1)}`;
    if (full) {
      const px = 2 * cx - x0, py = 2 * cy - y0;
      return `A${f3(r)} ${f3(r)} 0 0 ${s} ${f3(px)} ${f3(py)}A${f3(r)} ${f3(r)} 0 0 ${s} ${f3(x1)} ${f3(y1)}`;
    }
    return `A${f3(r)} ${f3(r)} 0 ${sweep > Math.PI ? 1 : 0} ${s} ${f3(x1)} ${f3(y1)}`;
  }
  function arcBB(bb, x0, y0, x1, y1, cx, cy, ccw, pad) {
    const { r, a0, sweep } = arcInfo(x0, y0, x1, y1, cx, cy, ccw);
    bbGrow(bb, x0 - pad, y0 - pad); bbGrow(bb, x0 + pad, y0 + pad); bbGrow(bb, x1 - pad, y1 - pad); bbGrow(bb, x1 + pad, y1 + pad);
    for (let k = 0; k < 4; k++) {
      const t = k * Math.PI / 2;
      let rel = ccw ? t - a0 : a0 - t;
      rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (rel <= sweep) { const px = cx + r * Math.cos(t), py = cy + r * Math.sin(t); bbGrow(bb, px - pad, py - pad); bbGrow(bb, px + pad, py + pad); }
    }
  }

  function parseGerber(text) {
    const fmt = { xi: 2, xd: 6, yi: 2, yd: 6, zero: "L" };
    let unit = 1;               // mm per file unit (set by MO)
    const aps = {}, macros = {};
    let ap = null, x = 0, y = 0, interp = 1, multiQuad = true, pol = "D", lastOp = 1;
    let region = null;          // {d, bb}
    const objAttrs = {}, apAttrs = {}, fileAttrs = {};
    const objs = [];            // {t:'F'|'R'|'S', pol, d, bb, w?, a:attrs, fn?}
    const warnings = new Set();
    let strokeBuf = null;       // merges consecutive strokes that share aperture/polarity/attrs
    const bb = newBB();

    const cval = (s, isX) => {
      if (s.includes(".")) return parseFloat(s) * unit;
      const neg = s[0] === "-"; let dg = s.replace(/^[+-]/, "");
      const i = isX ? fmt.xi : fmt.yi, dd = isX ? fmt.xd : fmt.yd;
      if (fmt.zero === "T") dg = dg.padEnd(i + dd, "0");
      const v = parseInt(dg, 10) / Math.pow(10, dd);
      return (neg ? -v : v) * unit;
    };
    const attrsNow = () => {
      const a = {};
      if (objAttrs.P) a.P = objAttrs.P;
      if (objAttrs.N) a.N = objAttrs.N;
      if (objAttrs.C) a.C = objAttrs.C;
      return a;
    };
    function doAttr(cmd) {
      // cmd like "TO.P,R1,1,GND" | "TF.FileFunction,Copper,L1,Top" | "TA.AperFunction,SMDPad,CuDef" | "TD" | "TD.P"
      if (cmd.startsWith("TF.")) { const p = cmd.slice(3).split(","); fileAttrs[p[0]] = p.slice(1); }
      else if (cmd.startsWith("TA.")) { const p = cmd.slice(3).split(","); apAttrs[p[0]] = p.slice(1); }
      else if (cmd.startsWith("TO.")) { const p = cmd.slice(3).split(","); objAttrs[p[0]] = p.slice(1).map(v => v.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))); }
      else if (cmd.startsWith("TD")) {
        const n = cmd.slice(2).replace(/^\./, "");
        if (!n) { for (const k in objAttrs) delete objAttrs[k]; for (const k in apAttrs) delete apAttrs[k]; }
        else { delete objAttrs[n]; delete apAttrs[n]; }
      }
    }
    function flushStroke() { if (strokeBuf) { objs.push(strokeBuf); strokeBuf = null; } }
    function doExtended(body) {
      if (body.startsWith("AM")) {
        const parts = body.split("*");
        const name = parts[0].slice(2).trim();
        macros[name] = parts.slice(1).map(s => s.trim()).filter(Boolean);
        return;
      }
      for (let cmd of body.split("*")) {
        cmd = cmd.trim(); if (!cmd) continue;
        if (cmd.startsWith("FS")) {
          const m = cmd.match(/^FS([LT])?([AI])?.*?X(\d)(\d)Y(\d)(\d)/);
          if (m) { fmt.zero = m[1] || "L"; fmt.xi = +m[3]; fmt.xd = +m[4]; fmt.yi = +m[5]; fmt.yd = +m[6]; if (m[2] === "I") warnings.add("incremental coordinates"); }
        } else if (cmd.startsWith("MO")) { unit = cmd.includes("IN") ? 25.4 : 1; }
        else if (cmd.startsWith("AD")) {
          const m = cmd.match(/^ADD(\d+)([A-Za-z_.$][^,]*)(?:,(.*))?$/);
          if (m) {
            const params = m[3] ? m[3].split("X").map(s => parseFloat(s)) : [];
            aps[+m[1]] = { type: m[2], params, u: unit, fn: apAttrs.AperFunction ? apAttrs.AperFunction.join(",") : "" };
          }
        } else if (cmd.startsWith("LP")) { flushStroke(); pol = cmd[2] === "C" ? "C" : "D"; }
        else if (cmd.startsWith("T")) { flushStroke(); doAttr(cmd); }
        else if (cmd.startsWith("SR")) { if (/X[2-9]|X\d\d|Y[2-9]|Y\d\d/.test(cmd)) warnings.add("step-and-repeat blocks (panel) not expanded"); }
      }
    }
    function doWord(w) {
      if (w.startsWith("G04")) {
        const m = w.match(/^G04\s*#@!\s*(.*)$/);
        if (m) { flushStroke(); doAttr(m[1].trim()); }
        return;
      }
      if (/^M0[0-2]$/.test(w)) return;
      let s = w;
      if (s.startsWith("G54") || s.startsWith("G55")) s = s.slice(3);
      if (s === "G36") { flushStroke(); region = { d: "", bb: newBB(), open: false }; return; }
      if (s === "G37") {
        if (region && region.d) objs.push({ t: "R", pol, d: region.d + (region.open ? "Z" : ""), bb: region.bb, a: attrsNow() });
        region = null; return;
      }
      if (s === "G74") { multiQuad = false; return; }
      if (s === "G75") { multiQuad = true; return; }
      if (s === "G70") { unit = 25.4; return; }
      if (s === "G71") { unit = 1; return; }
      if (/^G9[01]$/.test(s)) return;
      const sel = s.match(/^(?:G0?([123]))?D(\d{2,})$/);
      if (sel && +sel[2] >= 10) { if (sel[1]) interp = +sel[1]; flushStroke(); ap = aps[+sel[2]] || null; return; }
      const m = s.match(/^(?:G0?([123]))?(?:X([+-]?[\d.]+))?(?:Y([+-]?[\d.]+))?(?:I([+-]?[\d.]+))?(?:J([+-]?[\d.]+))?(?:D0*([123]))?$/);
      if (!m) return;
      if (m[1]) interp = +m[1];
      if (!m[2] && !m[3] && !m[6]) return;
      const nx = m[2] !== undefined ? cval(m[2], true) : x;
      const ny = m[3] !== undefined ? cval(m[3], false) : y;
      let i = m[4] !== undefined ? cval(m[4], true) : 0, j = m[5] !== undefined ? cval(m[5], false) : 0;
      const op = m[6] ? +m[6] : lastOp;
      lastOp = op;
      let cx = x + i, cy = y + j;
      if (interp !== 1 && !multiQuad && op === 1) {
        // single-quadrant: choose signs of I/J
        let best = null;
        for (const si of [1, -1]) for (const sj of [1, -1]) {
          const ccx = x + si * Math.abs(i), ccy = y + sj * Math.abs(j);
          const err = Math.abs(Math.hypot(x - ccx, y - ccy) - Math.hypot(nx - ccx, ny - ccy));
          const inf = arcInfo(x, y, nx, ny, ccx, ccy, interp === 3);
          if (inf.sweep <= Math.PI / 2 + 1e-6 && (!best || err < best.err)) best = { err, ccx, ccy };
        }
        if (best) { cx = best.ccx; cy = best.ccy; }
      }
      if (region) {
        if (op === 2) { if (region.open) region.d += "Z"; region.d += `M${f3(nx)} ${f3(ny)}`; region.open = true; bbGrow(region.bb, nx, ny); }
        else if (op === 1) {
          if (!region.open) { region.d += `M${f3(x)} ${f3(y)}`; region.open = true; bbGrow(region.bb, x, y); }
          if (interp === 1) region.d += `L${f3(nx)} ${f3(ny)}`;
          else { region.d += arcSvg(x, y, nx, ny, cx, cy, interp === 3); arcBB(region.bb, x, y, nx, ny, cx, cy, interp === 3, 0); }
          bbGrow(region.bb, nx, ny);
        }
        bbGrow(bb, nx, ny);
      } else if (op === 3) {
        flushStroke();
        if (ap) {
          const sh = apertureShape(ap, macros, nx, ny);
          if (sh) {
            objs.push({ t: "F", pol, d: sh.d, bb: sh.bb, a: attrsNow(), fn: ap.fn, ap: ap.type });
            bbGrow(bb, sh.bb[0], sh.bb[1]); bbGrow(bb, sh.bb[2], sh.bb[3]);
          }
        }
      } else if (op === 1 && ap) {
        const w = ap.type === "C" ? (ap.params[0] || 0) * ap.u : ap.type === "R" || ap.type === "O" ? Math.min(ap.params[0] || 0, ap.params[1] || ap.params[0] || 0) * ap.u : 0.1;
        const seg = interp === 1 ? `L${f3(nx)} ${f3(ny)}` : arcSvg(x, y, nx, ny, cx, cy, interp === 3);
        const a = attrsNow();
        const key = w + "|" + pol + "|" + (a.C || "") + "|" + (a.P || "") + "|" + (a.N || "");
        if (strokeBuf && strokeBuf.key === key && strokeBuf.ex === x && strokeBuf.ey === y) strokeBuf.d += seg;
        else { flushStroke(); strokeBuf = { t: "S", pol, w: Math.max(w, 0.01), d: `M${f3(x)} ${f3(y)}` + seg, bb: newBB(), a, key, segs: [] }; bbGrow(strokeBuf.bb, x, y); }
        if (interp === 1) strokeBuf.segs.push([x, y, nx, ny]);
        else { const inf = arcInfo(x, y, nx, ny, cx, cy, interp === 3); strokeBuf.segs.push([x, y, nx, ny, inf.r, inf.sweep > Math.PI ? 1 : 0, interp === 3 ? 1 : 0, inf.full ? 1 : 0, cx, cy]); }
        strokeBuf.ex = nx; strokeBuf.ey = ny;
        bbGrow(strokeBuf.bb, nx, ny);
        if (interp !== 1) arcBB(strokeBuf.bb, x, y, nx, ny, cx, cy, interp === 3, 0);
        const h = w / 2; bbGrow(bb, Math.min(x, nx) - h, Math.min(y, ny) - h); bbGrow(bb, Math.max(x, nx) + h, Math.max(y, ny) + h);
      }
      x = nx; y = ny;
    }

    // tokenise
    const n = text.length;
    let k = 0;
    while (k < n) {
      const c = text[k];
      if (c === "%") {
        const e = text.indexOf("%", k + 1);
        if (e < 0) break;
        doExtended(text.slice(k + 1, e).replace(/[\r\n]+/g, ""));
        k = e + 1;
      } else if (c === "\r" || c === "\n" || c === " " || c === "\t") { k++; }
      else {
        const e = text.indexOf("*", k);
        if (e < 0) break;
        const w = text.slice(k, e);
        doWord(w.startsWith("G04") ? w.replace(/[\r\n]+/g, " ").trim() : w.replace(/\s+/g, ""));
        k = e + 1;
      }
    }
    flushStroke();
    objs.forEach(o => { delete o.key; delete o.ex; delete o.ey; });
    return { objs, fileAttrs, bb, warnings: [...warnings], unit };
  }

  /* ---------- Excellon ---------- */
  function parseDrill(text) {
    let unit = 1, zeros = "", inHeader = false, fnNext = "", fileFn = "";
    let fmtInt = 3, fmtDec = 3;
    const tools = {}; let tool = null, x = 0, y = 0, route = false, routeStart = null;
    const holes = [], slots = [];
    const num = (s, isInch) => {
      if (s.includes(".")) return parseFloat(s) * unit;
      const neg = s[0] === "-"; let d = s.replace(/^[+-]/, "");
      const dec = unit === 25.4 ? 4 : fmtDec, int = unit === 25.4 ? 2 : fmtInt;
      let v;
      if (zeros === "LZ") v = parseInt(d.padEnd(int + dec, "0"), 10) / Math.pow(10, dec);
      else v = parseInt(d, 10) / Math.pow(10, dec);
      return (neg ? -v : v) * unit;
    };
    for (let raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith(";")) {
        const m = line.match(/#@!\s*TA\.AperFunction,(.*)$/); if (m) fnNext = m[1];
        const f = line.match(/#@!\s*TF\.FileFunction,(.*)$/); if (f) fileFn = f[1];
        const fm = line.match(/FORMAT=\{(\d+):(\d+)/); if (fm) { fmtInt = +fm[1]; fmtDec = +fm[2]; }
        continue;
      }
      if (line === "M48") { inHeader = true; continue; }
      if (line === "%" || line === "M95") { inHeader = false; continue; }
      if (/^(INCH|METRIC)/.test(line)) {
        unit = line.startsWith("INCH") ? 25.4 : 1;
        if (line.includes("LZ")) zeros = "LZ"; else if (line.includes("TZ")) zeros = "TZ";
        const m = line.match(/,0*(\d+)\.(\d+)/); if (m) { fmtInt = m[1].length || fmtInt; fmtDec = m[2].length; }
        continue;
      }
      if (line === "M71") { unit = 1; continue; }
      if (line === "M72") { unit = 25.4; continue; }
      let m = line.match(/^T(\d+)(?:F\d+)?(?:S\d+)?C([\d.]+)/);
      if (m) { tools[+m[1]] = { d: parseFloat(m[2]) * unit, fn: fnNext }; fnNext = ""; if (!inHeader) tool = tools[+m[1]]; continue; }
      m = line.match(/^T(\d+)$/);
      if (m) { tool = tools[+m[1]] || null; continue; }
      if (line === "M15") { route = true; continue; }
      if (line === "M16" || line === "M17") { route = false; continue; }
      if (line.startsWith("G05") || line.startsWith("G90")) { route = false; continue; }
      const mx = line.match(/X([+-]?[\d.]+)/), my = line.match(/Y([+-]?[\d.]+)/);
      if (!mx && !my) continue;
      const g85 = line.match(/^(.*?)G85X([+-]?[\d.]+)Y([+-]?[\d.]+)/);
      if (g85 && tool) {
        const ax = g85[1].match(/X([+-]?[\d.]+)/), ay = g85[1].match(/Y([+-]?[\d.]+)/);
        const sx = ax ? num(ax[1]) : x, sy = ay ? num(ay[1]) : y, ex = num(g85[2]), ey = num(g85[3]);
        slots.push({ x1: sx, y1: sy, x2: ex, y2: ey, d: tool.d, fn: tool.fn });
        x = ex; y = ey; continue;
      }
      const nx = mx ? num(mx[1]) : x, ny = my ? num(my[1]) : y;
      if (line.startsWith("G00")) { routeStart = [nx, ny]; x = nx; y = ny; continue; }
      if (line.startsWith("G01") && route && routeStart && tool) {
        slots.push({ x1: x, y1: y, x2: nx, y2: ny, d: tool.d, fn: tool.fn });
        x = nx; y = ny; continue;
      }
      if (tool && !route) holes.push({ x: nx, y: ny, d: tool.d, fn: tool.fn });
      x = nx; y = ny;
    }
    const npth = /NonPlated|NPTH/i.test(fileFn);
    return { holes, slots, npth, fileFn };
  }

  return { parseGerber, parseDrill, f3, newBB, bbGrow };
})();
if (typeof module !== "undefined") module.exports = PokeGerber;
