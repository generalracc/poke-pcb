/* ---------- poke~pcb: app ---------- */
(() => {
  const $ = id => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* pristine copy of this page, for "Save offline copy" */
  const PRISTINE = (() => {
    const root = document.documentElement.cloneNode(true);
    root.querySelectorAll("head > *:not([data-poke]), body > *:not([data-poke])").forEach(n => n.remove());
    root.querySelectorAll("#poke-data").forEach(n => n.remove());
    return "<!doctype html>\n" + root.outerHTML;
  })();

  /* ---------- small UI helpers ---------- */
  function toast(msg, ms = 2600) {
    const t = $("toast"); t.textContent = msg; t.classList.add("on");
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), ms);
  }
  async function saveFile(filename, data) {
    if (window.claude && typeof window.claude.use === "function") {
      let dl = null;
      try { dl = await window.claude.use("downloads"); } catch (e) { dl = null; }
      if (dl) {
        try { await dl.save({ filename, data }); toast(`Saved ${filename}`); }
        catch (e) {
          const code = e && e.code;
          if (code === "declined") return;
          if (code === "rate_limited") toast("A save prompt is already open.");
          else toast("Couldn't save the file in this view.");
        }
        return;
      }
    }
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } },
  };

  /* =========================================================
     Staging (landing screen)
     ========================================================= */
  let groups = [];   // {label, files, res}
  let gid = 0;
  const landing = $("landing"), app = $("app");

  async function addGroup(label, files) {
    if (!files.length) return;
    $("errBox").textContent = "";
    $("busy").textContent = `Reading ${label}…`;
    $("openBtn").disabled = true;
    let res;
    try { res = await PokeBoard.scan(files, s => { $("busy").textContent = s + "…"; }); }
    catch (e) { $("busy").textContent = ""; $("errBox").textContent = `Couldn't read ${label}: ${e.message}`; renderStaged(); return null; }
    const g = { id: ++gid, label, files, res };
    // a new gerber set replaces the previous one; a new BOM/CPL takes priority over older ones
    if (res.set) groups = groups.filter(x => !x.res.set || x.res.boms.length || x.res.cpls.length ? true : false).map(x => x.res.set ? { ...x, res: { ...x.res, set: null } } : x);
    groups.push(g);
    $("busy").textContent = "";
    renderStaged();
    return g;
  }
  function merged() {
    const rev = groups.slice().reverse();
    const withSet = rev.find(g => g.res.set);
    return {
      set: withSet ? withSet.res.set : null,
      setGroup: withSet || null,
      boms: rev.flatMap(g => g.res.boms),
      cpls: rev.flatMap(g => g.res.cpls),
      order: (rev.find(g => g.res.order) || { res: {} }).res.order || null,
      notes: [...new Map(groups.flatMap(g => g.res.notes).map(n => [n.text, n])).values()],
    };
  }
  const OK = `<span class="st"><svg viewBox="0 0 14 14"><path d="M3 7.4l2.6 2.6L11 4.4"/></svg></span>`;
  const OPT = `<span class="st"></span>`;
  function renderStaged() {
    const m = merged();
    const ul = $("staged");
    let h = "";
    const rm = g => g ? `<button type="button" class="x" data-rm="${g.id}">Remove</button>` : "";
    const groupOf = item => groups.find(g => g.res.boms.includes(item) || g.res.cpls.includes(item));
    if (m.set) {
      const n = m.set.layers.length, d = m.set.drills.length;
      const pad = PokeBoard.summary.hasPadData(m.set);
      const tool = PokeBoard.summary.tool(m.set);
      const folder = m.set.dir.split("/").filter(Boolean).pop() || m.setGroup.label;
      h += `<li class="ok">${OK}<div><b>Gerbers</b><div class="d">${esc(folder)}: ${n} layer${n === 1 ? "" : "s"}, ${d} drill file${d === 1 ? "" : "s"}${tool ? ", " + esc(tool) : ""}. ${pad ? "Has pad-to-part data, so parts can be located exactly." : "No pad-to-part data. Add the CPL file to locate parts."}</div></div>${rm(m.setGroup)}</li>`;
    } else {
      h += `<li class="${groups.length ? "bad" : "opt"}">${groups.length ? `<span class="st"></span>` : OPT}<div><b>Gerbers</b><div class="d">${groups.length ? "No gerber layers found yet. Drop the gerber zip you uploaded to JLC, or the production zip JLC sent back." : "Needed. The zip you uploaded to JLC works, and so does the production zip JLC sends back."}</div></div></li>`;
    }
    if (m.boms.length) {
      const b = m.boms[0];
      h += `<li class="ok">${OK}<div><b>BOM</b><div class="d">${esc(b.name)}: ${PokeBoard.summary.bomLines(b)} lines${m.boms.length > 1 ? `. Using the newest of ${m.boms.length} BOM files.` : ""}</div></div>${rm(groupOf(b))}</li>`;
    } else h += `<li class="opt">${OPT}<div><b>BOM</b> <span class="d">(optional)</span><div class="d">Adds values and LCSC numbers, and checks them against the board.</div></div></li>`;
    const padData = m.set && PokeBoard.summary.hasPadData(m.set);
    if (m.cpls.length) {
      const c = m.cpls[0];
      h += `<li class="ok">${OK}<div><b>Pick-and-place (CPL)</b><div class="d">${esc(c.name)}: ${PokeBoard.summary.cplCount(c)} positions${padData ? ", used to double-check placement" : ""}.</div></div>${rm(groupOf(c))}</li>`;
    } else h += `<li class="opt">${OPT}<div><b>Pick-and-place (CPL)</b> <span class="d">(${padData ? "optional" : m.set ? "needed for these gerbers" : "optional"})</span><div class="d">${padData ? "Your gerbers already locate every part. A CPL adds a position check." : "Locates parts when the gerbers don't say which pad belongs to which part."}</div></div></li>`;
    if (m.order) {
      const o = m.order; const bits = [o.mask && `${o.mask} mask`, o.finishLabel, o.thickness && `${o.thickness} mm`, o.layers && `${o.layers} layers`].filter(Boolean);
      h += `<li class="ok">${OK}<div><b>JLC order ${esc(o.po)}</b><div class="d">${esc(bits.join(", "))}. The board is drawn in these colours.</div></div></li>`;
    }
    ul.innerHTML = h;
    $("notes").innerHTML = m.notes.map(n => `<li class="${n.level}">${esc(n.text)}</li>`).join("");
    $("openBtn").disabled = !m.set;
  }
  $("staged").addEventListener("click", e => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    groups = groups.filter(g => g.id !== +b.dataset.rm);
    renderStaged();
  });

  async function filesFromDataTransfer(dt) {
    const items = dt.items ? [...dt.items] : [];
    const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length && entries.some(e => e.isDirectory)) {
      const out = [];
      const walk = async (entry, prefix) => {
        if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); out.push({ name: f.name, path: prefix + f.name, blob: f }); }
        else if (entry.isDirectory) {
          const reader = entry.createReader();
          let batch;
          do { batch = await new Promise((res, rej) => reader.readEntries(res, rej)); for (const c of batch) await walk(c, prefix + entry.name + "/"); } while (batch.length);
        }
      };
      for (const e of entries) await walk(e, "");
      return out;
    }
    return [...(dt.files || [])].map(f => ({ name: f.name, path: f.name, blob: f }));
  }
  const labelFor = files => files.length === 1 ? files[0].name : (files[0].path.includes("/") ? files[0].path.split("/")[0] + "/" : `${files.length} files`);
  async function ingest(files) {
    if (!files.length) return null;
    // zips each get their own group; loose files go together (so a folder of gerbers stays one set)
    const zips = files.filter(f => /\.zip$/i.test(f.name)), loose = files.filter(f => !/\.zip$/i.test(f.name));
    const added = [];
    for (const z of zips) { const g = await addGroup(z.name, [z]); if (g) added.push(g); }
    if (loose.length) { const g = await addGroup(labelFor(loose), loose); if (g) added.push(g); }
    return added;
  }

  const drop = $("drop");
  $("pickFiles").onclick = e => { e.stopPropagation(); $("fileIn").click(); };
  $("pickFolder").onclick = e => { e.stopPropagation(); $("dirIn").click(); };
  drop.onclick = () => $("fileIn").click();
  drop.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fileIn").click(); } };
  $("fileIn").onchange = async e => { const fs = [...e.target.files].map(f => ({ name: f.name, path: f.name, blob: f })); e.target.value = ""; await afterIngest(await ingest(fs)); };
  $("dirIn").onchange = async e => { const fs = [...e.target.files].map(f => ({ name: f.name, path: f.webkitRelativePath || f.name, blob: f })); e.target.value = ""; await afterIngest(await ingest(fs)); };
  $("openBtn").onclick = () => openFromStaging();

  // window-wide drag and drop
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
  window.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; if (!app.hidden) $("veil").hidden = false; else drop.classList.add("over"); });
  window.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) { $("veil").hidden = true; drop.classList.remove("over"); } });
  window.addEventListener("drop", async e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; $("veil").hidden = true; drop.classList.remove("over");
    const files = await filesFromDataTransfer(e.dataTransfer);
    await afterIngest(await ingest(files));
  });
  async function afterIngest(added) {
    if (!added || !added.length) return;
    if (!app.hidden) {
      // already looking at a board: rebuild in place
      if (merged().set) { await openFromStaging(true); toast(`Updated with ${added.map(g => g.label).join(", ")}`); }
      else toast("No gerbers found in those files.");
    }
  }

  async function openFromStaging(keepView) {
    const m = merged();
    if (!m.set) return;
    $("openBtn").disabled = true; $("errBox").textContent = "";
    try {
      const p = await PokeBoard.build(m, s => { $("busy").textContent = s + "…"; });
      $("busy").textContent = "";
      openProject(p, keepView);
    } catch (e) {
      console.error(e);
      $("busy").textContent = "";
      $("errBox").textContent = e.message || String(e);
      landing.hidden = false; app.hidden = true;
    }
    $("openBtn").disabled = !merged().set;
  }

  /* =========================================================
     Assembly view
     ========================================================= */
  const svg = $("pcb"), world = $("world");
  const stTop = $("static-top"), stBot = $("static-bottom"), ovTop = $("ov-top"), ovBot = $("ov-bottom"), labels = $("labels");
  const viewer = $("viewer"), tip = $("tip"), list = $("list"), qIn = $("q");
  const LOOKS = {
    green: { mask: "#1D5A38", cu: "#2C7349", silk: "#F1F2EC" },
    black: { mask: "#0E1112", cu: "#1F2629", silk: "#ECEDE8" },
    blue: { mask: "#1B3C75", cu: "#2A5292", silk: "#F0F2F5" },
    red: { mask: "#8A1E1E", cu: "#A6302D", silk: "#F3EEEA" },
    yellow: { mask: "#C49A1F", cu: "#D3AE3F", silk: "#FAFAF5" },
    white: { mask: "#E7E8E3", cu: "#D3D6CF", silk: "#1C1F21" },
    purple: { mask: "#482A6B", cu: "#5C3A86", silk: "#F0EDF3" },
  };
  const FINISH = { hasl: "#C3C7CA", enig: "#D8B25E", osp: "#C9855A" };

  let P = null, comps = {}, ROWS = [], refRow = {}, TRACKED = [];
  let placed = new Set(), boardNo = 1, boards = 1, look = null;
  let side = "top", rot = 0, pinned = null, preview = null, boardHover = null, filter = "all", query = "";
  let netMode = false, netHi = null;
  let X0 = 0, Y0 = 0, X1 = 1, Y1 = 1, SX = 1, CX = 0, CY = 0;
  let cmpEls = { top: {}, bottom: {} }, lblEls = { top: {}, bottom: {} }, netEls = { top: new Map(), bottom: new Map() };
  let view = { x: 0, y: 0, w: 10, h: 10 };
  let tab = "parts";

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const area = bb => (bb[2] - bb[0]) * (bb[3] - bb[1]);
  function rect(parent, cls, bb, pad, r) {
    return el("rect", { class: cls, x: bb[0] - pad, y: bb[1] - pad, width: bb[2] - bb[0] + 2 * pad, height: bb[3] - bb[1] + 2 * pad, rx: r }, parent);
  }
  const keyP = k => `poke:${P.hash}:${k}`;

  function openProject(p, keepView) {
    const sameBoard = P && P.hash === p.hash;
    P = p;
    comps = {}; P.comps.forEach(c => comps[c.ref] = c);
    ROWS = P.rows; refRow = {};
    ROWS.forEach((r, i) => r.refs.forEach(ref => { if (!(ref in refRow) || !r.info) refRow[ref] = i; }));
    TRACKED = [...new Set(ROWS.filter(r => !r.info).flatMap(r => r.refs))];
    [X0, Y0, X1, Y1] = P.bounds; SX = X0 + X1; CX = SX / 2; CY = -(Y0 + Y1) / 2;
    if (!sameBoard) { side = "top"; rot = 0; pinned = null; preview = null; filter = "all"; query = ""; qIn.value = ""; netMode = false; }
    netHi = null; boardHover = null;
    boards = store.get(keyP("n"), 1);
    boardNo = Math.min(store.get(keyP("cur"), 1), boards);
    loadPlaced();
    look = store.get(keyP("look"), null) || { mask: (P.order && P.order.mask) || "green" };
    // header
    $("bName").textContent = P.name;
    document.title = `${P.name} · poke~pcb`;
    const m = P.meta, o = P.order;
    const bits = [`${m.w.toFixed(1)} × ${m.h.toFixed(1)} mm`, `${m.cu} layer${m.cu === 1 ? "" : "s"}`];
    if (m.tool) bits.push(m.tool.replace(/,.*$/, ""));
    let meta = bits.join(", ");
    if (o && o.po) meta += `. JLC order ${o.po}${o.mask ? `, ${o.mask} mask` : ""}${o.finishLabel ? `, ${o.finishLabel}` : ""}${o.thickness ? `, ${o.thickness} mm` : ""}`;
    meta += m.bom ? `. BOM: ${m.bom}` : ". No BOM loaded";
    $("bMeta").textContent = meta;
    renderBoardSel();
    // svg
    const TF = { top: "scale(1,-1)", bottom: `matrix(-1,0,0,-1,${SX},0)` };
    stTop.setAttribute("transform", TF.top); ovTop.setAttribute("transform", TF.top);
    stBot.setAttribute("transform", TF.bottom); ovBot.setAttribute("transform", TF.bottom);
    stTop.innerHTML = P.sides.top; stBot.innerHTML = P.sides.bottom;
    buildOverlay();
    applyLook();
    // toolbar state
    $("tgNet").hidden = !P.hasNets; $("lgNet").hidden = !(P.hasNets && netMode);
    $("tgNet").setAttribute("aria-pressed", netMode);
    $("lgPin").hidden = P.mode !== "x2";
    const nd = $("nodata");
    nd.hidden = P.mode !== "none";
    nd.textContent = P.mode === "none" ? "These gerbers don't say where each part sits. Drop the CPL (pick-and-place) file here to locate them." : "";
    setSide(side, true);
    applyRotation();
    renderChecks();
    setTab(tab === "checks" && sameBoard ? "checks" : "parts");
    const nErr = P.checks.filter(c => c.level === "error").length;
    if (!sameBoard && nErr) setTimeout(() => toast(`Found ${nErr} BOM error${nErr > 1 ? "s" : ""}. See the Checks tab.`, 4200), 400);
    buildList();
    landing.hidden = true; app.hidden = false;
    if (!keepView || !sameBoard) requestAnimationFrame(fitBoard);
  }

  function buildOverlay() {
    for (const g of [ovTop, ovBot, labels]) g.textContent = "";
    cmpEls = { top: {}, bottom: {} }; lblEls = { top: {}, bottom: {} }; netEls = { top: new Map(), bottom: new Map() };
    for (const sd of ["top", "bottom"]) {
      const g = sd === "top" ? ovTop : ovBot;
      el("path", { class: "dim", d: P.outline, "fill-rule": "evenodd" }, g);
      const cl = P.comps.filter(c => c.sides[sd]).sort((a, b) => area(b.sides[sd].bb) - area(a.sides[sd].bb));
      for (const c of cl) {
        const s = c.sides[sd], bb = s.bb, row = ROWS[refRow[c.ref]];
        const cg = el("g", { class: "cmp" + (row && row.polar ? " polar" : ""), "data-ref": c.ref }, g);
        rect(cg, "hit", bb, .28, .15);
        rect(cg, "body", bb, .06, .08);
        if (s.silk) { const sk = el("g", { class: "csilk" }, cg); sk.innerHTML = s.silk; }
        const pg = el("g", { class: "pads" }, cg);
        for (const pd of s.pads) {
          const pe = el("path", { class: "pad" + (pd.pin === "1" ? " p1" : ""), d: pd.d }, pg);
          if (pd.pin) pe.dataset.pin = pd.pin;
          if (pd.name) pe.dataset.name = pd.name;
          if (pd.net) { pe.dataset.net = pd.net; if (!netEls[sd].has(pd.net)) netEls[sd].set(pd.net, []); netEls[sd].get(pd.net).push(pe); }
        }
        if (!s.pads.length) {
          const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
          el("path", { class: "cross", d: `M${cx - .6} ${cy}H${cx + .6}M${cx} ${cy - .6}V${cy + .6}` }, cg);
        }
        rect(cg, "halo", bb, .42, .35);
        cmpEls[sd][c.ref] = cg;
        const w = bb[2] - bb[0], h = bb[3] - bb[1];
        const fs = Math.max(.42, Math.min(1.05, Math.min(w, h) * .55 + .12));
        const t = el("text", { class: "lbl", "font-size": fs.toFixed(3), "stroke-width": (fs * .22).toFixed(3) }, labels);
        t.textContent = c.ref;
        lblEls[sd][c.ref] = { t, bb, fs };
      }
    }
  }

  function applyLook() {
    const L = LOOKS[look.mask] || LOOKS.green;
    const fin = (P.order && P.order.finish) || "hasl";
    let silk = L.silk;
    if (P.order && P.order.silk === "black" && look.mask !== "black") silk = "#1C1F21";
    if (P.order && P.order.silk === "white" && look.mask === "white") silk = "#1C1F21";
    viewer.style.setProperty("--mask", L.mask);
    viewer.style.setProperty("--cu", L.cu);
    viewer.style.setProperty("--silk", silk);
    viewer.style.setProperty("--pad", FINISH[fin] || FINISH.hasl);
    const lk = $("looks");
    lk.innerHTML = Object.keys(LOOKS).map(k => `<button type="button" data-look="${k}" style="background:${LOOKS[k].mask}" aria-pressed="${k === look.mask}" title="${k[0].toUpperCase() + k.slice(1)} solder mask" aria-label="${k} solder mask"></button>`).join("");
  }
  $("looks").addEventListener("click", e => {
    const b = e.target.closest("[data-look]"); if (!b || !P) return;
    look = { mask: b.dataset.look }; store.set(keyP("look"), look); applyLook();
  });

  /* ---------- boards + progress ---------- */
  function loadPlaced() { placed = new Set(store.get(keyP("b" + boardNo), [])); }
  function savePlaced() { store.set(keyP("b" + boardNo), [...placed]); }
  function renderBoardSel() {
    const s = $("boardSel");
    let h = "";
    for (let i = 1; i <= boards; i++) h += `<option value="${i}"${i === boardNo ? " selected" : ""}>Board ${i}</option>`;
    h += `<option value="add">Add another board</option>`;
    s.innerHTML = h;
  }
  $("boardSel").onchange = e => {
    if (!P) return;
    if (e.target.value === "add") { boards++; boardNo = boards; store.set(keyP("n"), boards); toast(`Started board ${boardNo}. Marks for the other boards are kept.`); }
    else boardNo = +e.target.value;
    store.set(keyP("cur"), boardNo);
    loadPlaced(); renderBoardSel(); buildList();
  };
  function updateProgress() {
    const n = TRACKED.filter(r => placed.has(r)).length;
    $("nPlaced").textContent = n; $("nTotal").textContent = TRACKED.length;
    $("bar").style.width = TRACKED.length ? (100 * n / TRACKED.length) + "%" : "0";
  }
  $("clearBtn").onclick = () => {
    if (!P || !placed.size) return;
    if (confirm(`Clear every placed mark on board ${boardNo}?`)) { placed.clear(); savePlaced(); buildList(); }
  };

  /* ---------- labels ---------- */
  function viewCenter(bb, sd) { const cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2; return [sd === "top" ? cx : SX - cx, -cy]; }
  function placeLabels() {
    const a = rot * Math.PI / 180, sa = Math.sin(a), ca = Math.cos(a);
    for (const sd of ["top", "bottom"]) for (const ref in lblEls[sd]) {
      const L = lblEls[sd][ref];
      L.t.style.display = sd === side ? "" : "none";
      if (sd !== side) continue;
      let [x, y] = viewCenter(L.bb, sd);
      if (L.t.classList.contains("sel")) {
        const w = L.bb[2] - L.bb[0], h = L.bb[3] - L.bb[1];
        const up = (rot % 180 === 0 ? h : w) / 2 + .55 + L.fs * .5;
        x += -sa * up; y += -ca * up;
      }
      L.t.setAttribute("x", x.toFixed(3)); L.t.setAttribute("y", y.toFixed(3));
      L.t.setAttribute("transform", `rotate(${-rot} ${x.toFixed(3)} ${y.toFixed(3)})`);
    }
  }

  /* ---------- view: pan / zoom / rotate ---------- */
  const applyView = () => svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  const boxAspect = () => { const r = svg.getBoundingClientRect(); return { W: r.width || 1, H: r.height || 1 }; };
  function rotPt(x, y) { const a = rot * Math.PI / 180, dx = x - CX, dy = y - CY; return [CX + dx * Math.cos(a) - dy * Math.sin(a), CY + dx * Math.sin(a) + dy * Math.cos(a)]; }
  function fitTo(minx, miny, maxx, maxy, margin) {
    const { W, H } = boxAspect();
    const cs = [[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy]].map(p => rotPt(p[0], p[1]));
    const xs = cs.map(p => p[0]), ys = cs.map(p => p[1]);
    const x0 = Math.min(...xs) - margin, x1 = Math.max(...xs) + margin, y0 = Math.min(...ys) - margin, y1 = Math.max(...ys) + margin;
    const vr = svg.getBoundingClientRect();
    const barBottom = document.querySelector(".vbar").getBoundingClientRect().bottom - vr.top + 8;
    const legTop = vr.bottom - document.querySelector(".legend").getBoundingClientRect().top + 8;
    const topPad = Math.min(.3, Math.max(0, barBottom) / H), botPad = Math.min(.2, Math.max(0, legTop) / H), avail = 1 - topPad - botPad;
    const ch = y1 - y0;
    let w = x1 - x0, h = ch / avail;
    if (w / h < W / H) w = h * W / H; else h = w * H / W;
    view = { x: (x0 + x1) / 2 - w / 2, y: y0 - topPad * h - (h * avail - ch) / 2, w, h };
    applyView();
  }
  function fitBoard() { if (P) fitTo(X0, -Y1, X1, -Y0, Math.max(.8, (X1 - X0) * .03)); }
  function applyRotation() { world.setAttribute("transform", `rotate(${rot} ${CX} ${CY})`); placeLabels(); }
  function zoomAt(clientX, clientY, f) {
    const r = svg.getBoundingClientRect();
    const px = view.x + (clientX - r.left) / r.width * view.w, py = view.y + (clientY - r.top) / r.height * view.h;
    const size = Math.max(X1 - X0, Y1 - Y0);
    const nw = Math.min(Math.max(view.w / f, Math.min(1.2, size / 4)), size * 5), nh = nw * view.h / view.w;
    view = { x: px - (clientX - r.left) / r.width * nw, y: py - (clientY - r.top) / r.height * nh, w: nw, h: nh };
    applyView();
  }
  svg.addEventListener("wheel", e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? .012 : .0022))); }, { passive: false });
  const pointers = new Map();
  let drag = null, moved = false, pinch = null;
  svg.addEventListener("pointerdown", e => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), w: view.w }; drag = null; }
  });
  svg.addEventListener("pointermove", e => {
    if (!pointers.has(e.pointerId)) { hoverFromEvent(e); return; }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d) * (pinch.w / view.w));
      moved = true; return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) > 4) { moved = true; svg.classList.add("dragging"); hideTip(); }
      if (moved) { const r = svg.getBoundingClientRect(); view.x = drag.vx - dx / r.width * view.w; view.y = drag.vy - dy / r.height * view.h; applyView(); }
    }
  });
  function endPointer(e) {
    const wasTap = pointers.size === 1 && !moved;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) { drag = null; svg.classList.remove("dragging"); }
    if (wasTap && e.type === "pointerup") boardTap(e);
  }
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);
  svg.addEventListener("pointerleave", () => { if (!pointers.size) { setBoardHover(null); setNet(null); hideTip(); } });

  /* ---------- hover, tap, nets ---------- */
  function cmpFromPoint(x, y) {
    const t = document.elementFromPoint(x, y);
    const g = t && t.closest ? t.closest(".cmp") : null;
    return { g, pad: t && t.classList && t.classList.contains("pad") ? t : null };
  }
  function hoverFromEvent(e) {
    if (e.pointerType === "touch" || !P) return;
    const { g, pad } = cmpFromPoint(e.clientX, e.clientY);
    const ref = g ? g.dataset.ref : null;
    setBoardHover(ref);
    if (netMode) setNet(pad && pad.dataset.net ? pad.dataset.net : null);
    if (ref) showTip(ref, pad, e.clientX, e.clientY); else hideTip();
  }
  function setBoardHover(ref) {
    if (ref === boardHover) return;
    boardHover = ref;
    if (pinned === null) preview = ref && refRow[ref] !== undefined ? { row: refRow[ref], ref } : null;
    render();
    if (ref && pinned === null && tab === "parts") { const li = list.querySelector(`.row[data-row="${refRow[ref]}"]`); if (li) li.scrollIntoView({ block: "nearest" }); }
  }
  function setNet(net) {
    if (net === netHi) return;
    if (netHi) for (const p of netEls[side].get(netHi) || []) p.classList.remove("net");
    netHi = net;
    if (netHi) for (const p of netEls[side].get(netHi) || []) p.classList.add("net");
    svg.classList.toggle("has-net", !!netHi);
  }
  const cleanNet = n => (n || "").replace(/^\//, "");
  function showTip(ref, pad, cx, cy) {
    const row = ROWS[refRow[ref]];
    let h = `<div><b>${esc(ref)}</b>${row && !row.info ? esc(row.val) : ""}</div>`;
    if (pad && pad.dataset.pin) {
      const nm = pad.dataset.name, net = cleanNet(pad.dataset.net);
      const showName = nm && nm !== pad.dataset.pin && nm !== net;
      const netTxt = !net ? "" : /^unconnected/i.test(net) ? ", not connected" : ", net " + esc(net);
      let extra = "";
      if (netMode && net && !/^unconnected/i.test(net)) { const n = (netEls[side].get(pad.dataset.net) || []).length; extra = `<div class="m">${n} pad${n === 1 ? "" : "s"} on this side</div>`; }
      h += `<div class="m">Pin ${esc(pad.dataset.pin)}${showName ? " " + esc(nm) : ""}${netTxt}</div>${extra}`;
    } else if (row) h += `<div class="m">${esc(row.info ? row.val : row.kind)}</div>`;
    if (placed.has(ref)) h += `<div class="ok">Placed</div>`;
    tip.innerHTML = h;
    const vr = viewer.getBoundingClientRect();
    let x = cx - vr.left + 14, y = cy - vr.top + 16;
    tip.classList.add("on");
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    if (x + tw > vr.width - 8) x = cx - vr.left - tw - 14;
    if (y + th > vr.height - 8) y = cy - vr.top - th - 12;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hideTip() { tip.classList.remove("on"); }
  function boardTap(e) {
    if (!P) return;
    const { g, pad } = cmpFromPoint(e.clientX, e.clientY);
    if (netMode && e.pointerType === "touch") setNet(pad && pad.dataset.net && pad.dataset.net !== netHi ? pad.dataset.net : null);
    if (!g) { setPinned(null); return; }
    const ref = g.dataset.ref, r = refRow[ref];
    if (r === undefined) return;
    if (tab !== "parts") setTab("parts");
    setPinned(pinned && pinned.row === r ? null : { row: r }, { scroll: true });
    if (e.pointerType === "touch") { showTip(ref, pad, e.clientX, e.clientY); clearTimeout(hideTip.t); hideTip.t = setTimeout(hideTip, 2200); }
  }

  /* ---------- parts list ---------- */
  function buildList() {
    if (!P) return;
    const q = query.trim().toLowerCase();
    const match = r => !q || [r.val, r.kind, r.lcsc || "", ...r.refs, ...(r.missing || []), ...(r.subs || []).map(s => s[0])].some(s => String(s).toLowerCase().includes(q));
    const pass = r => {
      if (r.info) return filter === "all";
      const n = r.refs.filter(x => placed.has(x)).length;
      if (filter === "todo") return n < r.refs.length;
      if (filter === "done") return r.refs.length && n === r.refs.length;
      return true;
    };
    let main = "", extra = "", nm = 0, ne = 0;
    const locatable = P.mode !== "none";
    ROWS.forEach((r, i) => {
      if (!match(r) || !pass(r)) return;
      const n = r.refs.filter(x => placed.has(x)).length;
      const full = !r.info && r.refs.length && n === r.refs.length;
      const chk = r.info || !r.refs.length
        ? `<span class="check info" aria-hidden="true"><b>${r.refs.length}</b></span>`
        : `<button type="button" class="check ${full ? "full" : n ? "part" : ""}" data-act="all" aria-label="Mark all ${esc(r.val)} placed">${full ? `<svg viewBox="0 0 20 20"><path d="M4.5 10.5l3.6 3.6 7.4-8"/></svg>` : `<b>${n}</b>of ${r.refs.length}`}</button>`;
      const chips = r.refs.map(ref => {
        const m = q && ref.toLowerCase() === q ? " match" : "";
        return r.info ? `<button type="button" class="ref static${m}" data-ref="${esc(ref)}">${esc(ref)}</button>`
          : `<button type="button" class="ref${m}" data-ref="${esc(ref)}" aria-pressed="${placed.has(ref)}" title="Mark ${esc(ref)} placed">${esc(ref)}</button>`;
      }).join("") + (r.missing || []).map(ref => `<span class="ref gone" title="In the BOM, not on the board">${esc(ref)}</span>`).join("");
      let note = "";
      if (r.note) note += `<p class="note${r.warn ? " warn" : ""}">${esc(r.note)}</p>`;
      if (r.polar) note += `<p class="note"><span class="pin1"></span>Check orientation: pin 1 pad shows in red.</p>`;
      const onlyBottom = locatable && r.refs.length && r.refs.every(x => comps[x] && comps[x].sides.bottom && !comps[x].sides.top);
      const lcsc = r.lcsc ? `<a class="lcsc" href="https://www.lcsc.com/search?q=${encodeURIComponent(r.lcsc)}" target="_blank" rel="noopener" title="Open on LCSC">${esc(r.lcsc)}</a>` : "";
      const li = `<li class="row${full ? " done" : ""}${pinned && pinned.row === i ? " active" : ""}" data-row="${i}">${chk}<div>
        <div class="l1"><span class="val">${esc(r.val)}</span><span class="qty">×${r.refs.length}</span>${lcsc}</div>
        <div class="kind">${onlyBottom ? "Bottom side. " : ""}${esc(r.kind || "")}</div>
        <div class="refs">${chips}</div>${note}</div></li>`;
      if (r.info) { extra += li; ne++; } else { main += li; nm++; }
    });
    let html = "";
    if (nm) html += `<ol>${main}</ol>`;
    if (ne) html += `<h2 class="group-h">On the board, not in the BOM</h2><ol>${extra}</ol>`;
    if (!nm && !ne) {
      html = `<p class="empty">${filter === "done" && !q ? "Nothing marked placed yet. Tap a designator after you set the part down." :
        filter === "todo" && !q ? "Every part is marked placed. Ready for reflow." :
          ROWS.length ? `No line matches “${esc(query)}”. Try a value like 100n, a designator like C14, or an LCSC number.` : "No parts found yet."}</p>`;
    }
    list.innerHTML = html;
    updateProgress();
    render();
  }
  list.addEventListener("click", e => {
    const li = e.target.closest(".row"); if (!li) return;
    if (e.target.closest("a")) return;
    const i = +li.dataset.row, r = ROWS[i];
    const chip = e.target.closest(".ref"), chk = e.target.closest('[data-act="all"]');
    if (chk) {
      const all = r.refs.every(x => placed.has(x));
      r.refs.forEach(x => all ? placed.delete(x) : placed.add(x));
      savePlaced(); pinned = { row: i }; buildList(); return;
    }
    if (chip && !r.info && !chip.classList.contains("gone")) {
      const ref = chip.dataset.ref;
      placed.has(ref) ? placed.delete(ref) : placed.add(ref);
      savePlaced(); pinned = { row: i }; preview = { row: i, ref }; buildList(); return;
    }
    setPinned(pinned && pinned.row === i ? null : { row: i });
  });
  let lastPointer = "mouse";
  document.addEventListener("pointerdown", e => { lastPointer = e.pointerType; }, true);
  list.addEventListener("mouseover", e => {
    if (lastPointer === "touch") return;
    const li = e.target.closest(".row"); if (!li) return;
    const chip = e.target.closest(".ref:not(.gone)");
    const i = +li.dataset.row;
    const next = { row: i, ref: chip ? chip.dataset.ref : null };
    if (preview && preview.row === next.row && preview.ref === next.ref) return;
    preview = next; ensureSide(ROWS[i].refs); render();
  });
  list.addEventListener("mouseleave", () => { if (lastPointer === "touch") return; preview = null; if (pinned) ensureSide(selRefs()); render(); });

  function selRefs() {
    if (preview) return ROWS[preview.row] ? ROWS[preview.row].refs : [];
    if (!pinned) return [];
    if (pinned.refs) return pinned.refs;
    return ROWS[pinned.row] ? ROWS[pinned.row].refs : [];
  }
  function setPinned(pn, opts = {}) {
    pinned = pn; preview = null;
    if (pn) ensureSide(selRefs());
    list.querySelectorAll(".row").forEach(li => li.classList.toggle("active", !!pinned && pinned.row === +li.dataset.row));
    $("chkList").querySelectorAll("li").forEach(li => li.classList.toggle("active", !!pinned && pinned.check === +li.dataset.i));
    if (pn && pn.row !== undefined && opts.scroll) {
      const li = list.querySelector(`.row[data-row="${pn.row}"]`);
      if (li) li.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
    }
    render();
  }
  function ensureSide(refs) {
    if (!refs || !refs.length) return;
    if (!refs.some(ref => comps[ref] && comps[ref].sides[side]) && refs.some(ref => comps[ref])) setSide(side === "top" ? "bottom" : "top");
  }

  function render() {
    if (!P) return;
    const sel = new Set(selRefs());
    const focusRef = preview ? preview.ref : null;
    const els = cmpEls[side];
    for (const ref in els) {
      const g = els[ref], s = sel.has(ref);
      g.classList.toggle("sel", s);
      g.classList.toggle("focus", s && focusRef === ref);
      g.classList.toggle("others-dim", s && !!focusRef && focusRef !== ref);
      g.classList.toggle("placed", placed.has(ref));
      g.classList.toggle("hover", boardHover === ref);
      const L = lblEls[side][ref];
      if (L) { L.t.classList.toggle("sel", s); L.t.classList.toggle("placed", placed.has(ref)); }
    }
    svg.classList.toggle("has-sel", sel.size > 0);
    list.querySelectorAll(".row").forEach(li => li.classList.toggle("hot", !!boardHover && +li.dataset.row === refRow[boardHover] && !pinned));
    list.querySelectorAll(".ref").forEach(c => c.classList.toggle("focus", (!!focusRef && c.dataset.ref === focusRef) || c.dataset.ref === boardHover));
    placeLabels();
  }

  /* ---------- checks ---------- */
  function renderChecks() {
    const cs = P.checks;
    const e = cs.filter(c => c.level === "error").length, w = cs.filter(c => c.level === "warn").length;
    const n = $("chkN");
    n.textContent = e + w || cs.length;
    n.className = "n" + (e ? " err" : w ? " warn" : "");
    const order = { error: 0, warn: 1, info: 2 };
    const sorted = cs.map((c, i) => ({ c, i })).sort((a, b) => order[a.c.level] - order[b.c.level]);
    $("chkList").innerHTML = sorted.length ? sorted.map(({ c, i }) => {
      const link = c.refs && c.refs.length && P.mode !== "none";
      const lvl = c.level === "error" ? "Error" : c.level === "warn" ? "Warning" : "Note";
      return `<li class="${c.level}${link ? " link" : ""}" data-i="${i}"><span class="lv" aria-label="${lvl}"></span><div>${esc(c.text)}${link ? `<span class="hint">Show ${c.refs.length > 1 ? "them" : "it"} on the board</span>` : ""}</div></li>`;
    }).join("") : `<li class="info"><span class="lv"></span><div>No problems found between the BOM and the board.</div></li>`;
  }
  $("chkList").addEventListener("click", e => {
    const li = e.target.closest("li.link"); if (!li) return;
    const i = +li.dataset.i, c = P.checks[i];
    setPinned(pinned && pinned.check === i ? null : { check: i, refs: c.refs.filter(r => comps[r]) });
    if (pinned) zoomToSel();
  });
  function setTab(t) {
    tab = t;
    $("tabParts").setAttribute("aria-selected", t === "parts"); $("tabChecks").setAttribute("aria-selected", t === "checks");
    $("partsPane").hidden = t !== "parts"; $("checksPane").hidden = t !== "checks";
  }
  $("tabParts").onclick = () => setTab("parts");
  $("tabChecks").onclick = () => setTab("checks");

  /* ---------- PDF report ---------- */
  const pdfText = s => String(s == null ? "" : s).replace(/Ω/g, " ohm").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[→]/g, "->").replace(/[^\x00-\xFF–—•…€]/g, "?");
  $("reportBtn").onclick = async () => {
    if (!P) return;
    if (!window.jspdf || !window.jspdf.jsPDF) { toast("The PDF library didn't load. Check your connection and try again."); return; }
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    const W = 210, M = 16, CW = W - 2 * M;
    let y = 18;
    const line = (h = 0) => { if (y + h > 282) { doc.addPage(); y = 18; } };
    const text = (s, size, style, color, gap = 1.2) => {
      doc.setFont("helvetica", style || "normal"); doc.setFontSize(size); doc.setTextColor(...(color || [23, 34, 42]));
      const lines = doc.splitTextToSize(pdfText(s), CW);
      for (const l of lines) { line(size * .42); doc.text(l, M, y); y += size * .42 + gap; }
    };
    text("poke~pcb check report", 17, "bold");
    const m = P.meta, o = P.order;
    text(`${P.name}, ${m.w.toFixed(1)} x ${m.h.toFixed(1)} mm, ${m.cu} layers${m.tool ? ", " + m.tool : ""}`, 10.5, "normal", [60, 72, 80]);
    const src = [`Gerbers: ${m.source.split("/").pop()}`, `BOM: ${m.bom || "none"}`, `CPL: ${m.cpl || "none"}`];
    if (o && o.po) src.push(`JLC order ${o.po}${o.mask ? ", " + o.mask + " mask" : ""}${o.finishLabel ? ", " + o.finishLabel : ""}`);
    text(src.join("   |   "), 9, "normal", [86, 102, 110]);
    text(`Made ${new Date().toLocaleString()}`, 9, "normal", [86, 102, 110]);
    y += 3;
    const e = P.checks.filter(c => c.level === "error"), w = P.checks.filter(c => c.level === "warn"), inf = P.checks.filter(c => c.level === "info");
    const parts = TRACKED.length;
    text(`${e.length} error${e.length === 1 ? "" : "s"}, ${w.length} warning${w.length === 1 ? "" : "s"}, ${inf.length} note${inf.length === 1 ? "" : "s"}. ${ROWS.filter(r => !r.info).length} BOM lines, ${parts} parts to place.`, 11.5, "bold");
    y += 2;
    const COL = { error: [194, 59, 50], warn: [191, 120, 20], info: [120, 132, 138] };
    for (const c of [...e, ...w, ...inf]) {
      doc.setFillColor(...COL[c.level]);
      line(6); doc.circle(M + 1.3, y - 1.2, 1.1, "F");
      const lines = doc.splitTextToSize(pdfText(c.text), CW - 6);
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(23, 34, 42);
      for (const l of lines) { line(4.5); doc.text(l, M + 5, y); y += 4.4; }
      y += 1.6;
    }
    if (!P.checks.length) text("No problems found.", 10);
    y += 4;
    text("BOM as matched to the board", 12.5, "bold"); y += 1;
    const cols = [{ t: "Value", w: 36 }, { t: "Qty", w: 11 }, { t: "Designators", w: 62 }, { t: "LCSC", w: 22 }, { t: "Footprint", w: CW - 131 }];
    const head = () => {
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(86, 102, 110);
      let x = M; for (const c of cols) { doc.text(c.t, x, y); x += c.w; }
      y += 1.6; doc.setDrawColor(200, 209, 211); doc.line(M, y, M + CW, y); y += 3.6;
    };
    line(12); head();
    for (const r of ROWS) {
      const subOf = new Map((r.subs || []).map(([a, b]) => [b, a]));
      const cells = [r.val, String(r.refs.length), r.refs.map(x => subOf.has(x) ? `${x} (BOM says ${subOf.get(x)})` : x).join(", ") + ((r.missing || []).length ? `  (missing: ${r.missing.join(", ")})` : ""), r.lcsc || "", r.kind || ""];
      doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
      const wrapped = cells.map((c, k) => doc.splitTextToSize(pdfText(c), cols[k].w - 2));
      const h = Math.max(...wrapped.map(a => a.length)) * 3.6 + 1.8;
      if (y + h > 282) { doc.addPage(); y = 18; head(); }
      let x = M;
      doc.setTextColor(...(r.info ? [120, 132, 138] : r.warn ? [160, 70, 20] : [23, 34, 42]));
      wrapped.forEach((a, k) => { a.forEach((l, j) => doc.text(l, x, y + j * 3.6)); x += cols[k].w; });
      y += h;
      doc.setDrawColor(228, 233, 234); doc.line(M, y - 2.2, M + CW, y - 2.2);
    }
    const blob = doc.output("blob");
    await saveFile(`${P.name}-check-report.pdf`, blob);
  };

  /* ---------- offline copy ---------- */
  $("saveBtn").onclick = async () => {
    if (!P) return;
    const json = JSON.stringify(P).replace(/</g, "\\u003c");
    const html = PRISTINE.replace(/<script data-poke(?:="")?>/, `<script type="application/json" id="poke-data" data-poke>${json}<\/script>\n<script data-poke>`);
    await saveFile(`${P.name}-poke-pcb.html`, html);
  };
  $("filesBtn").onclick = () => { app.hidden = true; landing.hidden = false; renderStaged(); hideTip(); };

  /* ---------- controls ---------- */
  function setSide(s, force) {
    if (s === side && !force) return;
    setNet(null);
    side = s;
    stTop.style.display = ovTop.style.display = s === "top" ? "" : "none";
    stBot.style.display = ovBot.style.display = s === "bottom" ? "" : "none";
    $("sideTop").setAttribute("aria-pressed", s === "top"); $("sideBot").setAttribute("aria-pressed", s === "bottom");
    $("lgMir").hidden = s !== "bottom";
    svg.setAttribute("aria-label", (s === "top" ? "Top" : "Bottom") + " side of the board with part locations");
    boardHover = null; hideTip();
    render();
  }
  $("sideTop").onclick = () => setSide("top");
  $("sideBot").onclick = () => setSide("bottom");
  function toggle(btn, cls, invert) {
    btn.onclick = () => { const on = btn.getAttribute("aria-pressed") !== "true"; btn.setAttribute("aria-pressed", on); svg.classList.toggle(cls, invert ? !on : on); };
  }
  toggle($("tgCu"), "hide-cu", true);
  toggle($("tgSilk"), "hide-silk", true);
  toggle($("tgLbl"), "show-lbl", false);
  const toggleNet = () => { if (!P || !P.hasNets) return; netMode = !netMode; $("tgNet").setAttribute("aria-pressed", netMode); $("lgNet").hidden = !netMode; if (!netMode) setNet(null); toast(netMode ? "Nets on: hover a pad to see everything it connects to." : "Nets off"); };
  $("tgNet").onclick = toggleNet;
  const rotate = () => { rot = (rot + 90) % 360; applyRotation(); fitBoard(); };
  $("rotBtn").onclick = rotate;
  $("fitBtn").onclick = fitBoard;
  $("zoomSelBtn").onclick = zoomToSel;
  function zoomToSel() {
    const refs = selRefs().filter(r => comps[r] && comps[r].sides[side]);
    if (!refs.length) { fitBoard(); return; }
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const r of refs) {
      const bb = comps[r].sides[side].bb;
      const p = viewCenter([bb[0], bb[1], bb[0], bb[1]], side), q = viewCenter([bb[2], bb[3], bb[2], bb[3]], side);
      a = Math.min(a, p[0], q[0]); c = Math.max(c, p[0], q[0]); b = Math.min(b, p[1], q[1]); d = Math.max(d, p[1], q[1]);
    }
    fitTo(a, b, c, d, 2.2);
  }
  document.querySelectorAll(".filters button").forEach(b => b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll(".filters button").forEach(x => x.setAttribute("aria-pressed", x === b));
    buildList();
  });
  qIn.addEventListener("input", () => {
    query = qIn.value;
    const qq = query.trim().toLowerCase();
    const exact = Object.keys(refRow).find(r => r.toLowerCase() === qq);
    const lc = ROWS.findIndex(r => r.lcsc && r.lcsc.toLowerCase() === qq);
    buildList();
    if (exact) { pinned = { row: refRow[exact] }; preview = { row: refRow[exact], ref: exact }; ensureSide([exact]); render(); }
    else if (lc >= 0) setPinned({ row: lc });
  });
  const visibleRows = () => [...list.querySelectorAll(".row")].map(li => +li.dataset.row);
  document.addEventListener("keydown", e => {
    if (app.hidden || !P) return;
    if (e.target === qIn) { if (e.key === "Escape") { qIn.value = ""; query = ""; buildList(); qIn.blur(); } return; }
    if (e.target.tagName === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "arrowdown" || k === "j" || k === "arrowup" || k === "k") {
      e.preventDefault();
      if (tab !== "parts") setTab("parts");
      const rows = visibleRows(); if (!rows.length) return;
      let idx = rows.indexOf(pinned ? pinned.row : -1);
      idx = (k === "arrowdown" || k === "j") ? Math.min(rows.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
      setPinned({ row: rows[idx] }, { scroll: true });
    } else if (k === " " && pinned && pinned.row !== undefined && !ROWS[pinned.row].info) {
      if (e.target.closest && e.target.closest("button, a")) return;
      e.preventDefault();
      const r = ROWS[pinned.row], all = r.refs.every(x => placed.has(x));
      r.refs.forEach(x => all ? placed.delete(x) : placed.add(x));
      savePlaced(); buildList();
    } else if (k === "f") setSide(side === "top" ? "bottom" : "top");
    else if (k === "r") rotate();
    else if (k === "z") zoomToSel();
    else if (k === "0") fitBoard();
    else if (k === "n") toggleNet();
    else if (k === "escape") setPinned(null);
    else if (k === "/") { e.preventDefault(); if (tab !== "parts") setTab("parts"); qIn.focus(); }
  });

  let lastSize = "";
  new ResizeObserver(() => {
    if (!P) return;
    const r = svg.getBoundingClientRect(), s = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (s === lastSize || !r.width) return;
    const first = !lastSize; lastSize = s;
    if (first) { fitBoard(); return; }
    const cx = view.x + view.w / 2, cy = view.y + view.h / 2, h = view.w * r.height / (r.width || 1);
    view = { x: cx - view.w / 2, y: cy - h / 2, w: view.w, h };
    applyView();
  }).observe(svg);

  /* ---------- start ---------- */
  renderStaged();
  const embedded = $("poke-data");
  if (embedded) {
    try { openProject(JSON.parse(embedded.textContent)); } catch (e) { console.error(e); }
  }
  window.__poke = { get project() { return P; }, openProject, ingest, merged, openFromStaging };
})();
