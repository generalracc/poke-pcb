/* ---------- poke~pcb: project builder ---------- */
const PokeBoard = (() => {
  const { parseGerber, parseDrill, f3, newBB, bbGrow } = PokeGerber;
  const IO = PokeIO;

  /* ---------- layer identification ---------- */
  const EXT_ROLE = {
    gtl: "cu-top", gbl: "cu-bot", gts: "mask-top", gbs: "mask-bot", gto: "silk-top", gbo: "silk-bot",
    gtp: "paste-top", gbp: "paste-bot", gko: "outline", gm1: "outline", gml: "outline", gm: "outline",
    cmp: "cu-top", sol: "cu-bot", stc: "mask-top", sts: "mask-bot", plc: "silk-top", pls: "silk-bot",
    crc: "paste-top", crs: "paste-bot", dim: "outline", mil: "outline", oln: "outline", out: "outline",
  };
  const DRILL_EXT = new Set(["drl", "xln", "exc", "drd", "nc", "tap", "drill"]);
  const GERBER_EXT = new Set(["gbr", "ger", "pho", "art", "gbx", "gerber"]);
  function roleFromName(path) {
    const base = path.split("/").pop();
    const lower = base.toLowerCase();
    const ext = lower.includes(".") ? lower.split(".").pop() : "";
    const stem = lower.replace(/\.[^.]+$/, "");
    if (EXT_ROLE[ext]) return EXT_ROLE[ext];
    if (/^g\d+$|^gl\d+$|^g\d+l$|^gp\d+$|^ly\d+$|^in\d+$/.test(ext)) return "cu-in";
    if (/^gm\d+$/.test(ext)) return "mech";
    const s = stem.replace(/[\s.\-]+/g, "_");
    const tests = [
      [/(^|_)f_cu$|toplayer$|top_?copper$|copper_top|_top_?layer$|^top$/, "cu-top"],
      [/(^|_)b_cu$|bottomlayer$|bottom_?copper$|copper_bottom|_bottom_?layer$|^bottom$/, "cu-bot"],
      [/(^|_)in\d+_cu$|inner_?\d+|innerlayer\d*|_l\d+$/, "cu-in"],
      [/(^|_)f_mask$|topsoldermask|top_?solder_?mask|soldermask_top|topmask|_tsm$/, "mask-top"],
      [/(^|_)b_mask$|bottomsoldermask|bottom_?solder_?mask|soldermask_bottom|bottommask|_bsm$/, "mask-bot"],
      [/(^|_)f_silk(s|screen)?$|topsilk|top_?silk|silkscreen_top|toplegend|_tsk$/, "silk-top"],
      [/(^|_)b_silk(s|screen)?$|bottomsilk|bottom_?silk|silkscreen_bottom|bottomlegend|_bsk$/, "silk-bot"],
      [/(^|_)f_paste$|toppaste|top_?paste|paste_top|_tsp$/, "paste-top"],
      [/(^|_)b_paste$|bottompaste|bottom_?paste|paste_bottom|_bsp$/, "paste-bot"],
      [/edge_cuts$|boardoutline|board_?outline|outline$|profile$|edges?$|contour/, "outline"],
    ];
    for (const [re, r] of tests) if (re.test(s)) return r;
    return null;
  }
  function roleFromFF(ff) {
    if (!ff) return null;
    const [kind, a, b] = ff.split(",");
    const k = (kind || "").toLowerCase();
    if (k === "copper") { const side = (b || "").toLowerCase(); return side.startsWith("top") ? "cu-top" : side.startsWith("bot") ? "cu-bot" : "cu-in"; }
    const side = (a || "").toLowerCase().startsWith("bot") ? "bot" : "top";
    if (k === "soldermask") return "mask-" + side;
    if (k === "legend") return "silk-" + side;
    if (k === "paste") return "paste-" + side;
    if (k === "profile") return "outline";
    return "other";
  }
  function sniffFF(text) {
    const m = text.slice(0, 4000).match(/(?:%|#@!\s*)TF\.FileFunction,([^*%\r\n]+)/);
    return m ? m[1] : null;
  }
  const looksGerber = t => /%FS[LT]?[AI]?/.test(t.slice(0, 6000)) || (/\bD0?[123]\*/.test(t.slice(0, 20000)) && /\*/.test(t.slice(0, 200)));
  const looksDrill = t => /^\s*(;.*\r?\n\s*)*M48/.test(t.slice(0, 3000)) || /(^|\n)T\d+C[\d.]+/.test(t.slice(0, 4000)) && /(^|\n)X[+-]?[\d.]+Y/.test(t.slice(0, 20000));

  /* ---------- table helpers ---------- */
  const norm = s => String(s || "").toLowerCase().replace(/[\s_#().:\-\/]+/g, " ").trim();
  function findHeader(rows, need) {
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const h = rows[r].map(norm);
      const idx = need(h);
      if (idx) return { r, idx };
    }
    return null;
  }
  const colOf = (h, res) => { for (const re of res) { const i = h.findIndex(c => re.test(c)); if (i >= 0) return i; } return -1; };
  const DES = [/^designators?$/, /^references?$/, /^ref$/, /^refs$/, /^refdes$/, /^ref ?des(ignators?)?$/, /^reference designators?$/, /^part references?$/, /^designation$/, /^位号$/];
  const VAL = [/^comment$/, /^value$/, /^val$/, /^values$/, /^description$/, /^part$/, /^part ?number$/, /^mpn$/, /^name$/, /^manufacturer part( number)?$/];
  const FTP = [/^footprint$/, /^package$/, /^footprint name$/, /^pattern$/, /^case$/, /^package case$/, /^封装$/];
  const LCSC = [/lcsc/, /^jlcpcb part/, /^jlc part/, /^supplier part/, /^jlcpcb$/];
  const QTY = [/^qty$/, /^quantity$/, /^count$/];
  const CX = [/^mid x$/, /^center x$/, /^pos ?x$/, /^posx$/, /^x$/, /^ref x$/, /^x mm$/, /^x mil$/, /^location x$/, /^center-x$/];
  const CY = [/^mid y$/, /^center y$/, /^pos ?y$/, /^posy$/, /^y$/, /^ref y$/, /^y mm$/, /^y mil$/, /^location y$/];
  const ROT = [/^rotation$/, /^rot$/, /^angle$/, /^rotate$/, /^orientation$/];
  const SIDE = [/^layer$/, /^side$/, /^tb$/, /^t b$/, /^top bottom$/, /^mount side$/];

  function classifyTable(rows) {
    const cpl = findHeader(rows, h => { const d = colOf(h, DES), x = colOf(h, CX), y = colOf(h, CY); return d >= 0 && x >= 0 && y >= 0 ? { d, x, y, rot: colOf(h, ROT), side: colOf(h, SIDE), val: colOf(h, [/^val$/, /^value$/, /^comment$/]), pkg: colOf(h, [/^package$/, /^footprint$/]) } : null; });
    if (cpl) return { kind: "cpl", r: cpl.r, ...cpl.idx };
    const bom = findHeader(rows, h => { const d = colOf(h, DES); if (d < 0) return null; const v = colOf(h, VAL), f = colOf(h, FTP), l = colOf(h, LCSC); return v >= 0 || l >= 0 || f >= 0 ? { d, v, f, l, q: colOf(h, QTY) } : null; });
    if (bom) return { kind: "bom", r: bom.r, ...bom.idx };
    return null;
  }
  function splitRefs(s) {
    const out = [];
    for (let t of String(s || "").split(/[\s,;]+/)) {
      t = t.trim(); if (!t) continue;
      const m = t.match(/^([A-Za-z_]+)(\d+)\s*-\s*(?:([A-Za-z_]+))?(\d+)$/);
      if (m && (!m[3] || m[3] === m[1]) && +m[4] >= +m[2] && +m[4] - +m[2] < 500) { for (let k = +m[2]; k <= +m[4]; k++) out.push(m[1] + k); }
      else out.push(t);
    }
    return out;
  }

  /* ---------- scanning dropped inputs ---------- */
  async function scan(inputs, onStep) {
    const files = [];
    const notes = [];
    async function addZip(blob, prefix, depth) {
      let z;
      try { z = await IO.openZip(blob); } catch (e) { notes.push({ level: "warn", text: `${prefix.replace(/\/$/, "")}: ${e.message}` }); return; }
      for (const e of z.entries) {
        const path = prefix + e.name;
        if (/\.zip$/i.test(e.name) && depth < 3) {
          if (e.usize > 80e6) { notes.push({ level: "info", text: `Skipped ${path} (too large).` }); continue; }
          const b = await z.read(e);
          await addZip(new Blob([b]), path + "/", depth + 1);
          continue;
        }
        files.push({ path, size: e.usize, get: () => z.read(e) });
      }
    }
    for (const f of inputs) {
      onStep && onStep(`Reading ${f.name}`);
      if (/\.zip$/i.test(f.name)) await addZip(f.blob, f.name + "/", 0);
      else files.push({ path: f.path || f.name, size: f.blob.size, get: async () => new Uint8Array(await f.blob.arrayBuffer()) });
    }
    const groups = new Map();
    const boms = [], cpls = [];
    let order = null;
    let bigSkipped = 0;
    for (const f of files) {
      const base = f.path.split("/").pop();
      const lower = base.toLowerCase();
      const ext = lower.includes(".") ? lower.split(".").pop() : "";
      const dir = f.path.slice(0, f.path.length - base.length);
      if (!base || base.startsWith(".") || /__macosx/i.test(f.path)) continue;
      if (ext === "pdf") { if (/bom|bill/i.test(base)) notes.push({ level: "warn", text: `${base} is a PDF. poke~pcb reads BOMs as CSV or XLSX, so export it in one of those formats.` }); continue; }
      if (["tgz", "gz", "rar", "7z", "ddw", "png", "jpg", "jpeg", "step", "stp", "wrl", "kicad_pcb", "kicad_sch", "pcbdoc", "schdoc", "brd", "sch"].includes(ext)) continue;
      if (f.size > 25e6 || (ext === "" && f.size > 3e6)) { bigSkipped++; continue; }
      if (ext === "json") {
        try {
          const t = IO.decodeText(await f.get(), "gbk"); const j = JSON.parse(t);
          if (j && (j.color_sm !== undefined || j.po !== undefined || j.layers !== undefined)) order = parseOrder(j, f.path);
        } catch (e) { }
        continue;
      }
      if (ext === "xls") { notes.push({ level: "warn", text: `${base} is an old .xls file. Save it as .xlsx or CSV and drop it again.` }); continue; }
      if (["csv", "tsv", "xlsx"].includes(ext) || (ext === "txt" && f.size < 5e6)) {
        const bytes = await f.get();
        if (ext === "txt") { const t = IO.decodeText(bytes); if (looksDrill(t)) { addLayer(groups, dir, { path: f.path, role: "drill", text: t }); continue; } }
        let rows;
        try { rows = ext === "xlsx" ? await IO.parseXLSX(bytes) : IO.parseCSV(IO.decodeText(bytes)); } catch (e) { notes.push({ level: "warn", text: `Couldn't read ${base}: ${e.message}` }); continue; }
        const c = classifyTable(rows);
        if (c && c.kind === "cpl") cpls.push({ path: f.path, name: base, rows, h: c });
        else if (c && c.kind === "bom") boms.push({ path: f.path, name: base, rows, h: c });
        continue;
      }
      const byName = roleFromName(f.path);
      if (!byName && !DRILL_EXT.has(ext) && !GERBER_EXT.has(ext) && ext !== "" && !/^g/.test(ext)) continue;
      const bytes = await f.get();
      const text = IO.decodeText(bytes);
      if (DRILL_EXT.has(ext) || (!byName && looksDrill(text) && !looksGerber(text))) {
        if (looksDrill(text)) addLayer(groups, dir, { path: f.path, role: "drill", text });
        continue;
      }
      if (!looksGerber(text)) continue;
      const ff = sniffFF(text);
      const role = roleFromFF(ff) || byName || "other";
      addLayer(groups, dir, { path: f.path, role, text, ff, tool: (text.slice(0, 3000).match(/GenerationSoftware,([^*%\r\n]+)/) || [])[1] || (text.slice(0, 600).match(/output software:\s*([^*\r\n]+)/) || [])[1] || "" });
    }
    if (bigSkipped) notes.push({ level: "info", text: `Skipped ${bigSkipped} very large file${bigSkipped > 1 ? "s" : ""} (panel data from the factory). Your original gerbers are used instead.` });
    // pick the best gerber set
    let best = null;
    for (const [dir, g] of groups) {
      const roles = new Set(g.layers.map(l => l.role));
      const panelish = g.layers.some(l => /jlccam|genesis|ucam/i.test(l.tool || ""));
      let score = (roles.has("cu-top") ? 4 : 0) + (roles.has("cu-bot") ? 2 : 0) + (roles.has("outline") ? 2 : 0) + (roles.has("mask-top") ? 1 : 0) + (roles.has("silk-top") ? 1 : 0) + (roles.has("paste-top") ? 1 : 0) + (g.drills.length ? 1 : 0) + (g.layers.some(l => l.ff) ? 1 : 0);
      if (panelish) score -= 6;
      if (!roles.has("cu-top") && !roles.has("cu-bot")) continue;
      if (!best || score > best.score) best = { dir, score, ...g };
    }
    return { set: best, boms, cpls, order, notes };
  }
  function addLayer(groups, dir, layer) {
    if (!groups.has(dir)) groups.set(dir, { layers: [], drills: [] });
    const g = groups.get(dir);
    if (layer.role === "drill") g.drills.push(layer); else g.layers.push(layer);
  }

  function parseOrder(j, path) {
    const s = v => (v === undefined || v === null) ? "" : String(v);
    const mask = s(j.color_sm), silk = s(j.color_ss), fin = s(j.finished);
    const col = t => /绿|green/i.test(t) ? "green" : /红|red/i.test(t) ? "red" : /黄|yellow/i.test(t) ? "yellow" : /蓝|blue/i.test(t) ? "blue" : /白|white/i.test(t) ? "white" : /紫|purple/i.test(t) ? "purple" : /黑|black/i.test(t) ? "black" : "";
    const finish = /沉金|enig|gold/i.test(fin) ? "enig" : /osp/i.test(fin) ? "osp" : /喷锡|hasl/i.test(fin) ? "hasl" : "";
    const finishLabel = /无铅|lead.?free/i.test(fin) ? "lead-free HASL" : /有铅/.test(fin) ? "leaded HASL" : finish === "enig" ? "ENIG" : finish === "osp" ? "OSP" : finish === "hasl" ? "HASL" : "";
    return { path, po: s(j.po), mask: col(mask), silk: col(silk), finish, finishLabel, thickness: j.thickness ? Math.round(j.thickness * 100) / 100 : null, layers: j.layers || null, name: s(j.pcbFileName) };
  }

  /* ---------- outline ---------- */
  function buildOutline(objs) {
    const segs = [];
    for (const o of objs) if (o.t === "S" && o.segs) for (const s of o.segs) segs.push(s);
    const loops = [];
    const rest = [];
    for (const s of segs) {
      if (s.length > 4 && s[7]) { loops.push({ d: `M${f3(s[0])} ${f3(s[1])}` + arcD(s, false) + "Z", area: Math.PI * s[4] * s[4], pts: [] }); }
      else rest.push(s);
    }
    const key = (x, y) => Math.round(x * 200) + "," + Math.round(y * 200);
    const used = new Array(rest.length).fill(false);
    const ends = new Map();
    rest.forEach((s, i) => { for (const k of [key(s[0], s[1]), key(s[2], s[3])]) { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
    for (let i = 0; i < rest.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const startK = key(rest[i][0], rest[i][1]);
      let d = `M${f3(rest[i][0])} ${f3(rest[i][1])}` + (rest[i].length > 4 ? arcD(rest[i], false) : `L${f3(rest[i][2])} ${f3(rest[i][3])}`);
      const pts = [[rest[i][0], rest[i][1]], [rest[i][2], rest[i][3]]];
      let cur = [rest[i][2], rest[i][3]];
      let closed = key(cur[0], cur[1]) === startK;
      let guard = 0;
      while (!closed && guard++ < 100000) {
        const cand = (ends.get(key(cur[0], cur[1])) || []).find(j => !used[j]);
        if (cand === undefined) break;
        used[cand] = true;
        const s = rest[cand];
        const fwd = key(s[0], s[1]) === key(cur[0], cur[1]);
        if (s.length > 4) d += arcD(s, !fwd); else d += `L${f3(fwd ? s[2] : s[0])} ${f3(fwd ? s[3] : s[1])}`;
        cur = fwd ? [s[2], s[3]] : [s[0], s[1]];
        pts.push(cur);
        closed = key(cur[0], cur[1]) === startK;
      }
      if (closed && pts.length >= 3) {
        let a = 0; for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
        loops.push({ d: d + "Z", area: Math.abs(a / 2), pts });
      }
    }
    loops.sort((a, b) => b.area - a.area);
    return loops;
  }
  function arcD(s, reverse) {
    const [x0, y0, x1, y1, r, large, sweep, full, cx, cy] = s;
    if (full) { const px = 2 * cx - x0, py = 2 * cy - y0; return `A${f3(r)} ${f3(r)} 0 0 ${sweep} ${f3(px)} ${f3(py)}A${f3(r)} ${f3(r)} 0 0 ${sweep} ${f3(x0)} ${f3(y0)}`; }
    if (!reverse) return `A${f3(r)} ${f3(r)} 0 ${large} ${sweep} ${f3(x1)} ${f3(y1)}`;
    return `A${f3(r)} ${f3(r)} 0 ${large} ${sweep ? 0 : 1} ${f3(x0)} ${f3(y0)}`;
  }

  /* ---------- SVG rendering of a layer (with clear polarity) ---------- */
  function makeRenderer(bounds, prefix) {
    let n = 0; const defs = [];
    const [x0, y0, x1, y1] = bounds; const m = 20;
    const big = `x="${f3(x0 - m)}" y="${f3(y0 - m)}" width="${f3(x1 - x0 + 2 * m)}" height="${f3(y1 - y0 + 2 * m)}"`;
    function elems(objs, fc, sc) {
      let out = "";
      const byW = new Map();
      for (const o of objs) {
        if (o.t === "S") { const k = f3(o.w); byW.set(k, (byW.get(k) || "") + o.d); }
        else out += `<path class="${fc}" d="${o.d}"/>`;
      }
      for (const [w, d] of byW) out += `<path class="${sc}" stroke-width="${w}" d="${d}"/>`;
      return out;
    }
    function render(objs, fc, sc) {
      let acc = ""; let i = 0;
      while (i < objs.length) {
        const dark = []; while (i < objs.length && objs[i].pol !== "C") dark.push(objs[i++]);
        if (dark.length) acc += elems(dark, fc, sc);
        const clear = []; while (i < objs.length && objs[i].pol === "C") clear.push(objs[i++]);
        if (clear.length && acc) {
          const id = `${prefix}m${n++}`;
          defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" ${big}><rect ${big} fill="#fff"/>${elems(clear, "clr-f", "clr-s")}</mask>`);
          acc = `<g mask="url(#${id})">${acc}</g>`;
        }
      }
      return acc;
    }
    return { render, defs, big };
  }

  /* ---------- components from X2 attributes ---------- */
  function x2Components(L) {
    const comps = new Map();
    const get = ref => { if (!comps.has(ref)) comps.set(ref, { ref, sides: {}, paste: {}, smd: false, tht: false, src: "x2" }); return comps.get(ref); };
    for (const [role, side] of [["cu-top", "top"], ["cu-bot", "bottom"]]) {
      const g = L[role]; if (!g) continue;
      for (const o of g.objs) {
        if (!o.a.P || o.t === "S") continue;
        const [ref, pin, name] = o.a.P;
        const c = get(ref);
        const s = c.sides[side] || (c.sides[side] = { pads: [], silk: "", bb: newBB() });
        s.pads.push({ d: o.d, pin: pin || "", name: name || "", net: o.a.N ? o.a.N[0] : "", bb: o.bb });
        bbGrow(s.bb, o.bb[0], o.bb[1]); bbGrow(s.bb, o.bb[2], o.bb[3]);
        if (/SMDPad/i.test(o.fn || "")) c.smd = true;
        if (/ComponentPad/i.test(o.fn || "")) c.tht = true;
      }
    }
    for (const [role, side] of [["paste-top", "top"], ["paste-bot", "bottom"]]) {
      const g = L[role]; if (!g) continue;
      for (const o of g.objs) if (o.a.C && comps.has(o.a.C[0])) comps.get(o.a.C[0]).paste[side] = true;
    }
    return comps;
  }
  function addSilk(comps, L) {
    for (const [role, side] of [["silk-top", "top"], ["silk-bot", "bottom"]]) {
      const g = L[role]; if (!g) continue;
      for (const o of g.objs) {
        if (!o.a.C || o.pol === "C") continue;
        const c = comps.get(o.a.C[0]); if (!c || !c.sides[side]) continue;
        c.sides[side].silk += o.t === "S" ? `<path stroke-width="${f3(o.w)}" d="${o.d}"/>` : `<path class="sf" d="${o.d}"/>`;
      }
    }
  }

  /* ---------- CPL parsing + alignment ---------- */
  function parseCPL(cpl) {
    const { rows, h } = cpl; const out = [];
    const val = (s) => {
      s = String(s || "").trim(); if (!s) return null;
      const m = s.match(/^([+-]?[\d.]+)\s*(mm|mil|mils|in|inch)?$/i); if (!m) return null;
      const v = parseFloat(m[1]); const u = (m[2] || "").toLowerCase();
      return { v, u: u.startsWith("mil") ? "mil" : u.startsWith("in") ? "in" : u === "mm" ? "mm" : "" };
    };
    const headX = norm(rows[h.r][h.x]);
    for (let r = h.r + 1; r < rows.length; r++) {
      const row = rows[r]; const ref = (row[h.d] || "").trim(); if (!ref) continue;
      const X = val(row[h.x]), Y = val(row[h.y]); if (!X || !Y) continue;
      let unit = X.u || (/mil/.test(headX) ? "mil" : "");
      const k = unit === "mil" ? 0.0254 : unit === "in" ? 25.4 : 1;
      const sideRaw = h.side >= 0 ? String(row[h.side] || "").trim().toLowerCase() : "top";
      const side = /^(b|bot|bottom|back|bottomlayer|bottom layer|b\.cu|b_cu)$/.test(sideRaw) ? "bottom" : "top";
      const rot = h.rot >= 0 ? parseFloat(String(row[h.rot] || "0")) || 0 : 0;
      out.push({ ref, x: X.v * k, y: Y.v * k, rot, side, unitKnown: !!unit, val: h.val >= 0 ? row[h.val] : "", pkg: h.pkg >= 0 ? row[h.pkg] : "" });
    }
    return out;
  }
  // targets: {top:[[x,y]], bottom:[[x,y]]} (gerber coords); returns fn(p) -> [x,y] and score
  function alignCPL(items, targets, bounds) {
    if (!items.length) return null;
    const unitKnown = items.every(i => i.unitKnown);
    const scales = unitKnown ? [1] : [1, 0.0254, 25.4];
    const T = { top: targets.top || [], bottom: targets.bottom || [] };
    const all = T.top.concat(T.bottom);
    if (!all.length) return null;
    const tb = newBB(); all.forEach(p => bbGrow(tb, p[0], p[1]));
    const nearest = (pts, x, y) => { let b = Infinity; for (const p of pts) { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < b) b = d; } return Math.sqrt(b); };
    const sample = items.length > 400 ? items.filter((_, i) => i % Math.ceil(items.length / 400) === 0) : items;
    let best = null;
    for (const k of scales) for (const sy of [1, -1]) for (const mx of [false, true]) {
      if (mx && !items.some(i => i.side === "bottom")) continue;
      const raw = sample.map(i => { let x = i.x * k, y = i.y * k * sy; if (mx && i.side === "bottom") x = -x; return [x, y, i.side]; });
      const rb = newBB(); raw.forEach(p => bbGrow(rb, p[0], p[1]));
      const offs = [[0, 0], [(tb[0] + tb[2]) / 2 - (rb[0] + rb[2]) / 2, (tb[1] + tb[3]) / 2 - (rb[1] + rb[3]) / 2], [tb[0] - rb[0], tb[1] - rb[1]], [bounds[0] - rb[0], bounds[1] - rb[1]], [bounds[0], bounds[1]]];
      for (const [ox, oy] of offs) {
        let sc = 0;
        for (const p of raw) { const d = nearest(T[p[2]].length ? T[p[2]] : all, p[0] + ox, p[1] + oy); sc += Math.exp(-((d / 0.8) ** 2)); }
        if (!best || sc > best.sc) best = { sc, k, sy, mx, ox, oy };
      }
    }
    // refine: compare each centroid with the centre of the pads right around it
    const tf = (i, b) => { let x = i.x * b.k, y = i.y * b.k * b.sy; if (b.mx && i.side === "bottom") x = -x; return [x + b.ox, y + b.oy]; };
    const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
    for (let it = 0; it < 4; it++) {
      const dx = [], dy = [];
      for (const i of sample) {
        const [x, y] = tf(i, best); const pts = T[i.side].length ? T[i.side] : all;
        let n = 0, lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
        for (const p of pts) if (Math.abs(p[0] - x) < 1.0 && Math.abs(p[1] - y) < 1.0) { n++; lx = Math.min(lx, p[0]); hx = Math.max(hx, p[0]); ly = Math.min(ly, p[1]); hy = Math.max(hy, p[1]); }
        if (n) { dx.push((lx + hx) / 2 - x); dy.push((ly + hy) / 2 - y); }
      }
      if (dx.length < 3) break;
      const mdx = med(dx), mdy = med(dy);
      if (Math.abs(mdx) < 0.005 && Math.abs(mdy) < 0.005) break;
      best.ox += mdx; best.oy += mdy;
    }
    const matched = sample.filter(i => { const [x, y] = tf(i, best); return nearest(T[i.side].length ? T[i.side] : all, x, y) < 1.5; }).length / sample.length;
    return { tf: i => tf(i, best), matched, params: best };
  }
  function cplComponents(items, L, align, ftpOf) {
    const comps = new Map();
    for (const side of ["top", "bottom"]) {
      const src = L[side === "top" ? "paste-top" : "paste-bot"] || L[side === "top" ? "mask-top" : "mask-bot"];
      let pads = [];
      if (src) pads = src.objs.filter(o => o.t !== "S" && o.pol !== "C");
      else { const cu = L[side === "top" ? "cu-top" : "cu-bot"]; if (cu) pads = cu.objs.filter(o => o.t === "F"); }
      const its = items.filter(i => i.side === side).map(i => { const [x, y] = align.tf(i); return { i, x, y, r: 1 }; });
      if (!its.length) continue;
      const pc = pads.map(o => ({ o, x: (o.bb[0] + o.bb[2]) / 2, y: (o.bb[1] + o.bb[3]) / 2 }));
      const assign = new Array(pc.length).fill(-1);
      const dist = (p, c) => Math.hypot(pc[p].x - its[c].x, pc[p].y - its[c].y);
      // phase A: two-terminal parts take the most symmetric pad pair around their centroid
      const twoPin = its.map((it, c) => /^(R|C|L|FB|D|LED|F|CR|RV|VR)\d/i.test(it.i.ref) ? c : -1).filter(c => c >= 0);
      const bestPair = c => {
        const near = [];
        for (let p = 0; p < pc.length; p++) if (assign[p] < 0) { const d = dist(p, c); if (d < 3.2) near.push([d, p]); }
        near.sort((a, b) => a[0] - b[0]);
        let best = null;
        for (let a = 0; a < Math.min(near.length, 5); a++) for (let b = a + 1; b < Math.min(near.length, 6); b++) {
          const [da, pa] = near[a], [db, pb] = near[b];
          const va = [pc[pa].x - its[c].x, pc[pa].y - its[c].y], vb = [pc[pb].x - its[c].x, pc[pb].y - its[c].y];
          const cos = (va[0] * vb[0] + va[1] * vb[1]) / ((da * db) || 1e-9);
          const q = Math.abs(da - db) + (1 + cos) * Math.max(da, db) + 0.05 * (da + db);
          const third = near.filter(n => n[1] !== pa && n[1] !== pb)[0];
          const crowded = third && third[0] < 1.45 * Math.max(da, db) && third[0] - Math.max(da, db) < 0.35;
          if (!crowded && cos < -0.85 && Math.abs(da - db) < 0.25 * Math.max(da, db) + 0.12 && (!best || q < best.q)) best = { q, pa, pb };
        }
        return best;
      };
      let pending = twoPin.slice();
      for (let guard = 0; guard < 4 && pending.length; guard++) {
        const cands = pending.map(c => ({ c, b: bestPair(c) })).filter(x => x.b).sort((x, y) => x.b.q - y.b.q);
        const next = [];
        for (const { c, b } of cands) {
          if (assign[b.pa] >= 0 || assign[b.pb] >= 0) { next.push(c); continue; }
          assign[b.pa] = c; assign[b.pb] = c; its[c].fixed = true;
        }
        pending = next;
      }
      // phase A2: parts whose BOM footprint states a body size (QFN 4x4mm, LQFP-48 7x7mm...) claim the pads inside it
      its.forEach((it, c) => {
        if (it.fixed) return;
        const f = String((ftpOf && ftpOf(it.i.ref)) || "");
        const m = f.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*mm/);
        if (!m || !/QFN|DFN|QFP|LGA|BGA|SON|MLF|WSON|VQFN|UQFN|TQFP|LQFP/i.test(f)) return;
        let w = +m[1], h = +m[2];
        const quarter = Math.round(((it.i.rot % 180) + 180) % 180 / 90) === 1;
        if (quarter) [w, h] = [h, w];
        const lead = /QFP/i.test(f) ? 1.1 : 0.15;
        it.box = [w / 2 + lead, h / 2 + lead];
      });
      for (let p = 0; p < pc.length; p++) {
        if (assign[p] >= 0) continue;
        let best = -1, bd = Infinity;
        its.forEach((it, c) => { if (!it.box) return; const dx = Math.abs(pc[p].x - it.x), dy = Math.abs(pc[p].y - it.y); if (dx <= it.box[0] && dy <= it.box[1]) { const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = c; } } });
        if (best >= 0) assign[p] = best;
      }
      its.forEach(it => { if (it.box) it.fixed = true; });
      // phase B: everything else, nearest centroid weighted by each part's size
      const free = its.map((it, c) => it.fixed ? -1 : c).filter(c => c >= 0);
      const loose = []; for (let p = 0; p < pc.length; p++) if (assign[p] < 0) loose.push(p);
      if (free.length) {
        for (const c of free) its[c].r = 0.3;
        for (const p of loose) {
          let best = -1, bd = Infinity;
          for (const c of free) { const d = dist(p, c); if (d < bd) { bd = d; best = c; } }
          if (best >= 0 && bd < 8) its[best].r = Math.max(its[best].r, bd);
        }
        for (let iter = 0; iter < 4; iter++) {
          for (const p of loose) {
            let best = -1, bs = Infinity;
            for (const c of free) { const s = dist(p, c) / (its[c].r + 0.3); if (s < bs) { bs = s; best = c; } }
            assign[p] = bs <= 1.25 ? best : -1;
          }
          for (const c of free) {
            const ds = []; for (const p of loose) if (assign[p] === c) ds.push(dist(p, c));
            ds.sort((a, b) => a - b);
            let cut = ds.length - 1;
            for (let k = 0; k < ds.length - 1; k++) {
              const gap = ds[k + 1] - ds[k];
              if (gap > 0.6 && ds[k + 1] > 1.5 * ds[k] && ds.length - 1 - k <= Math.max(2, 0.6 * (k + 1))) { cut = k; break; }
            }
            if (ds.length) its[c].r = Math.max(0.3, ds[cut]);
          }
        }
      }
      // phase C: parts with no paste (through-hole) take large copper pads near them
      const empty = its.map((it, c) => c).filter(c => !assign.includes(c));
      const cu = L[side === "top" ? "cu-top" : "cu-bot"];
      const tht = new Map();
      if (empty.length && cu) {
        const big = cu.objs.filter(o => o.t === "F" && Math.min(o.bb[2] - o.bb[0], o.bb[3] - o.bb[1]) >= 0.9 && !pc.some(q => q.x > o.bb[0] && q.x < o.bb[2] && q.y > o.bb[1] && q.y < o.bb[3]));
        for (const o of big) {
          const x = (o.bb[0] + o.bb[2]) / 2, y = (o.bb[1] + o.bb[3]) / 2;
          let best = -1, bd = 6;
          for (const c of empty) { const d = Math.hypot(x - its[c].x, y - its[c].y); if (d < bd) { bd = d; best = c; } }
          if (best >= 0) { if (!tht.has(best)) tht.set(best, []); tht.get(best).push(o); }
        }
      }
      its.forEach((it, c) => {
        const ref = it.i.ref;
        const comp = comps.get(ref) || { ref, sides: {}, paste: {}, smd: true, tht: false, src: "cpl", cpl: it.i };
        const s = { pads: [], silk: "", bb: newBB(), center: [it.x, it.y] };
        for (let p = 0; p < pc.length; p++) if (assign[p] === c) { const o = pc[p].o; s.pads.push({ d: o.d, pin: "", name: "", net: "", bb: o.bb }); bbGrow(s.bb, o.bb[0], o.bb[1]); bbGrow(s.bb, o.bb[2], o.bb[3]); }
        for (const o of tht.get(c) || []) { s.pads.push({ d: o.d, pin: "", name: "", net: "", bb: o.bb }); bbGrow(s.bb, o.bb[0], o.bb[1]); bbGrow(s.bb, o.bb[2], o.bb[3]); }
        if (!s.pads.length) { s.bb = [it.x - 0.5, it.y - 0.5, it.x + 0.5, it.y + 0.5]; }
        comp.sides[side] = s;
        comp.paste[side] = !!src && s.pads.length > 0 && !tht.has(c);
        comps.set(ref, comp);
      });
    }
    return comps;
  }

  /* ---------- BOM ---------- */
  function parseBOM(bom) {
    const { rows, h } = bom; const lines = [];
    for (let r = h.r + 1; r < rows.length; r++) {
      const row = rows[r];
      const refs = splitRefs(row[h.d]);
      if (!refs.length) continue;
      lines.push({
        val: (h.v >= 0 ? row[h.v] : "") || "", ftp: (h.f >= 0 ? row[h.f] : "") || "",
        lcsc: ((h.l >= 0 ? row[h.l] : "") || "").trim(), qty: h.q >= 0 ? parseInt(row[h.q], 10) : NaN, refs, line: r + 1,
      });
    }
    return lines;
  }
  const PREFIX_NAME = { C: "Capacitors", R: "Resistors", L: "Inductors", D: "Diodes", LED: "LEDs", U: "ICs", IC: "ICs", Q: "Transistors", J: "Connectors", P: "Connectors", CN: "Connectors", Y: "Crystals", X: "Crystals", F: "Fuses", FB: "Ferrite beads", SW: "Switches", S: "Switches", TP: "Test points", K: "Relays", BT: "Batteries", RN: "Resistor arrays", ANT: "Antennas", AE: "Antennas", MH: "Mounting holes", H: "Holes", FID: "Fiducials" };
  const prefixOf = r => (r.match(/^[A-Za-z_]+/) || [""])[0].toUpperCase();
  const refSort = (a, b) => { const pa = prefixOf(a), pb = prefixOf(b); if (pa !== pb) return pa < pb ? -1 : 1; return (parseInt(a.replace(/^\D+/, ""), 10) || 0) - (parseInt(b.replace(/^\D+/, ""), 10) || 0); };
  function prettyFootprint(f) {
    f = String(f || "").trim(); if (!f) return "";
    f = f.replace(/^[^:]*:/, "");
    const kinds = { C: "capacitor", R: "resistor", L: "inductor", D: "diode", LED: "LED", CP: "polarized capacitor", FB: "ferrite bead", F: "fuse" };
    const m = f.match(/^(C|R|L|D|LED|CP|FB|F)_(\d{4})_\d{4}Metric/i);
    if (m) return `${m[2]} ${kinds[m[1].toUpperCase()] || ""}`.trim();
    return f.replace(/_\d{4}Metric/g, "").replace(/_/g, " ");
  }
  const SIZE_CODES = { "0201": [0.35, 0.75], "0402": [0.75, 1.3], "0603": [1.3, 1.85], "0805": [1.8, 2.5], "1206": [2.6, 3.8], "1210": [2.6, 3.8], "2512": [5, 7.5] };
  function padSpan(side) {
    if (!side || side.pads.length !== 2) return null;
    const c = side.pads.map(p => [(p.bb[0] + p.bb[2]) / 2, (p.bb[1] + p.bb[3]) / 2]);
    return Math.hypot(c[0][0] - c[1][0], c[0][1] - c[1][1]);
  }
  const padSig = c => { const s = c.sides.top || c.sides.bottom; if (!s) return ""; return s.pads.length + ":" + s.pads.map(p => f3(p.bb[2] - p.bb[0]) + "x" + f3(p.bb[3] - p.bb[1])).map(v => v.split("x").map(Number).sort().join("x")).sort().join(","); };

  /* ---------- main build ---------- */
  async function build(staged, onStep) {
    const set = staged.set;
    if (!set) throw new Error("No gerber layers found. Drop the gerber zip you uploaded to JLCPCB (or the production zip JLC sends back).");
    onStep && onStep("Parsing gerbers");
    const L = {}; const warn = [];
    let tool = "", project = "";
    let inner = 0;
    const outlineRank = l => l.ff && /^Profile/i.test(l.ff) ? 0 : /\.gko$/i.test(l.path) ? 1 : /\.gm1$/i.test(l.path) ? 2 : /edge_cuts|outline|profile/i.test(l.path) ? 3 : 4;
    const ordered = set.layers.slice().sort((a, b) => (a.role === "outline" && b.role === "outline") ? outlineRank(a) - outlineRank(b) : 0);
    for (const layer of ordered) {
      if (layer.role === "cu-in") { inner++; continue; }
      if (!["cu-top", "cu-bot", "mask-top", "mask-bot", "silk-top", "silk-bot", "paste-top", "paste-bot", "outline"].includes(layer.role)) continue;
      if (L[layer.role]) continue;
      const g = parseGerber(layer.text);
      g.path = layer.path;
      if (layer.role === "outline" && !g.objs.length) continue;
      L[layer.role] = g;
      if (!tool && g.fileAttrs.GenerationSoftware) tool = g.fileAttrs.GenerationSoftware.slice(0, 2).join(" ");
      if (!project && g.fileAttrs.ProjectId) project = g.fileAttrs.ProjectId[0];
      g.warnings.forEach(w => warn.push(w));
    }
    if (!L["cu-top"] && !L["cu-bot"]) throw new Error("The gerber set has no top or bottom copper layer.");
    const drills = set.drills.map(d => ({ path: d.path, ...parseDrill(d.text) }));

    // outline + bounds
    let loops = L.outline ? buildOutline(L.outline.objs) : [];
    const bb = newBB();
    if (loops.length && L.outline) { const ob = L.outline.bb; bbGrow(bb, ob[0], ob[1]); bbGrow(bb, ob[2], ob[3]); }
    else { for (const k of ["cu-top", "cu-bot", "silk-top", "mask-top"]) if (L[k] && isFinite(L[k].bb[0])) { bbGrow(bb, L[k].bb[0], L[k].bb[1]); bbGrow(bb, L[k].bb[2], L[k].bb[3]); } }
    if (!loops.length) loops = [{ d: `M${f3(bb[0])} ${f3(bb[1])}H${f3(bb[2])}V${f3(bb[3])}H${f3(bb[0])}Z`, area: (bb[2] - bb[0]) * (bb[3] - bb[1]), pts: [] }];
    const outlineD = loops.map(l => l.d).join("");
    const bounds = bb;
    const W = bounds[2] - bounds[0], H = bounds[3] - bounds[1];

    onStep && onStep("Drawing layers");
    const sides = {};
    for (const [side, s] of [["top", "t"], ["bottom", "b"]]) {
      const R = makeRenderer(bounds, s);
      const cu = L[side === "top" ? "cu-top" : "cu-bot"];
      const mask = L[side === "top" ? "mask-top" : "mask-bot"];
      const paste = L[side === "top" ? "paste-top" : "paste-bot"];
      const silk = L[side === "top" ? "silk-top" : "silk-bot"];
      let body = `<path class="sub" fill-rule="evenodd" d="${outlineD}"/>`;
      if (cu) {
        body += `<g id="cu-${s}" class="lyr-cu">${R.render(cu.objs, "cu-f", "cu-s")}</g>`;
        const open = mask || paste;
        if (open) {
          R.defs.push(`<mask id="open-${s}" maskUnits="userSpaceOnUse" ${R.big}><rect ${R.big} fill="#000"/>${R.render(open.objs, "opn-f", "opn-s")}</mask>`);
          body += `<g class="lyr-pads" mask="url(#open-${s})"><use href="#cu-${s}" class="hasl"/></g>`;
        } else {
          body += `<g class="lyr-pads">${R.render(cu.objs.filter(o => o.t === "F"), "pad-f", "pad-s")}</g>`;
        }
      }
      if (silk) body += `<g class="lyr-silk">${R.render(silk.objs, "silk-f", "silk-s")}</g>`;
      let holes = "";
      for (const d of drills) {
        for (const h of d.holes) if (d.npth || (h.fn ? !/via/i.test(h.fn) : h.d >= 0.5)) holes += `<circle cx="${f3(h.x)}" cy="${f3(h.y)}" r="${f3(h.d / 2)}"/>`;
        for (const sl of d.slots) holes += `<path class="slot" stroke-width="${f3(sl.d)}" d="M${f3(sl.x1)} ${f3(sl.y1)}L${f3(sl.x2)} ${f3(sl.y2)}"/>`;
      }
      if (holes) body += `<g class="holes">${holes}</g>`;
      if (L.outline) body += `<g class="edge">${R.render(L.outline.objs.filter(o => o.t === "S"), "edge-f", "edge-s")}</g>`;
      sides[side] = (R.defs.length ? `<defs>${R.defs.join("")}</defs>` : "") + body;
    }

    // components
    onStep && onStep("Locating parts");
    const checks = [];
    let comps = x2Components(L);
    let mode = comps.size ? "x2" : "none";
    const cplFile = staged.cpls[0] || null;
    let cplItems = cplFile ? parseCPL(cplFile) : [];
    if (mode === "x2") {
      addSilk(comps, L);
      if (cplItems.length) {
        const targets = { top: [], bottom: [] };
        for (const c of comps.values()) for (const side of ["top", "bottom"]) if (c.sides[side]) { const b = c.sides[side].bb; targets[side].push([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]); }
        const al = alignCPL(cplItems, targets, bounds);
        if (al && al.matched > 0.5) {
          const off = [];
          for (const i of cplItems) {
            const c = comps.get(i.ref);
            if (!c) continue;
            const s = c.sides[i.side];
            if (!s) { off.push(`${i.ref} (CPL says ${i.side}, pads are on the ${i.side === "top" ? "bottom" : "top"})`); continue; }
            const [x, y] = al.tf(i); const b = s.bb;
            if (x < b[0] - 0.6 || x > b[2] + 0.6 || y < b[1] - 0.6 || y > b[3] + 0.6) off.push(i.ref);
          }
          if (off.length) checks.push({ level: "warn", text: `CPL position doesn't land on the part's pads for ${listRefs(off)}. Check these before ordering assembly.`, refs: off.map(o => o.split(" ")[0]) });
          const missing = [...comps.values()].filter(c => c.smd && Object.values(c.paste).some(Boolean) && !cplItems.some(i => i.ref === c.ref)).map(c => c.ref);
          if (missing.length) checks.push({ level: "warn", text: `No CPL position for ${listRefs(missing)}, though the board has paste pads for ${missing.length > 1 ? "them" : "it"}.`, refs: missing });
        } else if (al) {
          checks.push({ level: "warn", text: `The CPL file (${cplFile.name}) didn't line up with the pads, so it was left out of the checks.`, refs: [] });
        }
      }
    } else if (cplItems.length) {
      const targets = { top: [], bottom: [] };
      for (const [role, side] of [["paste-top", "top"], ["paste-bot", "bottom"], ["mask-top", "top"], ["mask-bot", "bottom"]]) {
        if (!L[role] || targets[side].length) continue;
        for (const o of L[role].objs) if (o.t !== "S") targets[side].push([(o.bb[0] + o.bb[2]) / 2, (o.bb[1] + o.bb[3]) / 2]);
      }
      if (!targets.top.length && L["cu-top"]) L["cu-top"].objs.forEach(o => { if (o.t === "F") targets.top.push([(o.bb[0] + o.bb[2]) / 2, (o.bb[1] + o.bb[3]) / 2]); });
      const al = alignCPL(cplItems, targets, bounds);
      if (al) {
        const ftpMap = new Map();
        if (staged.boms[0]) for (const l of parseBOM(staged.boms[0])) for (const r of l.refs) ftpMap.set(r, l.ftp + " " + l.val);
        for (const i of cplItems) if (!ftpMap.has(i.ref) && i.pkg) ftpMap.set(i.ref, i.pkg);
        comps = cplComponents(cplItems, L, al, r => ftpMap.get(r));
        mode = "cpl";
        checks.push({ level: "info", text: `These gerbers carry no pad-to-part data, so parts were placed from the CPL file. Pin 1 and net names aren't available.`, refs: [] });
        if (al.matched < 0.6) checks.push({ level: "warn", text: `Only ${Math.round(al.matched * 100)}% of CPL positions landed on pads. The CPL may use a different origin than the gerbers, so part highlights could be off.`, refs: [] });
      }
    }
    if (mode === "none") checks.push({ level: "warn", text: cplFile ? "Couldn't match the CPL file to the board." : "These gerbers don't say which pad belongs to which part. Add the CPL (pick-and-place) file to locate parts.", refs: [] });

    // BOM rows
    onStep && onStep("Matching the BOM");
    const bomFile = staged.boms[0] || null;
    let rows = [];
    const onBoard = r => comps.has(r);
    if (bomFile) {
      let lines = parseBOM(bomFile);
      // duplicates across lines
      const seen = new Map(); const dups = new Set();
      lines.forEach((l, li) => l.refs.forEach(r => { if (seen.has(r) && seen.get(r) !== li) dups.add(r); else seen.set(r, li); }));
      if (dups.size) checks.push({ level: "error", text: `${listRefs([...dups])} appear${dups.size > 1 ? "" : "s"} on more than one BOM line.`, refs: [...dups] });
      // qty mismatch
      for (const l of lines) if (!isNaN(l.qty) && l.qty !== l.refs.length) checks.push({ level: "warn", text: `BOM line ${l.val || l.line}: quantity says ${l.qty} but ${l.refs.length} designator${l.refs.length > 1 ? "s are" : " is"} listed.`, refs: l.refs });
      // merge lines sharing an LCSC part
      const merged = []; const byL = new Map();
      for (const l of lines) {
        const k = l.lcsc && /^C\d+$/i.test(l.lcsc) ? l.lcsc.toUpperCase() : null;
        if (k && byL.has(k)) { const m = byL.get(k); m.refs.push(...l.refs.filter(r => !m.refs.includes(r))); m.vals.push(l.val); }
        else { const m = { ...l, vals: [l.val], refs: [...l.refs] }; merged.push(m); if (k) byL.set(k, m); }
      }
      for (const m of merged) if (m.vals.length > 1) {
        const uniq = [...new Set(m.vals)];
        m.note = `Your BOM lists this part on ${m.vals.length} lines${uniq.length > 1 ? ` (${uniq.join(", ")})` : ""}. Same LCSC part, so one strip covers all of them.`;
        checks.push({ level: "info", text: `Merged ${m.vals.length} BOM lines that use the same LCSC part ${m.lcsc}.`, refs: m.refs });
      }
      const inBom = new Set(merged.flatMap(m => m.refs));
      const notInBom = [...comps.keys()].filter(r => !inBom.has(r));
      const used = new Set();
      for (const m of merged) {
        const row = { val: m.vals[0] || "(no value)", kind: prettyFootprint(m.ftp), ftp: m.ftp, lcsc: m.lcsc && /^C\d+$/i.test(m.lcsc) ? m.lcsc.toUpperCase() : "", refs: [], missing: [], note: m.note || "", warn: false, subs: [] };
        for (const r of m.refs) {
          if (onBoard(r)) { row.refs.push(r); continue; }
          // look for a same-footprint stand-in that the BOM doesn't mention
          const sib = m.refs.find(x => onBoard(x));
          let sub = null;
          if (sib && mode !== "none") {
            const sig = padSig(comps.get(sib)), pre = prefixOf(r);
            const cands = notInBom.filter(x => !used.has(x) && prefixOf(x) === pre && padSig(comps.get(x)) === sig);
            if (cands.length === 1) sub = cands[0];
          }
          if (sub) { used.add(sub); row.refs.push(sub); row.subs.push([r, sub]); row.warn = true; }
          else row.missing.push(r);
        }
        if (row.subs.length) {
          const t = row.subs.map(([a, b]) => `${a} isn't on the board, but ${b} has the same pads and isn't in the BOM, so ${b} is shown here`).join(". ");
          row.note = (row.note ? row.note + " " : "") + t + ".";
          checks.push({ level: "error", text: row.subs.map(([a, b]) => `BOM lists ${a}, which isn't on the board. ${b} has matching pads and no BOM line, so it's treated as ${a}.`).join(" "), refs: row.subs.map(s => s[1]) });
        }
        if (row.missing.length) {
          row.warn = true;
          row.note = (row.note ? row.note + " " : "") + `${listRefs(row.missing)} ${row.missing.length > 1 ? "aren't" : "isn't"} on the board.`;
          if (mode !== "none") checks.push({ level: "error", text: `BOM line ${row.val}: ${listRefs(row.missing)} ${row.missing.length > 1 ? "aren't" : "isn't"} on the board.`, refs: [] });
        }
        row.refs.sort(refSort);
        // footprint size vs pads
        const code = (String(m.ftp).match(/(?:^|[^0-9])(0201|0402|0603|0805|1206|1210|2512)(?![0-9])/) || [])[1];
        if (code && mode !== "none") {
          const [lo, hi] = SIZE_CODES[code]; const bad = [];
          for (const r of row.refs) { const c = comps.get(r); const sp = c && padSpan(c.sides.top || c.sides.bottom); if (sp && (sp < lo * 0.8 || sp > hi * 1.2)) bad.push(r); }
          if (bad.length) checks.push({ level: "warn", text: `${listRefs(bad)}: BOM says ${code}, but the pad spacing on the board looks like a different size.`, refs: bad });
        }
        if (row.refs.length || row.missing.length) rows.push(row);
      }
      const leftover = notInBom.filter(r => !used.has(r)).sort(refSort);
      const withPaste = leftover.filter(r => { const c = comps.get(r); return Object.values(c.paste).some(Boolean); });
      const noPaste = leftover.filter(r => !withPaste.includes(r));
      if (withPaste.length) {
        rows.push({ val: "Paste pads, no BOM line", kind: "Maybe DNP", refs: withPaste, info: true, note: "These have solder paste openings but nothing in the BOM. If they're meant to stay empty, ignore this line." });
        checks.push({ level: "warn", text: `${listRefs(withPaste)} ${withPaste.length > 1 ? "have" : "has"} paste pads but no BOM line.`, refs: withPaste });
      }
      if (noPaste.length) checks.push({ level: "info", text: `${listRefs(noPaste)} ${noPaste.length > 1 ? "are" : "is"} on the board but not in the BOM, with no paste pads (through-hole or bare pads).`, refs: noPaste });
      if (noPaste.length) rows.push({ val: "Not in the BOM", kind: "No paste: through-hole or bare pads", refs: noPaste, info: true, note: "Solder these by hand after reflow, or leave them if they're test or jumper pads." });
    } else {
      // no BOM: use CPL values if present, else group by designator letter
      const byKey = new Map();
      const cplBy = new Map(cplItems.map(i => [i.ref, i]));
      for (const r of [...comps.keys()].sort(refSort)) {
        const ci = cplBy.get(r);
        let key, val, kind;
        if (ci && (ci.val || ci.pkg)) { key = ci.val + "|" + ci.pkg; val = ci.val || prefixOf(r) + " parts"; kind = prettyFootprint(ci.pkg); }
        else { const p = prefixOf(r); key = p; val = PREFIX_NAME[p] ? `${PREFIX_NAME[p]}` : `${p} parts`; kind = "No BOM loaded"; }
        if (!byKey.has(key)) byKey.set(key, { val, kind, lcsc: "", refs: [], note: "" });
        byKey.get(key).refs.push(r);
      }
      rows = [...byKey.values()];
      if (comps.size) checks.push({ level: "info", text: "No BOM loaded, so parts are grouped by designator letter. Drop your BOM (CSV or XLSX) to see values and LCSC numbers.", refs: [] });
    }
    // polarity (pin 1 shown only when pin numbers are known)
    for (const row of rows) {
      if (row.info || mode !== "x2") { row.polar = false; continue; }
      row.polar = row.refs.some(r => {
        const c = comps.get(r); if (!c) return false;
        const s = c.sides.top || c.sides.bottom; const n = s ? new Set(s.pads.map(p => p.pin)).size : 0;
        const p = prefixOf(r);
        return n >= 3 || (n === 2 && /^(D|LED|CR)$/.test(p)) || /CP_|tantal|elec|polar/i.test(row.ftp || "");
      });
    }

    // meta
    const order = staged.order;
    const cuCount = (L["cu-top"] ? 1 : 0) + (L["cu-bot"] ? 1 : 0) + inner;
    const counts = { top: 0, bottom: 0 };
    for (const c of comps.values()) { if (c.sides.top) counts.top++; if (c.sides.bottom) counts.bottom++; }
    if (warn.length) checks.push({ level: "info", text: `Some gerber features were simplified: ${[...new Set(warn)].join(", ")}.`, refs: [] });
    const name = project || (order && order.name) || (set.dir.split("/").filter(Boolean).pop() || "board").replace(/\.zip$/i, "");
    const compList = [...comps.values()].map(c => {
      const out = { ref: c.ref, sides: {}, paste: c.paste };
      for (const side of ["top", "bottom"]) {
        const s = c.sides[side]; if (!s) continue;
        out.sides[side] = { bb: s.bb.map(v => Math.round(v * 1000) / 1000), pads: s.pads.map(p => (globalThis.POKE_DEBUG ? { d: p.d, pin: p.pin, name: p.name, net: p.net, bb: p.bb } : { d: p.d, pin: p.pin, name: p.name, net: p.net })), silk: s.silk || "" };
      }
      return out;
    });
    const hasNets = compList.some(c => Object.values(c.sides).some(s => s.pads.some(p => p.net)));
    return {
      v: 1,
      name, mode, hasNets,
      meta: { w: W, h: H, cu: cuCount, tool, source: set.dir.replace(/\/$/, ""), counts, bom: bomFile ? bomFile.name : "", cpl: cplFile ? cplFile.name : "" },
      order: order || null,
      bounds, outline: outlineD,
      sides, comps: compList, rows, checks,
      hash: hashStr(outlineD + compList.map(c => c.ref).join(",") + (L["cu-top"] ? L["cu-top"].objs.length : 0)),
    };
  }
  function listRefs(a) { a = [...new Set(a)]; if (a.length <= 1) return a.join(""); if (a.length <= 6) return a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; return a.slice(0, 5).join(", ") + ` and ${a.length - 5} more`; }
  function hashStr(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); }

  const summary = {
    bomLines: b => parseBOM(b).length,
    cplCount: c => parseCPL(c).length,
    hasPadData: set => set.layers.some(l => (l.role === "cu-top" || l.role === "cu-bot") && /TO\.P,/.test(l.text)),
    tool: set => { const l = set.layers.find(x => x.tool); return l ? l.tool.replace(/,.*$/, "").replace(/\(.*$/, "").trim() : ""; },
  };
  return { scan, build, roleFromName, classifyTable, splitRefs, summary };
})();
if (typeof module !== "undefined") module.exports = PokeBoard;
