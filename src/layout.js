// Factory floor layout: an Axure-style canvas for placing machines at their real footprint.
// Data lives in state.layout (see freshLayout / normalizeLayout in app.js); units are metres.

// Width × length in metres, from the satisfactory.wiki.gg building infoboxes.
const LAYOUT_SIZES = {
  Build_SmelterMk1_C: [5, 10],
  Build_FoundryMk1_C: [10, 10],
  Build_ConstructorMk1_C: [8, 10],
  Build_AssemblerMk1_C: [9, 16],
  Build_ManufacturerMk1_C: [18, 20],
  Build_OilRefinery_C: [10, 22],
  Build_Packager_C: [8, 8],
  Build_Blender_C: [18, 16],
  Build_HadronCollider_C: [24, 38],
  Build_Converter_C: [16, 16],
  Build_QuantumEncoder_C: [22, 50],
  Build_MinerMk1_C: [6, 14],
  Build_MinerMk2_C: [6, 14],
  Build_MinerMk3_C: [6, 14],
  Build_OilPump_C: [8, 14],
  Build_WaterPump_C: [20, 19.5],
  Build_FrackingSmasher_C: [20, 20],
  Build_FrackingExtractor_C: [4, 4],
  Build_GeneratorCoal_C: [10, 26],
  Build_GeneratorFuel_C: [20, 20],
  Build_GeneratorNuclear_C: [36, 43],
  Build_ResourceSink_C: [16, 13],
  Build_ConveyorAttachmentSplitter_C: [4, 4],
  Build_ConveyorAttachmentMerger_C: [4, 4],
  Build_StorageContainerMk1_C: [5, 11],
  Build_StorageContainerMk2_C: [5, 11],
};
const LAYOUT_EXTRA_NAMES = {
  Build_ResourceSink_C: "AWESOME回收站",
  Build_ConveyorAttachmentSplitter_C: "分流器",
  Build_ConveyorAttachmentMerger_C: "合流器",
  Build_StorageContainerMk1_C: "存储箱",
  Build_StorageContainerMk2_C: "工业存储箱",
};
const LAYOUT_COLORS = {
  Build_SmelterMk1_C: "#c97a3d", Build_FoundryMk1_C: "#b5602f",
  Build_ConstructorMk1_C: "#4a8bd1", Build_AssemblerMk1_C: "#4f9d68", Build_ManufacturerMk1_C: "#8f68cf",
  Build_OilRefinery_C: "#c25b8b", Build_Blender_C: "#b1508f", Build_Packager_C: "#a5708f",
  Build_HadronCollider_C: "#2fa9a2", Build_Converter_C: "#3a9fb8", Build_QuantumEncoder_C: "#3f86b8",
  Build_GeneratorCoal_C: "#c9a634", Build_GeneratorFuel_C: "#c9a634", Build_GeneratorNuclear_C: "#a7b83a",
  Build_ResourceSink_C: "#d4574c",
};
const LAYOUT_SHAPES = [
  { key: "f8", type: "foundation", name: "地基 8×8", w: 8, h: 8 },
  { key: "f4", type: "foundation", name: "地基 8×4", w: 8, h: 4 },
  { key: "f2", type: "foundation", name: "地基 8×2", w: 8, h: 2 },
  { key: "zone", type: "rect", name: "区域", w: 24, h: 16 },
  { key: "note", type: "note", name: "便签", w: 12, h: 8, text: "备注" },
  { key: "text", type: "text", name: "文字", w: 16, h: 3, text: "标题" },
];
const LAYOUT_TOOLS = [
  ["select", "选择", "V"],
  ["pan", "平移", "H"],
  ["link", "连线", "L"],
];
const LY = {
  built: false, tool: "select", sel: new Set(), entered: null, views: {}, drag: null, clip: null,
  linkFrom: null, pal: "plan", guidesShown: [], cursor: null, space: false, raf: 0, autoOpen: false,
  panels: { left: true, right: true },
};
let layoutSeq = 0;
const layoutId = (p = "o") => p + Date.now().toString(36) + (++layoutSeq).toString(36);
const lyRound = (v) => Math.round(v * 1000) / 1000;

function layoutPage() {
  const L = (state.layout = state.layout?.pages ? state.layout : freshLayout());
  return L.pages.find((p) => p.id === L.page) || L.pages[0];
}
function layoutView() {
  const p = layoutPage();
  return (LY.views[p.id] ||= { x: -20, y: -20, z: 5 });
}
function layoutName(o) {
  if (o.name) return o.name;
  if (o.type === "machine") return o.k ? R[o.k]?.name || o.k : layoutBuildingName(o.b);
  if (o.type === "link") return "连线";
  return { foundation: "地基", rect: "区域", note: "便签", text: "文字" }[o.type] || o.type;
}
function layoutBuildingName(b) {
  return B[b]?.name || LAYOUT_EXTRA_NAMES[b] || b || "建筑";
}
function layoutBox(o) {
  const r = o.rot % 180 !== 0;
  return { x: o.x, y: o.y, w: r ? o.h : o.w, h: r ? o.w : o.h };
}
function layoutUnion(list) {
  if (!list.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of list) {
    x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
function layoutObjects() {
  return layoutPage().objects;
}
function layoutById(id) {
  return layoutObjects().find((o) => o.id === id);
}
function layoutSelected() {
  return layoutObjects().filter((o) => LY.sel.has(o.id));
}
// Clicking a grouped object selects the whole group unless the group was entered by double-click.
function layoutTargets(o) {
  if (!o.group || LY.entered === o.group) return [o.id];
  return layoutObjects().filter((x) => x.group === o.group).map((x) => x.id);
}
function layoutCommit(group = "layout") {
  undoEventGroup = group;
  save();
  queueMicrotask(() => { undoEventGroup = ""; });
}
function layoutSnap(v) {
  const s = state.layout.snap;
  return s ? Math.round(v / s) * s : v;
}
function layoutFootprint(b) {
  return LAYOUT_SIZES[b] || [8, 8];
}
function layoutMake(spec, x, y) {
  const o = { id: layoutId(), type: spec.type, x: 0, y: 0, w: spec.w, h: spec.h, rot: 0, name: spec.name || "", text: spec.text || "", color: "", locked: false, hidden: false, group: null };
  if (spec.type === "machine") {
    const [w, h] = layoutFootprint(spec.b);
    Object.assign(o, { b: spec.b, k: spec.k || null, w, h, name: "" });
  } else if (spec.type !== "foundation") o.name = "";
  o.x = layoutSnap(x - o.w / 2);
  o.y = layoutSnap(y - o.h / 2);
  return o;
}

// ---------- plan machines ----------
function layoutPlanMachines() {
  const rows = current?.rows || [];
  const out = new Map();
  for (const r of rows) {
    const k = recipeBase(r.k), rec = R[k];
    if (!rec || rec.kind !== "machine" || !rec.b) continue;
    const e = out.get(k) || { k, b: rec.b, n: 0 };
    e.n += r.n || 0;
    out.set(k, e);
  }
  const placed = {};
  for (const p of state.layout.pages)
    for (const o of p.objects) if (o.type === "machine" && o.k) placed[o.k] = (placed[o.k] || 0) + 1;
  return [...out.values()].map((e) => ({ ...e, placed: placed[e.k] || 0 }));
}
// Flows between recipes in the current plan, used for auto-layout links.
function layoutFlows() {
  const rows = current?.rows || [];
  const prod = {}, cons = {};
  for (const r of rows) {
    const k = recipeBase(r.k);
    for (const [id, q] of Object.entries(r.outs || {})) if (q > 1e-9) (prod[id] ||= {})[k] = ((prod[id] ||= {})[k] || 0) + q;
    for (const [id, q] of Object.entries(r.ins || {})) if (q > 1e-9) (cons[id] ||= {})[k] = ((cons[id] ||= {})[k] || 0) + q;
  }
  const flows = [];
  for (const [id, cs] of Object.entries(cons)) {
    const ps = prod[id];
    if (!ps) continue;
    const total = Object.values(ps).reduce((a, b) => a + b, 0);
    for (const [c, need] of Object.entries(cs))
      for (const [p, made] of Object.entries(ps)) if (p !== c) flows.push({ from: p, to: c, item: id, q: (need * made) / total });
  }
  return flows.filter((f) => f.q > 1e-6).sort((a, b) => b.q - a.q);
}
function layoutPlaceMachines(k, count, at) {
  const rec = R[k], [w, h] = layoutFootprint(rec.b);
  const pitch = Math.max(4, Math.ceil(w / 4) * 4);
  const page = layoutPage(), objs = [];
  const start = at || layoutFreeSpot();
  for (let i = 0; i < count; i++) {
    const o = layoutMake({ type: "machine", b: rec.b, k }, 0, 0);
    o.x = start.x + i * pitch;
    o.y = start.y;
    objs.push(o);
  }
  page.objects.push(...objs);
  return objs;
}
function layoutFreeSpot() {
  const all = layoutObjects().filter((o) => o.type !== "link");
  const u = layoutUnion(all.map(layoutBox));
  return u ? { x: Math.floor(u.x / 8) * 8, y: Math.ceil((u.y + u.h + 8) / 8) * 8 } : { x: 0, y: 0 };
}
function layoutAuto(opts) {
  const page = layoutPage();
  const list = layoutPlanMachines().filter((e) => e.n > 0);
  if (!list.length) return setStatus("当前方案没有可排布的机器。先在产线规划里设置产物。", true);
  if (opts.clear) { page.objects = []; page.groups = []; }
  const start = layoutFreeSpot(), zones = {};
  let y = start.y;
  for (const e of list) {
    const need = opts.missingOnly ? Math.max(0, Math.ceil(e.n - 1e-9) - (opts.clear ? 0 : e.placed)) : Math.ceil(e.n - 1e-9);
    if (!need) continue;
    const [w, h] = layoutFootprint(e.b), pitch = Math.max(4, Math.ceil(w / 4) * 4), per = Math.max(1, opts.perRow);
    const rows = Math.ceil(need / per), gid = layoutId("g");
    const zone = layoutMake({ type: "rect", w: 1, h: 1 }, 0, 0);
    const machines = [];
    for (let i = 0; i < need; i++) {
      const o = layoutMake({ type: "machine", b: e.b, k: e.k }, 0, 0);
      o.x = start.x + 4 + (i % per) * pitch;
      o.y = y + 4 + Math.floor(i / per) * (Math.ceil(h / 4) * 4 + 4);
      o.group = gid;
      machines.push(o);
    }
    const box = layoutUnion(machines.map(layoutBox));
    Object.assign(zone, { x: box.x - 4, y: box.y - 4, w: Math.ceil((box.w + 8) / 4) * 4, h: Math.ceil((box.h + 8) / 4) * 4, group: gid, name: `${R[e.k].name} ×${need}`, color: LAYOUT_COLORS[e.b] || "#6c7a80" });
    page.groups.push({ id: gid, name: `${R[e.k].name} ×${need}` });
    page.objects.push(zone, ...machines);
    zones[e.k] = zone;
    y = zone.y + zone.h + opts.aisle;
    void rows;
  }
  let links = 0;
  if (opts.links) {
    const seen = new Set();
    for (const f of layoutFlows()) {
      if (!zones[f.from] || !zones[f.to] || links >= 400) continue;
      const key = f.from + ">" + f.to + ">" + f.item;
      if (seen.has(key)) continue;
      seen.add(key);
      page.objects.push({ id: layoutId("l"), type: "link", from: zones[f.from].id, to: zones[f.to].id, x: 0, y: 0, w: 1, h: 1, rot: 0, name: `${I[f.item]?.name || f.item} ${fmt(f.q)}`, text: "", color: "", locked: false, hidden: false, group: null });
      links++;
    }
  }
  LY.sel = new Set();
  layoutFit();
  layoutCommit("layout-auto");
  renderLayout();
  setStatus(`已按配方自动排布 ${Object.keys(zones).length} 组机器${links ? `，生成 ${links} 条物流连线` : ""}。可撤销。`);
}

// ---------- rendering ----------
function renderLayout() {
  const tab = $("layoutTab");
  if (!tab || tab.hidden) return;
  state.layout = state.layout?.pages ? state.layout : freshLayout();
  if (!LY.built) layoutBuild();
  const ids = new Set(layoutObjects().map((o) => o.id));
  for (const id of [...LY.sel]) if (!ids.has(id)) LY.sel.delete(id);
  if (LY.entered && !layoutPage().groups.some((g) => g.id === LY.entered)) LY.entered = null;
  layoutRenderPages();
  layoutRenderPalette();
  layoutDraw();
  layoutRenderInspector();
  layoutRenderLayers();
  layoutSyncToolbar();
}
function layoutBuild() {
  const tab = $("layoutTab");
  const btn = (id, label, title = "", extra = "") => `<button id="${id}" title="${esc(title || label)}"${extra}>${label}</button>`;
  tab.innerHTML = `<div class="layout-app">
  <div class="layout-toolbar" role="toolbar" aria-label="布局工具">
    <div class="ly-group" id="lyTools">${LAYOUT_TOOLS.map(([k, n, key]) => `<button data-ly-tool="${k}" title="${n}（${key}）">${n}</button>`).join("")}</div>
    <div class="ly-group"><label class="ly-inline">吸附<select id="lySnap"><option value="0">关</option><option value="0.5">0.5 m</option><option value="1">1 m</option><option value="2">2 m</option><option value="4">4 m</option><option value="8">8 m 地基</option></select></label><label class="ly-inline"><input type="checkbox" id="lyGuides"> 对齐线</label></div>
    <div class="ly-group" id="lyAlign">
      <button data-ly-align="left" title="左对齐">⇤</button><button data-ly-align="hcenter" title="水平居中">⇹</button><button data-ly-align="right" title="右对齐">⇥</button>
      <button data-ly-align="top" title="顶对齐">⤒</button><button data-ly-align="vmiddle" title="垂直居中">⇕</button><button data-ly-align="bottom" title="底对齐">⤓</button>
      <button data-ly-align="dh" title="水平等距分布（3 个以上）">↔</button><button data-ly-align="dv" title="垂直等距分布（3 个以上）">↕</button>
    </div>
    <div class="ly-group">${btn("lyRotate", "⟳ 旋转", "顺时针旋转 90°（R）")}${btn("lyGroup", "组合", "组合（Ctrl+G）")}${btn("lyUngroup", "取消组合", "取消组合（Ctrl+Shift+G）")}${btn("lyLock", "锁定", "锁定 / 解锁（Ctrl+L）")}${btn("lyFront", "置顶", "置于顶层（Ctrl+Shift+]）")}${btn("lyBack", "置底", "置于底层（Ctrl+Shift+[）")}${btn("lyDelete", "删除", "删除（Delete）")}</div>
    <div class="ly-group">${btn("lyZoomOut", "−", "缩小")}<button id="lyZoomLabel" title="缩放到 100%">100%</button>${btn("lyZoomIn", "+", "放大")}${btn("lyFit", "适应", "显示全部")}</div>
    <div class="ly-group"><details id="lyAutoMenu" class="menu ly-menu"><summary title="按当前方案的配方自动排布机器">自动排布</summary><div class="menu-list ly-auto">
      <label>每排最多 <input id="lyAutoPer" type="number" min="1" max="200" value="12"> 台</label>
      <label>排间通道 <input id="lyAutoAisle" type="number" min="0" max="64" step="4" value="8"> m</label>
      <label><input type="checkbox" id="lyAutoMissing" checked> 只放未放置的</label>
      <label><input type="checkbox" id="lyAutoLinks" checked> 生成物流连线</label>
      <label><input type="checkbox" id="lyAutoClear"> 先清空当前页</label>
      <button id="lyAutoRun">开始排布</button></div></details>
      <details id="lyExportMenu" class="menu ly-menu"><summary>导出</summary><div class="menu-list"><button id="lyExportPng">当前页 PNG</button><button id="lyExportSvg">当前页 SVG</button></div></details>
      ${btn("lyToggleLeft", "部件库", "显示 / 隐藏左侧页面与部件库")}${btn("lyToggleRight", "检视", "显示 / 隐藏右侧检视与图层")}</div>
  </div>
  <div class="layout-body">
    <aside class="layout-left" id="lyLeft">
      <section class="ly-card"><div class="ly-card-head"><b>页面 / 楼层</b><span><button id="lyPageAdd" title="新建页面">＋</button><button id="lyPageDup" title="复制当前页">⧉</button><button id="lyPageDel" title="删除当前页">🗑</button></span></div><div id="lyPages" class="ly-pages"></div></section>
      <section class="ly-card ly-palette"><div class="ly-tabs" role="tablist"><button data-ly-pal="plan">本方案</button><button data-ly-pal="buildings">建筑</button><button data-ly-pal="shapes">地基与标注</button></div><input id="lyPalSearch" type="search" placeholder="搜索"><div id="lyPalette" class="ly-pal-list"></div></section>
    </aside>
    <div class="layout-stage" id="lyStage">
      <div class="ly-corner">m</div><svg id="lyRulerX" class="ly-ruler ly-ruler-x"></svg><svg id="lyRulerY" class="ly-ruler ly-ruler-y"></svg>
      <svg id="lyCanvas" class="ly-canvas" tabindex="0" aria-label="布局画布"></svg>
      <div class="ly-statusbar" id="lyStatus"></div>
    </div>
    <aside class="layout-right" id="lyRight">
      <section class="ly-card"><div class="ly-card-head"><b>检视</b></div><div id="lyInspector"></div></section>
      <section class="ly-card ly-layers-card"><div class="ly-card-head"><b>图层</b><span id="lyLayerCount"></span></div><div id="lyLayers" class="ly-layers"></div></section>
    </aside>
  </div></div>`;
  LY.built = true;
  if (window.innerWidth < 900) LY.panels = { left: false, right: false };
  layoutBindEvents();
  layoutFit();
}
function layoutSyncToolbar() {
  const L = state.layout;
  document.querySelectorAll("[data-ly-tool]").forEach((b) => b.classList.toggle("selected", b.dataset.lyTool === LY.tool));
  document.querySelectorAll("[data-ly-pal]").forEach((b) => b.classList.toggle("selected", b.dataset.lyPal === LY.pal));
  $("lySnap").value = String(L.snap);
  $("lyGuides").checked = L.guides;
  $("lyZoomLabel").textContent = Math.round((layoutView().z / 5) * 100) + "%";
  const sel = layoutSelected(), units = layoutUnits(sel);
  document.querySelectorAll("[data-ly-align]").forEach((b) => (b.disabled = ["dh", "dv"].includes(b.dataset.lyAlign) ? units.length < 3 : units.length < 2));
  for (const id of ["lyRotate", "lyLock", "lyFront", "lyBack", "lyDelete"]) $(id).disabled = !sel.length;
  $("lyGroup").disabled = sel.filter((o) => o.type !== "link").length < 2;
  $("lyUngroup").disabled = !sel.some((o) => o.group);
  $("lyLock").textContent = sel.length && sel.every((o) => o.locked) ? "解锁" : "锁定";
  $("lyToggleLeft").classList.toggle("selected", LY.panels.left);
  $("lyToggleRight").classList.toggle("selected", LY.panels.right);
  $("lyLeft").hidden = !LY.panels.left;
  $("lyRight").hidden = !LY.panels.right;
  $("lyStage").style.cursor = LY.tool === "pan" || LY.space ? "grab" : LY.tool === "link" ? "crosshair" : "";
}
function layoutRenderPages() {
  const L = state.layout;
  $("lyPages").innerHTML = L.pages
    .map((p) => {
      const n = p.objects.filter((o) => o.type === "machine").length;
      return `<button class="ly-page${p.id === L.page ? " selected" : ""}" data-ly-page="${esc(p.id)}" title="双击重命名"><span>${esc(p.name)}</span><small>${n} 台</small></button>`;
    })
    .join("");
  $("lyPageDel").disabled = L.pages.length < 2;
}
function layoutRenderPalette() {
  const q = ($("lyPalSearch").value || "").trim().toLowerCase();
  const match = (...t) => !q || t.join(" ").toLowerCase().includes(q);
  let html = "";
  if (LY.pal === "plan") {
    const list = layoutPlanMachines().filter((e) => match(R[e.k].name, R[e.k].en, layoutBuildingName(e.b)));
    html = list.length
      ? list
          .map((e) => {
            const need = Math.ceil(e.n - 1e-9), left = Math.max(0, need - e.placed);
            return `<div class="ly-pal-item" draggable="true" data-ly-spec='${esc(JSON.stringify({ type: "machine", b: e.b, k: e.k }))}'><i style="background:${LAYOUT_COLORS[e.b] || "#6c7a80"}"></i><div><b>${esc(R[e.k].name)}</b><small>${esc(layoutBuildingName(e.b))} · ${layoutFootprint(e.b).join("×")} m · 已放 ${e.placed} / ${need}</small></div>${left ? `<button data-ly-place-all="${esc(e.k)}" title="把剩余 ${left} 台排成一排">+${left}</button>` : `<span class="ly-done">✓</span>`}</div>`;
          })
          .join("")
      : `<p class="ly-empty">当前方案没有机器。先在“产线规划”设置产物，或使用“建筑”页签放置空白建筑。</p>`;
  } else if (LY.pal === "buildings") {
    html = Object.keys(LAYOUT_SIZES)
      .filter((b) => match(layoutBuildingName(b), B[b]?.en || ""))
      .map((b) => `<div class="ly-pal-item" draggable="true" data-ly-spec='${esc(JSON.stringify({ type: "machine", b }))}'><i style="background:${LAYOUT_COLORS[b] || "#6c7a80"}"></i><div><b>${esc(layoutBuildingName(b))}</b><small>${LAYOUT_SIZES[b].join(" × ")} m</small></div></div>`)
      .join("");
  } else {
    html = LAYOUT_SHAPES.filter((s) => match(s.name))
      .map((s) => `<div class="ly-pal-item" draggable="true" data-ly-spec='${esc(JSON.stringify(s))}'><i class="ly-ico-${s.type}"></i><div><b>${esc(s.name)}</b><small>${s.w} × ${s.h} m</small></div></div>`)
      .join("");
  }
  $("lyPalette").innerHTML = html + `<p class="ly-hint">拖到画布，或点击放到视图中央。</p>`;
}
function layoutScreen(wx, wy) {
  const v = layoutView();
  return [(wx - v.x) * v.z, (wy - v.y) * v.z];
}
function layoutWorld(e) {
  const r = $("lyCanvas").getBoundingClientRect(), v = layoutView();
  return [v.x + (e.clientX - r.left) / v.z, v.y + (e.clientY - r.top) / v.z];
}
function layoutGridStep(z, base = 1) {
  let step = base;
  while (step * z < 8) step *= 2;
  return step;
}
// Current positions, including an in-progress drag/resize.
function layoutLive(o) {
  const d = LY.drag;
  if (d?.live && d.live[o.id]) return { ...o, ...d.live[o.id] };
  return o;
}
function layoutLinkPath(a, b) {
  const A = layoutBox(a), Bx = layoutBox(b);
  const ac = [A.x + A.w / 2, A.y + A.h / 2], bc = [Bx.x + Bx.w / 2, Bx.y + Bx.h / 2];
  const dx = bc[0] - ac[0], dy = bc[1] - ac[1];
  let pts;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? A.x + A.w : A.x, ex = dx >= 0 ? Bx.x : Bx.x + Bx.w, mx = (sx + ex) / 2;
    pts = [[sx, ac[1]], [mx, ac[1]], [mx, bc[1]], [ex, bc[1]]];
  } else {
    const sy = dy >= 0 ? A.y + A.h : A.y, ey = dy >= 0 ? Bx.y : Bx.y + Bx.h, my = (sy + ey) / 2;
    pts = [[ac[0], sy], [ac[0], my], [bc[0], my], [bc[0], ey]];
  }
  return pts;
}
function layoutObjectSvg(o, z, forExport = false) {
  const b = layoutBox(o);
  const [sx, sy] = forExport ? [b.x * z, b.y * z] : layoutScreen(b.x, b.y);
  const w = b.w * z, h = b.h * z;
  const sel = !forExport && LY.sel.has(o.id);
  const cls = `ly-obj ly-${o.type}${sel ? " sel" : ""}${o.locked ? " locked" : ""}`;
  const label = layoutName(o);
  const fs = Math.max(9, Math.min(15, Math.min(w, h) / 5));
  const textOk = w > 34 && h > 14;
  const txt = (t, x, y, size = fs, extra = "") => `<text x="${x}" y="${y}" font-size="${size}"${extra}>${esc(t)}</text>`;
  if (o.type === "machine") {
    const color = o.color || LAYOUT_COLORS[o.b] || "#6c7a80";
    // Front (output side) arrow: +y at rotation 0.
    const cx = sx + w / 2, cy = sy + h / 2, a = Math.min(w, h) * 0.18;
    const dir = { 0: [0, 1], 90: [-1, 0], 180: [0, -1], 270: [1, 0] }[o.rot];
    const tip = [cx + dir[0] * (w / 2 - 2), cy + dir[1] * (h / 2 - 2)];
    const back = [tip[0] - dir[0] * a, tip[1] - dir[1] * a];
    const perp = [dir[1] * a * 0.7, -dir[0] * a * 0.7];
    const arrow = `<path class="ly-front" d="M${tip[0]},${tip[1]}L${back[0] + perp[0]},${back[1] + perp[1]}L${back[0] - perp[0]},${back[1] - perp[1]}Z"/>`;
    const sub = o.k ? layoutBuildingName(o.b) : "";
    // Nested <svg> clips labels to the machine box (also after translation changes their length).
    const labels = textOk ? `<svg x="${sx + 2}" y="${sy}" width="${Math.max(0, w - 4)}" height="${h}">${txt(label, w / 2 - 2, h / 2 - (sub && h > 34 ? fs * 0.3 : -fs * 0.35), fs, ' text-anchor="middle"') + (sub && h > 34 ? txt(sub, w / 2 - 2, h / 2 + fs * 0.95, fs * 0.8, ' text-anchor="middle" class="ly-sub"') : "")}</svg>` : "";
    return `<g class="${cls}" data-id="${o.id}"><rect x="${sx}" y="${sy}" width="${w}" height="${h}" rx="${Math.min(4, w / 8)}" fill="${color}" fill-opacity=".82"/>${w > 10 && h > 10 ? arrow : ""}${labels}</g>`;
  }
  if (o.type === "foundation") {
    const grid = [];
    if (z >= 2) for (let gx = 4; gx < b.w - 0.01; gx += 4) grid.push(`M${sx + gx * z},${sy}v${h}`);
    if (z >= 2) for (let gy = 4; gy < b.h - 0.01; gy += 4) grid.push(`M${sx},${sy + gy * z}h${w}`);
    return `<g class="${cls}" data-id="${o.id}"><rect x="${sx}" y="${sy}" width="${w}" height="${h}" fill="${o.color || "#cfd6da"}"/>${grid.length ? `<path class="ly-fgrid" d="${grid.join("")}"/>` : ""}${o.name && textOk ? txt(o.name, sx + 4, sy + fs + 2) : ""}</g>`;
  }
  if (o.type === "rect") {
    const color = o.color || "#176349";
    return `<g class="${cls}" data-id="${o.id}"><rect x="${sx}" y="${sy}" width="${w}" height="${h}" rx="6" fill="${color}" fill-opacity=".08" stroke="${color}" stroke-dasharray="6 4"/>${label && w > 30 ? txt(label, sx + 2, sy - 4, 12, ` style="fill:${color}" class="ly-zone-label"`) : ""}${o.text && h > 30 ? txt(o.text, sx + 6, sy + 16, 11, ' class="ly-sub"') : ""}</g>`;
  }
  if (o.type === "note") {
    const lines = (o.text || "").split("\n").slice(0, Math.max(1, Math.floor((h - 6) / (fs * 1.3))));
    return `<g class="${cls}" data-id="${o.id}"><rect x="${sx}" y="${sy}" width="${w}" height="${h}" rx="3" fill="${o.color || "#f6d66b"}"/>${textOk ? `<svg x="${sx}" y="${sy}" width="${w}" height="${h}">${lines.map((l, i) => txt(l, 6, fs * 1.3 * (i + 1), fs, ' class="ly-note-text"')).join("")}</svg>` : ""}</g>`;
  }
  if (o.type === "text") {
    const size = Math.max(8, h * z * 0.7);
    return `<g class="${cls}" data-id="${o.id}"><rect x="${sx}" y="${sy}" width="${w}" height="${h}" fill="transparent" class="ly-hit"/>${txt(o.text || label, sx + 2, sy + h * 0.78, size, ` style="fill:${o.color || "#17191c"}" class="ly-title-text"`)}</g>`;
  }
  return "";
}
function layoutLinkSvg(o, z, map, forExport = false) {
  const a = map.get(o.from), b = map.get(o.to);
  if (!a || !b || a.hidden || b.hidden) return "";
  const pts = layoutLinkPath(a, b).map(([x, y]) => (forExport ? [x * z, y * z] : layoutScreen(x, y)));
  const d = "M" + pts.map((p) => p.join(",")).join("L");
  const mid = [(pts[1][0] + pts[2][0]) / 2, (pts[1][1] + pts[2][1]) / 2];
  const sel = !forExport && LY.sel.has(o.id);
  const color = o.color || "#d97706";
  const showLabel = forExport || sel || z >= 3;
  const label = o.name && showLabel ? `<g class="ly-link-label"><rect x="${mid[0] - o.name.length * 3.6 - 4}" y="${mid[1] - 9}" width="${o.name.length * 7.2 + 8}" height="17" rx="4"/><text x="${mid[0]}" y="${mid[1] + 4}" text-anchor="middle" font-size="11">${esc(o.name)}</text></g>` : "";
  return `<g class="ly-obj ly-link${sel ? " sel" : ""}" data-id="${o.id}">${o.name ? `<title>${esc(o.name)}</title>` : ""}<path class="ly-link-hit" d="${d}"/><path d="${d}" stroke="${color}" marker-end="url(#lyArrow)" fill="none"/>${label}</g>`;
}
function layoutDraw() {
  const svg = $("lyCanvas");
  if (!svg) return;
  const r = svg.getBoundingClientRect(), W = Math.max(1, r.width), H = Math.max(1, r.height), v = layoutView(), z = v.z;
  // Grid
  const minor = layoutGridStep(z, state.layout.snap && state.layout.snap < 8 ? Math.max(state.layout.snap, 0.5) : 1), major = Math.max(8, minor * 8);
  const lines = (step) => {
    const d = [];
    for (let x = Math.floor(v.x / step) * step; x <= v.x + W / z; x += step) d.push(`M${((x - v.x) * z).toFixed(1)},0V${H}`);
    for (let y = Math.floor(v.y / step) * step; y <= v.y + H / z; y += step) d.push(`M0,${((y - v.y) * z).toFixed(1)}H${W}`);
    return d.join("");
  };
  const page = layoutPage();
  const live = page.objects.map(layoutLive);
  const map = new Map(live.map((o) => [o.id, o]));
  const visible = live.filter((o) => !o.hidden);
  const inView = (o) => {
    if (o.type === "link") return true;
    const b = layoutBox(o);
    return b.x * z < (v.x + W / z) * z && (b.x + b.w) > v.x && b.y < v.y + H / z && b.y + b.h > v.y;
  };
  let body = "";
  for (const o of visible) if (o.type !== "link" && inView(o)) body += layoutObjectSvg(o, z);
  let links = "";
  for (const o of visible) if (o.type === "link") links += layoutLinkSvg(o, z, map);
  // Selection overlay
  let overlay = "";
  const sel = live.filter((o) => LY.sel.has(o.id) && o.type !== "link");
  for (const o of sel) {
    const b = layoutBox(o), [x, y] = layoutScreen(b.x, b.y);
    overlay += `<rect class="ly-selbox" x="${x - 1}" y="${y - 1}" width="${b.w * z + 2}" height="${b.h * z + 2}"/>`;
  }
  if (sel.length === 1 && !sel[0].locked && ["foundation", "rect", "note", "text"].includes(sel[0].type)) {
    const b = layoutBox(sel[0]), [x, y] = layoutScreen(b.x, b.y), w = b.w * z, h = b.h * z;
    for (const [k, hx, hy] of [["nw", 0, 0], ["n", 0.5, 0], ["ne", 1, 0], ["e", 1, 0.5], ["se", 1, 1], ["s", 0.5, 1], ["sw", 0, 1], ["w", 0, 0.5]])
      overlay += `<rect class="ly-handle" data-handle="${k}" x="${x + hx * w - 4}" y="${y + hy * h - 4}" width="8" height="8"/>`;
  } else if (sel.length > 1) {
    const u = layoutUnion(sel.map(layoutBox)), [x, y] = layoutScreen(u.x, u.y);
    overlay += `<rect class="ly-selgroup" x="${x - 3}" y="${y - 3}" width="${u.w * z + 6}" height="${u.h * z + 6}"/>`;
  }
  for (const g of LY.guidesShown) {
    if (g.axis === "x") { const [x] = layoutScreen(g.v, 0); overlay += `<path class="ly-guide" d="M${x},0V${H}"/>`; }
    else { const [, y] = layoutScreen(0, g.v); overlay += `<path class="ly-guide" d="M0,${y}H${W}"/>`; }
  }
  if (LY.drag?.mode === "marquee") {
    const m = LY.drag, [x1, y1] = layoutScreen(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1));
    overlay += `<rect class="ly-marquee" x="${x1}" y="${y1}" width="${Math.abs(m.x1 - m.x0) * z}" height="${Math.abs(m.y1 - m.y0) * z}"/>`;
  }
  if (LY.tool === "link" && LY.linkFrom && LY.cursor) {
    const a = map.get(LY.linkFrom);
    if (a) {
      const b = layoutBox(a), [x, y] = layoutScreen(b.x + b.w / 2, b.y + b.h / 2), [cx, cy] = layoutScreen(LY.cursor[0], LY.cursor[1]);
      overlay += `<path class="ly-guide" d="M${x},${y}L${cx},${cy}"/>`;
    }
  }
  svg.innerHTML = `<defs><marker id="lyArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10Z" fill="#d97706"/></marker></defs>
<path class="ly-grid-minor" d="${minor * z >= 6 ? lines(minor) : ""}"/><path class="ly-grid-major" d="${lines(major)}"/>
<path class="ly-axis" d="M${layoutScreen(0, 0)[0]},0V${H}M0,${layoutScreen(0, 0)[1]}H${W}"/>
<g class="ly-world">${body}${links}</g><g class="ly-overlay">${overlay}</g>`;
  layoutRulers(W, H);
  layoutStatusBar();
}
function layoutRulers(W, H) {
  const v = layoutView(), z = v.z;
  let step = 1;
  while (step * z < 50) step *= 2;
  const ticks = (len, origin) => {
    const out = [];
    for (let t = Math.floor(origin / step) * step; t <= origin + len / z; t += step) out.push(t);
    return out;
  };
  const sel = layoutSelected().filter((o) => o.type !== "link"), u = layoutUnion(sel.map(layoutBox));
  const hlX = u ? `<rect class="ly-ruler-hl" x="${(u.x - v.x) * z}" y="0" width="${u.w * z}" height="20"/>` : "";
  const hlY = u ? `<rect class="ly-ruler-hl" x="0" y="${(u.y - v.y) * z}" width="20" height="${u.h * z}"/>` : "";
  $("lyRulerX").innerHTML = hlX + ticks(W, v.x).map((t) => { const x = (t - v.x) * z; return `<path d="M${x},12V20"/><text x="${x + 3}" y="10">${lyRound(t)}</text>`; }).join("") + (LY.cursor ? `<path class="ly-ruler-cur" d="M${(LY.cursor[0] - v.x) * z},0V20"/>` : "");
  $("lyRulerY").innerHTML = hlY + ticks(H, v.y).map((t) => { const y = (t - v.y) * z; return `<path d="M12,${y}H20"/><text x="10" y="${y + 3}" transform="rotate(-90 10 ${y + 3})">${lyRound(t)}</text>`; }).join("") + (LY.cursor ? `<path class="ly-ruler-cur" d="M0,${(LY.cursor[1] - v.y) * z}H20"/>` : "");
}
function layoutStatusBar() {
  const objs = layoutObjects(), machines = objs.filter((o) => o.type === "machine");
  const sel = layoutSelected().filter((o) => o.type !== "link"), u = layoutUnion(sel.map(layoutBox));
  const plan = layoutPlanMachines(), need = plan.reduce((a, e) => a + Math.ceil(e.n - 1e-9), 0), placed = plan.reduce((a, e) => a + Math.min(e.placed, Math.ceil(e.n - 1e-9)), 0);
  $("lyStatus").innerHTML = [
    LY.cursor ? `X ${lyRound(LY.cursor[0]).toFixed(1)} · Y ${lyRound(LY.cursor[1]).toFixed(1)} m` : "",
    u ? `选中 ${sel.length} 个 · ${lyRound(u.w)} × ${lyRound(u.h)} m` : "",
    `本页 ${machines.length} 台机器`,
    need ? `方案已放置 ${placed} / ${need} 台` : "",
    LY.tool === "link" ? (LY.linkFrom ? "点击目标对象完成连线 · Esc 取消" : "点击起点对象") : "空格 + 拖动平移 · Ctrl + 滚轮缩放 · Alt 拖动不吸附",
  ].filter(Boolean).map((t) => `<span>${esc(t)}</span>`).join("");
}
function layoutRenderInspector() {
  const sel = layoutSelected();
  const el = $("lyInspector");
  if (!sel.length) {
    const L = state.layout, p = layoutPage();
    el.innerHTML = `<p class="ly-empty">未选中对象。</p><div class="ly-form"><label>页面名称<input data-ly-page-name value="${esc(p.name)}"></label></div><p class="ly-hint">单位：米。8 m = 1 块地基。机器尺寸取自游戏百科，箭头指向出料面。<br>快捷键：V 选择 · H 平移 · L 连线 · R 旋转 · Ctrl+G 组合 · Ctrl+D 复制 · 方向键微调（Shift 为 8 m）。</p>${L.pages.length ? "" : ""}`;
    return;
  }
  if (sel.length > 1) {
    const u = layoutUnion(sel.filter((o) => o.type !== "link").map(layoutBox));
    el.innerHTML = `<p><b>${sel.length}</b> 个对象</p>${u ? `<div class="ly-form ly-grid2"><label>X<input type="number" step="0.5" data-ly-multi="x" value="${lyRound(u.x)}"></label><label>Y<input type="number" step="0.5" data-ly-multi="y" value="${lyRound(u.y)}"></label><label>宽<input disabled value="${lyRound(u.w)}"></label><label>长<input disabled value="${lyRound(u.h)}"></label></div>` : ""}<div class="ly-form"><label>颜色<input type="color" data-ly-multi="color" value="${sel[0].color || "#6c7a80"}"></label></div>`;
    return;
  }
  const o = sel[0];
  const typeName = { machine: "机器", foundation: "地基", rect: "区域", note: "便签", text: "文字", link: "连线" }[o.type];
  const sizeFixed = o.type === "machine";
  const group = o.group ? layoutPage().groups.find((g) => g.id === o.group) : null;
  let extra = "";
  if (o.type === "machine") {
    const inputs = o.k ? Object.keys(R[o.k].ins).map((id) => I[id]?.name).join("、") : "";
    const outs = o.k ? Object.keys(R[o.k].outs).map((id) => I[id]?.name).join("、") : "";
    extra = `<div class="ly-info"><span>建筑</span><b>${esc(layoutBuildingName(o.b))}</b>${o.k ? `<span>配方</span><b>${esc(R[o.k].name)}</b><span>输入</span><b>${esc(inputs)}</b><span>输出</span><b>${esc(outs)}</b>` : ""}<span>占地</span><b>${layoutFootprint(o.b).join(" × ")} m</b></div>`;
  }
  if (o.type === "link") {
    const a = layoutById(o.from), b = layoutById(o.to);
    el.innerHTML = `<p class="ly-type">${typeName}</p><div class="ly-info"><span>起点</span><b>${esc(a ? layoutName(a) : "")}</b><span>终点</span><b>${esc(b ? layoutName(b) : "")}</b></div><div class="ly-form"><label>标签<input data-ly-prop="name" value="${esc(o.name)}"></label><label>颜色<input type="color" data-ly-prop="color" value="${o.color || "#d97706"}"></label><button id="lyLinkFlip">反转方向</button></div>`;
    return;
  }
  el.innerHTML = `<p class="ly-type">${typeName}${group ? ` · 组合「${esc(group.name)}」` : ""}</p>${extra}
  <div class="ly-form"><label>名称<input data-ly-prop="name" value="${esc(o.name)}" placeholder="${esc(layoutName({ ...o, name: "" }))}"></label></div>
  <div class="ly-form ly-grid2"><label>X / m<input type="number" step="0.5" data-ly-prop="x" value="${lyRound(o.x)}"></label><label>Y / m<input type="number" step="0.5" data-ly-prop="y" value="${lyRound(o.y)}"></label>
  <label>宽 / m<input type="number" step="0.5" min="0.5" data-ly-prop="w" value="${lyRound(o.w)}"${sizeFixed ? " disabled" : ""}></label><label>长 / m<input type="number" step="0.5" min="0.5" data-ly-prop="h" value="${lyRound(o.h)}"${sizeFixed ? " disabled" : ""}></label>
  <label>旋转<select data-ly-prop="rot">${[0, 90, 180, 270].map((r) => `<option value="${r}"${o.rot === r ? " selected" : ""}>${r}°</option>`).join("")}</select></label><label>颜色<input type="color" data-ly-prop="color" value="${o.color || (o.type === "machine" ? LAYOUT_COLORS[o.b] || "#6c7a80" : o.type === "note" ? "#f6d66b" : o.type === "rect" ? "#176349" : o.type === "foundation" ? "#cfd6da" : "#17191c")}"></label></div>
  ${["note", "text", "rect"].includes(o.type) ? `<div class="ly-form"><label>文本<textarea data-ly-prop="text" rows="3">${esc(o.text)}</textarea></label></div>` : ""}
  <div class="ly-form ly-checks"><label><input type="checkbox" data-ly-prop="locked"${o.locked ? " checked" : ""}> 锁定</label><label><input type="checkbox" data-ly-prop="hidden"${o.hidden ? " checked" : ""}> 隐藏</label>${o.color ? `<button data-ly-reset-color>默认颜色</button>` : ""}</div>`;
}
function layoutRenderLayers() {
  const page = layoutPage(), objs = page.objects;
  $("lyLayerCount").textContent = objs.length + " 个";
  const row = (o, indent) => `<div class="ly-layer${LY.sel.has(o.id) ? " selected" : ""}${o.hidden ? " is-hidden" : ""}" data-ly-layer="${o.id}" style="padding-left:${6 + indent * 14}px"><span class="ly-layer-name">${esc(layoutName(o))}</span><button data-ly-eye="${o.id}" title="显示 / 隐藏">${o.hidden ? "◌" : "◉"}</button><button data-ly-padlock="${o.id}" title="锁定 / 解锁">${o.locked ? "🔒" : "🔓"}</button></div>`;
  const out = [], seen = new Set();
  const limit = 600;
  for (const o of [...objs].reverse()) {
    if (out.length > limit) break;
    if (o.group) {
      if (seen.has(o.group)) continue;
      seen.add(o.group);
      const g = page.groups.find((x) => x.id === o.group), kids = objs.filter((x) => x.group === o.group).reverse();
      const allSel = kids.every((k) => LY.sel.has(k.id));
      out.push(`<div class="ly-layer ly-layer-group${allSel ? " selected" : ""}" data-ly-group-row="${o.group}"><span class="ly-layer-name">▾ ${esc(g?.name || "组合")} <small>${kids.length}</small></span><button data-ly-eye-group="${o.group}" title="显示 / 隐藏">${kids.every((k) => k.hidden) ? "◌" : "◉"}</button><button data-ly-lock-group="${o.group}" title="锁定 / 解锁">${kids.every((k) => k.locked) ? "🔒" : "🔓"}</button></div>`);
      if (LY.entered === o.group || kids.length <= 12 || allSel) for (const k of kids) out.push(row(k, 1));
    } else out.push(row(o, 0));
  }
  $("lyLayers").innerHTML = out.join("") || `<p class="ly-empty">本页还没有对象。</p>`;
}

// ---------- operations ----------
function layoutUnits(sel) {
  const units = [], seen = new Set();
  for (const o of sel) {
    if (o.type === "link") continue;
    if (o.group && LY.entered !== o.group) {
      if (seen.has(o.group)) continue;
      seen.add(o.group);
      units.push(sel.filter((x) => x.group === o.group && x.type !== "link"));
    } else units.push([o]);
  }
  return units;
}
function layoutAlign(kind) {
  const units = layoutUnits(layoutSelected()).filter((u) => u.every((o) => !o.locked));
  if (units.length < 2) return;
  const boxes = units.map((u) => layoutUnion(u.map(layoutBox))), all = layoutUnion(boxes);
  const move = (u, dx, dy) => u.forEach((o) => { o.x = lyRound(o.x + dx); o.y = lyRound(o.y + dy); });
  if (kind === "dh" || kind === "dv") {
    if (units.length < 3) return;
    const ax = kind === "dh" ? "x" : "y", len = kind === "dh" ? "w" : "h";
    const order = units.map((u, i) => ({ u, b: boxes[i] })).sort((a, b) => a.b[ax] - b.b[ax]);
    const span = all[len] - order.reduce((s, e) => s + e.b[len], 0), gap = span / (order.length - 1);
    let pos = all[ax];
    for (const e of order) {
      move(e.u, ax === "x" ? pos - e.b.x : 0, ax === "y" ? pos - e.b.y : 0);
      pos += e.b[len] + gap;
    }
  } else
    units.forEach((u, i) => {
      const b = boxes[i];
      const dx = { left: all.x - b.x, hcenter: all.x + all.w / 2 - (b.x + b.w / 2), right: all.x + all.w - (b.x + b.w) }[kind] ?? 0;
      const dy = { top: all.y - b.y, vmiddle: all.y + all.h / 2 - (b.y + b.h / 2), bottom: all.y + all.h - (b.y + b.h) }[kind] ?? 0;
      move(u, dx, dy);
    });
  layoutCommit("layout-align");
  renderLayout();
}
function layoutRotate(dir = 1) {
  const sel = layoutSelected().filter((o) => o.type !== "link" && !o.locked);
  if (!sel.length) return;
  const u = layoutUnion(sel.map(layoutBox)), cx = u.x + u.w / 2, cy = u.y + u.h / 2;
  for (const o of sel) {
    const b = layoutBox(o), ox = b.x + b.w / 2 - cx, oy = b.y + b.h / 2 - cy;
    const [nx, ny] = dir > 0 ? [-oy, ox] : [oy, -ox];
    o.rot = (o.rot + (dir > 0 ? 90 : 270)) % 360;
    const nb = layoutBox(o);
    o.x = lyRound(layoutSnap(cx + nx - nb.w / 2));
    o.y = lyRound(layoutSnap(cy + ny - nb.h / 2));
  }
  layoutCommit("layout-rotate");
  renderLayout();
}
function layoutGroup() {
  const page = layoutPage(), sel = layoutSelected().filter((o) => o.type !== "link");
  if (sel.length < 2) return;
  const gid = layoutId("g");
  page.groups.push({ id: gid, name: "组合 " + (page.groups.length + 1) });
  sel.forEach((o) => (o.group = gid));
  page.groups = page.groups.filter((g) => page.objects.some((o) => o.group === g.id));
  LY.entered = null;
  layoutCommit("layout-group");
  renderLayout();
}
function layoutUngroup() {
  const page = layoutPage(), gs = new Set(layoutSelected().map((o) => o.group).filter(Boolean));
  if (!gs.size) return;
  page.objects.forEach((o) => { if (gs.has(o.group)) o.group = null; });
  page.groups = page.groups.filter((g) => !gs.has(g.id));
  LY.entered = null;
  layoutCommit("layout-group");
  renderLayout();
}
function layoutDelete() {
  const page = layoutPage(), del = new Set(layoutSelected().filter((o) => !o.locked).map((o) => o.id));
  if (!del.size) return;
  page.objects = page.objects.filter((o) => !del.has(o.id) && !(o.type === "link" && (del.has(o.from) || del.has(o.to))));
  page.groups = page.groups.filter((g) => page.objects.some((o) => o.group === g.id));
  LY.sel = new Set();
  layoutCommit("layout-delete");
  renderLayout();
}
function layoutOrder(front) {
  const page = layoutPage(), sel = page.objects.filter((o) => LY.sel.has(o.id)), rest = page.objects.filter((o) => !LY.sel.has(o.id));
  if (!sel.length) return;
  page.objects = front ? [...rest, ...sel] : [...sel, ...rest];
  layoutCommit("layout-order");
  renderLayout();
}
function layoutStep(front) {
  const objs = layoutPage().objects;
  const idx = objs.map((o, i) => (LY.sel.has(o.id) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return;
  if (front) for (const i of idx.reverse()) { if (i < objs.length - 1 && !LY.sel.has(objs[i + 1].id)) [objs[i], objs[i + 1]] = [objs[i + 1], objs[i]]; }
  else for (const i of idx) { if (i > 0 && !LY.sel.has(objs[i - 1].id)) [objs[i], objs[i - 1]] = [objs[i - 1], objs[i]]; }
  layoutCommit("layout-order");
  renderLayout();
}
function layoutToggleLock() {
  const sel = layoutSelected();
  if (!sel.length) return;
  const lock = !sel.every((o) => o.locked);
  sel.forEach((o) => (o.locked = lock));
  layoutCommit("layout-lock");
  renderLayout();
}
function layoutCopy() {
  const sel = layoutSelected();
  if (!sel.length) return false;
  const ids = new Set(sel.map((o) => o.id));
  const groups = layoutPage().groups.filter((g) => sel.some((o) => o.group === g.id));
  LY.clip = { objects: copy(sel.filter((o) => o.type !== "link" || (ids.has(o.from) && ids.has(o.to)))), groups: copy(groups) };
  return true;
}
function layoutPaste(offset = 8) {
  if (!LY.clip) return;
  const page = layoutPage(), idMap = {}, gMap = {};
  for (const g of LY.clip.groups) { gMap[g.id] = layoutId("g"); page.groups.push({ id: gMap[g.id], name: g.name }); }
  const objs = LY.clip.objects.map((o) => {
    const n = copy(o);
    idMap[o.id] = n.id = layoutId();
    if (n.type !== "link") { n.x += offset; n.y += offset; }
    n.group = o.group ? gMap[o.group] || null : null;
    n.locked = false;
    return n;
  });
  for (const n of objs) if (n.type === "link") { n.from = idMap[n.from]; n.to = idMap[n.to]; }
  page.objects.push(...objs);
  LY.clip = { objects: copy(objs), groups: LY.clip.groups.map((g) => ({ ...g, id: gMap[g.id] })) };
  LY.sel = new Set(objs.map((o) => o.id));
  layoutCommit("layout-paste");
  renderLayout();
}
function layoutNudge(dx, dy) {
  const sel = layoutSelected().filter((o) => o.type !== "link" && !o.locked);
  if (!sel.length) return;
  sel.forEach((o) => { o.x = lyRound(o.x + dx); o.y = lyRound(o.y + dy); });
  layoutCommit("layout-nudge");
  layoutDraw();
  layoutRenderInspector();
}
function layoutSetZoom(z, anchor) {
  const v = layoutView(), svg = $("lyCanvas"), r = svg.getBoundingClientRect();
  const [ax, ay] = anchor || [r.width / 2, r.height / 2];
  const wx = v.x + ax / v.z, wy = v.y + ay / v.z;
  v.z = Math.min(80, Math.max(0.15, z));
  v.x = wx - ax / v.z;
  v.y = wy - ay / v.z;
  layoutDraw();
  layoutSyncToolbar();
}
function layoutFit() {
  const svg = $("lyCanvas");
  if (!svg) return;
  const r = svg.getBoundingClientRect(), v = layoutView();
  const u = layoutUnion(layoutObjects().filter((o) => o.type !== "link" && !o.hidden).map(layoutBox));
  if (!u || r.width < 10) { Object.assign(v, { x: -20, y: -20, z: 5 }); return; }
  const z = Math.min(40, Math.max(0.15, Math.min((r.width - 60) / u.w, (r.height - 60) / u.h)));
  Object.assign(v, { z, x: u.x + u.w / 2 - r.width / 2 / z, y: u.y + u.h / 2 - r.height / 2 / z });
  layoutDraw();
  layoutSyncToolbar();
}
function layoutAddAt(spec, wx, wy) {
  const page = layoutPage(), o = layoutMake(spec, wx, wy);
  page.objects.push(o);
  LY.sel = new Set([o.id]);
  if (window.innerWidth < 900) LY.panels.left = false;
  layoutCommit("layout-add");
  renderLayout();
}
// Grid + smart-guide snapping for a moving box.
function layoutSnapMove(box, dx, dy, skip, noSnap) {
  const v = layoutView(), thr = 6 / v.z;
  let nx = box.x + dx, ny = box.y + dy;
  LY.guidesShown = [];
  if (noSnap) return [nx - box.x, ny - box.y];
  if (state.layout.snap) { nx = layoutSnap(nx); ny = layoutSnap(ny); }
  if (state.layout.guides) {
    const others = layoutObjects().filter((o) => !skip.has(o.id) && o.type !== "link" && !o.hidden).map(layoutBox);
    const xs = [], ys = [];
    for (const b of others) { xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
    const raw = [box.x + dx, box.y + dy];
    const best = (cands, vals) => {
      let bd = thr, hit = null;
      for (const [off, val] of vals) for (const c of cands) { const d = Math.abs(c - val); if (d < bd) { bd = d; hit = [c - val + off, c]; } }
      return hit;
    };
    const hx = best(xs, [0, box.w / 2, box.w].map((o) => [0, raw[0] + o]));
    const hy = best(ys, [0, box.h / 2, box.h].map((o) => [0, raw[1] + o]));
    if (hx) { nx = raw[0] + hx[0]; LY.guidesShown.push({ axis: "x", v: hx[1] }); }
    if (hy) { ny = raw[1] + hy[0]; LY.guidesShown.push({ axis: "y", v: hy[1] }); }
  }
  return [nx - box.x, ny - box.y];
}
function layoutRequestDraw() {
  if (LY.raf) return;
  LY.raf = requestAnimationFrame(() => { LY.raf = 0; layoutDraw(); });
}
function layoutExport(kind) {
  const page = layoutPage(), objs = page.objects.filter((o) => !o.hidden);
  const u = layoutUnion(objs.filter((o) => o.type !== "link").map(layoutBox));
  if (!u) return setStatus("当前页没有可导出的对象。", true);
  const pad = 8;
  let z = 6;
  const maxPx = 8000;
  z = Math.min(z, maxPx / (u.w + pad * 2), maxPx / (u.h + pad * 2));
  const map = new Map(objs.map((o) => [o.id, o]));
  const saveSel = LY.sel;
  LY.sel = new Set();
  const shifted = objs.map((o) => (o.type === "link" ? o : { ...o, x: o.x - u.x + pad, y: o.y - u.y + pad }));
  const smap = new Map(shifted.map((o) => [o.id, o]));
  const W = Math.ceil((u.w + pad * 2) * z), H = Math.ceil((u.h + pad * 2) * z);
  const body = shifted.filter((o) => o.type !== "link").map((o) => layoutObjectSvg(o, z, true)).join("") + shifted.filter((o) => o.type === "link").map((o) => layoutLinkSvg(o, z, smap, true)).join("");
  LY.sel = saveSel;
  void map;
  const css = `text{font-family:system-ui,'Microsoft YaHei',sans-serif;fill:#fff}.ly-sub{fill:#fff;opacity:.85}.ly-rect .ly-sub{fill:#47565e}.ly-foundation text{fill:#17191c}.ly-note-text{fill:#3a2f05}.ly-front{fill:rgba(255,255,255,.75)}.ly-fgrid{stroke:rgba(255,255,255,.35);fill:none}.ly-machine rect{stroke:rgba(0,0,0,.28)}.ly-link path{stroke-width:2}.ly-link-hit{display:none}.ly-link-label rect{fill:#fff;stroke:#d97706}.ly-link-label text{fill:#a95102}.ly-zone-label{font-weight:600}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${css}</style><defs><marker id="lyArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10Z" fill="#d97706"/></marker></defs><rect width="100%" height="100%" fill="#f7f8fa"/>${body}</svg>`;
  const name = `${(workshop.active?.name || "布局").replace(/[\\/:*?"<>|]+/g, "_")}-${page.name}`;
  if (kind === "svg") {
    download(name + ".svg", svg, "image/svg+xml");
    return setStatus("已导出当前页 SVG。");
  }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    c.getContext("2d").drawImage(img, 0, 0);
    c.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name + ".png";
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      setStatus("已导出当前页 PNG。");
    }, "image/png");
  };
  img.onerror = () => setStatus("PNG 导出失败，请改用 SVG。", true);
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// ---------- events ----------
function layoutBindEvents() {
  const tab = $("layoutTab"), svg = $("lyCanvas");
  tab.addEventListener("click", (e) => {
    const t = e.target.closest("button,[data-ly-pal-item]");
    if (!t) return;
    if (t.dataset.lyTool) { LY.tool = t.dataset.lyTool; LY.linkFrom = null; layoutSyncToolbar(); layoutDraw(); return; }
    if (t.dataset.lyAlign) return layoutAlign(t.dataset.lyAlign);
    if (t.dataset.lyPal) { LY.pal = t.dataset.lyPal; layoutRenderPalette(); layoutSyncToolbar(); return; }
    if (t.dataset.lyPage) {
      if (state.layout.page !== t.dataset.lyPage) { state.layout.page = t.dataset.lyPage; LY.sel = new Set(); LY.entered = null; layoutCommit("layout-page"); renderLayout(); if (!LY.views[t.dataset.lyPage]) layoutFit(); }
      return;
    }
    if (t.dataset.lyPlaceAll) {
      const e2 = layoutPlanMachines().find((x) => x.k === t.dataset.lyPlaceAll);
      if (!e2) return;
      const left = Math.max(0, Math.ceil(e2.n - 1e-9) - e2.placed);
      const objs = layoutPlaceMachines(e2.k, left);
      LY.sel = new Set(objs.map((o) => o.id));
      layoutCommit("layout-add");
      renderLayout();
      return setStatus(`已放置 ${left} 台 ${R[e2.k].name}。`);
    }
    if (t.dataset.lyEye || t.dataset.lyPadlock) {
      const o = layoutById(t.dataset.lyEye || t.dataset.lyPadlock);
      if (!o) return;
      if (t.dataset.lyEye) { o.hidden = !o.hidden; if (o.hidden) LY.sel.delete(o.id); } else o.locked = !o.locked;
      layoutCommit("layout-layer");
      return renderLayout();
    }
    if (t.dataset.lyEyeGroup || t.dataset.lyLockGroup) {
      const g = t.dataset.lyEyeGroup || t.dataset.lyLockGroup, kids = layoutObjects().filter((o) => o.group === g);
      const key = t.dataset.lyEyeGroup ? "hidden" : "locked", val = !kids.every((o) => o[key]);
      kids.forEach((o) => (o[key] = val));
      layoutCommit("layout-layer");
      return renderLayout();
    }
    if (t.dataset.lyResetColor !== undefined) {
      const o = layoutSelected()[0];
      if (o) { o.color = ""; layoutCommit("layout-prop"); renderLayout(); }
      return;
    }
    const actions = {
      lyRotate: () => layoutRotate(1), lyGroup: layoutGroup, lyUngroup: layoutUngroup, lyLock: layoutToggleLock,
      lyFront: () => layoutOrder(true), lyBack: () => layoutOrder(false), lyDelete: layoutDelete,
      lyZoomIn: () => layoutSetZoom(layoutView().z * 1.25), lyZoomOut: () => layoutSetZoom(layoutView().z / 1.25),
      lyZoomLabel: () => layoutSetZoom(5), lyFit: layoutFit,
      lyToggleLeft: () => { LY.panels.left = !LY.panels.left; if (LY.panels.left && window.innerWidth < 900) LY.panels.right = false; layoutSyncToolbar(); requestAnimationFrame(layoutDraw); },
      lyToggleRight: () => { LY.panels.right = !LY.panels.right; if (LY.panels.right && window.innerWidth < 900) LY.panels.left = false; layoutSyncToolbar(); requestAnimationFrame(layoutDraw); },
      lyExportPng: () => { $("lyExportMenu").open = false; layoutExport("png"); },
      lyExportSvg: () => { $("lyExportMenu").open = false; layoutExport("svg"); },
      lyAutoRun: () => {
        $("lyAutoMenu").open = false;
        layoutAuto({ perRow: +$("lyAutoPer").value || 12, aisle: Math.max(0, +$("lyAutoAisle").value || 0), missingOnly: $("lyAutoMissing").checked, links: $("lyAutoLinks").checked, clear: $("lyAutoClear").checked });
      },
      lyPageAdd: () => {
        const L = state.layout, id = layoutId("p");
        L.pages.push({ id, name: L.pages.length + 1 + "F", objects: [], groups: [] });
        L.page = id; LY.sel = new Set();
        layoutCommit("layout-page"); renderLayout();
      },
      lyPageDup: () => {
        const L = state.layout, p = layoutPage(), id = layoutId("p"), n = copy(p), idMap = {}, gMap = {};
        n.id = id; n.name = p.name + " 副本";
        n.groups = n.groups.map((g) => ({ ...g, id: (gMap[g.id] = layoutId("g")) }));
        n.objects.forEach((o) => { idMap[o.id] = layoutId(); });
        n.objects = n.objects.map((o) => ({ ...o, id: idMap[o.id], group: o.group ? gMap[o.group] : null, ...(o.type === "link" ? { from: idMap[o.from], to: idMap[o.to] } : {}) }));
        L.pages.splice(L.pages.indexOf(p) + 1, 0, n);
        LY.views[id] = { ...layoutView() };
        L.page = id; LY.sel = new Set();
        layoutCommit("layout-page"); renderLayout();
      },
      lyPageDel: () => {
        const L = state.layout;
        if (L.pages.length < 2) return;
        const p = layoutPage();
        if (p.objects.length && !confirm(`删除页面“${p.name}”及其 ${p.objects.length} 个对象？可用撤销恢复。`)) return;
        const i = L.pages.indexOf(p);
        L.pages.splice(i, 1);
        L.page = L.pages[Math.max(0, i - 1)].id; LY.sel = new Set();
        layoutCommit("layout-page"); renderLayout();
      },
      lyLinkFlip: () => {
        const o = layoutSelected()[0];
        if (o?.type === "link") { [o.from, o.to] = [o.to, o.from]; layoutCommit("layout-prop"); renderLayout(); }
      },
    };
    if (actions[t.id]) actions[t.id]();
  });
  tab.addEventListener("dblclick", (e) => {
    const p = e.target.closest("[data-ly-page]");
    if (p) {
      const page = state.layout.pages.find((x) => x.id === p.dataset.lyPage), name = prompt("页面名称", page?.name || "");
      if (page && name && name.trim()) { page.name = name.trim().slice(0, 60); layoutCommit("layout-page"); renderLayout(); }
      return;
    }
    const g = e.target.closest("[data-ly-group-row]");
    if (g) {
      const group = layoutPage().groups.find((x) => x.id === g.dataset.lyGroupRow), name = group && prompt("组合名称", group.name);
      if (group && name && name.trim()) { group.name = name.trim().slice(0, 120); layoutCommit("layout-group"); renderLayout(); }
    }
  });
  // Layers panel selection
  $("lyLayers").addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    const r = e.target.closest("[data-ly-layer],[data-ly-group-row]");
    if (!r) return;
    const ids = r.dataset.lyLayer ? [r.dataset.lyLayer] : layoutObjects().filter((o) => o.group === r.dataset.lyGroupRow).map((o) => o.id);
    if (r.dataset.lyLayer) { const o = layoutById(r.dataset.lyLayer); if (o?.group) LY.entered = o.group; }
    else LY.entered = null;
    if (e.shiftKey || e.ctrlKey || e.metaKey) ids.forEach((id) => (LY.sel.has(id) ? LY.sel.delete(id) : LY.sel.add(id)));
    else LY.sel = new Set(ids);
    renderLayout();
  });
  // Inspector edits
  const inspect = $("lyInspector");
  inspect.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.lyPageName !== undefined) {
      const v = t.value.trim();
      if (v) { layoutPage().name = v.slice(0, 60); layoutCommit("layout-page"); layoutRenderPages(); }
      return;
    }
    if (t.dataset.lyMulti) {
      const sel = layoutSelected();
      if (t.dataset.lyMulti === "color") sel.forEach((o) => (o.color = t.value));
      else {
        const u = layoutUnion(sel.filter((o) => o.type !== "link").map(layoutBox)), v = +t.value;
        if (!u || !Number.isFinite(v)) return;
        const d = v - u[t.dataset.lyMulti];
        sel.filter((o) => o.type !== "link" && !o.locked).forEach((o) => (o[t.dataset.lyMulti] = lyRound(o[t.dataset.lyMulti] + d)));
      }
      layoutCommit("layout-prop");
      return renderLayout();
    }
    const key = t.dataset.lyProp;
    if (!key) return;
    const o = layoutSelected()[0];
    if (!o) return;
    if (["x", "y", "w", "h"].includes(key)) {
      const v = +t.value;
      if (!Number.isFinite(v)) return;
      o[key] = key === "w" || key === "h" ? Math.max(0.5, Math.min(4000, v)) : Math.max(-1e5, Math.min(1e5, v));
    } else if (key === "rot") {
      const b = layoutBox(o), cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      o.rot = +t.value;
      const nb = layoutBox(o);
      o.x = lyRound(cx - nb.w / 2); o.y = lyRound(cy - nb.h / 2);
    } else if (key === "locked" || key === "hidden") o[key] = t.checked;
    else if (key === "color") o.color = t.value;
    else o[key] = t.value.slice(0, key === "text" ? 2000 : 120);
    layoutCommit("layout-prop");
    renderLayout();
  });
  inspect.addEventListener("input", (e) => {
    const t = e.target, o = layoutSelected()[0];
    if (!o || !["name", "text"].includes(t.dataset.lyProp)) return;
    o[t.dataset.lyProp] = t.value.slice(0, t.dataset.lyProp === "text" ? 2000 : 120);
    layoutDraw();
  });
  // Snap / guides
  $("lySnap").onchange = (e) => { state.layout.snap = +e.target.value; layoutCommit("layout-setting"); layoutDraw(); };
  $("lyGuides").onchange = (e) => { state.layout.guides = e.target.checked; layoutCommit("layout-setting"); };
  $("lyPalSearch").oninput = layoutRenderPalette;
  // Palette: click places at view centre, drag drops at cursor.
  const pal = $("lyPalette");
  pal.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    const it = e.target.closest("[data-ly-spec]");
    if (!it) return;
    const r = svg.getBoundingClientRect(), v = layoutView();
    layoutAddAt(JSON.parse(it.dataset.lySpec), v.x + r.width / 2 / v.z, v.y + r.height / 2 / v.z);
  });
  pal.addEventListener("dragstart", (e) => {
    const it = e.target.closest("[data-ly-spec]");
    if (!it) return;
    e.dataTransfer.setData("application/x-ly-spec", it.dataset.lySpec);
    e.dataTransfer.effectAllowed = "copy";
  });
  svg.addEventListener("dragover", (e) => {
    if ([...e.dataTransfer.types].includes("application/x-ly-spec")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  });
  svg.addEventListener("drop", (e) => {
    const raw = e.dataTransfer.getData("application/x-ly-spec");
    if (!raw) return;
    e.preventDefault();
    const [wx, wy] = layoutWorld(e);
    layoutAddAt(JSON.parse(raw), wx, wy);
  });
  // Canvas pointer interaction
  const touches = new Map();
  const pinchState = () => {
    const [a, b] = [...touches.values()], r = svg.getBoundingClientRect();
    return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
  };
  svg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        LY.drag = null; LY.guidesShown = [];
        const v = layoutView(), p = pinchState();
        LY.pinch = { ...p, z: v.z, wx: v.x + p.mx / v.z, wy: v.y + p.my / v.z };
        svg.setPointerCapture(e.pointerId);
        return;
      }
    }
    svg.focus({ preventScroll: true });
    const [wx, wy] = layoutWorld(e);
    if (e.button === 1 || e.button === 2 || LY.tool === "pan" || LY.space) {
      if (e.button === 2) return;
      e.preventDefault();
      const v = layoutView();
      LY.drag = { mode: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const handle = e.target.closest("[data-handle]");
    const hit = e.target.closest("[data-id]");
    const obj = hit ? layoutById(hit.dataset.id) : null;
    if (LY.tool === "link") {
      if (obj && obj.type !== "link") {
        if (!LY.linkFrom) LY.linkFrom = obj.id;
        else if (LY.linkFrom !== obj.id) {
          const a = layoutById(LY.linkFrom);
          let name = "";
          if (a?.type === "machine" && obj.type === "machine" && a.k && obj.k) {
            const common = Object.keys(R[a.k].outs).filter((id) => R[obj.k].ins[id]);
            name = common.map((id) => I[id]?.name || id).join("、");
          }
          layoutPage().objects.push({ id: layoutId("l"), type: "link", from: LY.linkFrom, to: obj.id, x: 0, y: 0, w: 1, h: 1, rot: 0, name, text: "", color: "", locked: false, hidden: false, group: null });
          LY.linkFrom = null;
          layoutCommit("layout-link");
          renderLayout();
        }
      } else LY.linkFrom = null;
      layoutDraw();
      return;
    }
    if (handle) {
      const o = layoutSelected()[0];
      LY.drag = { mode: "resize", handle: handle.dataset.handle, id: o.id, orig: { ...o }, x0: wx, y0: wy, live: {} };
      svg.setPointerCapture(e.pointerId);
      return;
    }
    if (obj && !obj.locked) {
      const targets = layoutTargets(obj);
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const on = targets.every((id) => LY.sel.has(id));
        targets.forEach((id) => (on ? LY.sel.delete(id) : LY.sel.add(id)));
      } else if (!LY.sel.has(obj.id)) LY.sel = new Set(targets);
      const moving = layoutSelected().filter((o) => o.type !== "link" && !o.locked);
      LY.drag = { mode: "move", click: e.shiftKey || e.ctrlKey || e.metaKey ? null : targets, x0: wx, y0: wy, moving: moving.map((o) => ({ id: o.id, x: o.x, y: o.y })), box: layoutUnion(moving.map(layoutBox)), live: {}, moved: false, alt: e.altKey };
      svg.setPointerCapture(e.pointerId);
      renderLayoutSelectionOnly();
      return;
    }
    if (obj && obj.locked) {
      LY.sel = new Set(layoutTargets(obj));
      renderLayoutSelectionOnly();
      return;
    }
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) { LY.sel = new Set(); LY.entered = null; }
    LY.drag = { mode: "marquee", x0: wx, y0: wy, x1: wx, y1: wy, base: new Set(LY.sel) };
    svg.setPointerCapture(e.pointerId);
    renderLayoutSelectionOnly();
  });
  svg.addEventListener("pointermove", (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (LY.pinch && touches.size === 2) {
      const p = pinchState(), v = layoutView();
      v.z = Math.min(80, Math.max(0.15, (LY.pinch.z * p.d) / Math.max(1, LY.pinch.d)));
      v.x = LY.pinch.wx - p.mx / v.z;
      v.y = LY.pinch.wy - p.my / v.z;
      layoutRequestDraw();
      return;
    }
    const [wx, wy] = layoutWorld(e);
    LY.cursor = [wx, wy];
    const d = LY.drag;
    if (!d) {
      if (LY.tool === "link" && LY.linkFrom) layoutRequestDraw();
      else { layoutRulers(svg.clientWidth, svg.clientHeight); layoutStatusBar(); }
      return;
    }
    if (d.mode === "pan") {
      const v = layoutView();
      v.x = d.vx - (e.clientX - d.sx) / v.z;
      v.y = d.vy - (e.clientY - d.sy) / v.z;
    } else if (d.mode === "move" && d.box) {
      let dx = wx - d.x0, dy = wy - d.y0;
      if (!d.moved && Math.hypot(dx, dy) * layoutView().z < 3) return;
      d.moved = true;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      [dx, dy] = layoutSnapMove(d.box, dx, dy, new Set(d.moving.map((m) => m.id)), e.altKey);
      d.live = Object.fromEntries(d.moving.map((m) => [m.id, { x: lyRound(m.x + dx), y: lyRound(m.y + dy) }]));
    } else if (d.mode === "resize") {
      const o = d.orig, b = layoutBox(o), h = d.handle;
      const sn = (v) => (e.altKey ? v : layoutSnap(v));
      let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
      if (h.includes("w")) x1 = Math.min(sn(wx), x2 - 0.5);
      if (h.includes("e")) x2 = Math.max(sn(wx), x1 + 0.5);
      if (h.includes("n")) y1 = Math.min(sn(wy), y2 - 0.5);
      if (h.includes("s")) y2 = Math.max(sn(wy), y1 + 0.5);
      const rot = o.rot % 180 !== 0;
      d.live = { [o.id]: { x: lyRound(x1), y: lyRound(y1), w: lyRound(rot ? y2 - y1 : x2 - x1), h: lyRound(rot ? x2 - x1 : y2 - y1) } };
    } else if (d.mode === "marquee") {
      d.x1 = wx; d.y1 = wy;
      const x1 = Math.min(d.x0, wx), x2 = Math.max(d.x0, wx), y1 = Math.min(d.y0, wy), y2 = Math.max(d.y0, wy);
      const sel = new Set(d.base);
      for (const o of layoutObjects()) {
        if (o.type === "link" || o.hidden || o.locked) continue;
        const b = layoutBox(o);
        if (b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1) layoutTargets(o).forEach((id) => sel.add(id));
      }
      LY.sel = sel;
    }
    layoutRequestDraw();
  });
  const end = (e) => {
    touches.delete(e.pointerId);
    if (LY.pinch) { if (touches.size < 2) { LY.pinch = null; layoutSyncToolbar(); } return; }
    const d = LY.drag;
    if (!d) return;
    LY.drag = null;
    LY.guidesShown = [];
    try { svg.releasePointerCapture(e.pointerId); } catch {}
    if ((d.mode === "move" && d.moved) || d.mode === "resize") {
      let changed = false;
      for (const [id, p] of Object.entries(d.live || {})) {
        const o = layoutById(id);
        if (o && Object.entries(p).some(([k, v]) => o[k] !== v)) { Object.assign(o, p); changed = true; }
      }
      if (changed) layoutCommit(d.mode === "move" ? "layout-move" : "layout-resize");
      renderLayout();
      return;
    }
    if (d.mode === "pan") { layoutDraw(); return; }
    if (d.mode === "move" && d.click) LY.sel = new Set(d.click);
    renderLayout();
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", () => { if (!LY.drag) { LY.cursor = null; layoutRulers(svg.clientWidth, svg.clientHeight); layoutStatusBar(); } });
  svg.addEventListener("contextmenu", (e) => e.preventDefault());
  svg.addEventListener("dblclick", (e) => {
    const hit = e.target.closest("[data-id]"), o = hit && layoutById(hit.dataset.id);
    if (!o) { LY.entered = null; return; }
    if (o.group && LY.entered !== o.group) { LY.entered = o.group; LY.sel = new Set([o.id]); renderLayout(); return; }
    if (["note", "text", "rect"].includes(o.type)) {
      LY.sel = new Set([o.id]);
      LY.panels.right = true;
      renderLayout();
      const ta = $("lyInspector").querySelector('[data-ly-prop="text"]');
      if (ta) { ta.focus(); ta.select(); }
    }
  });
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(), v = layoutView();
    if (e.ctrlKey || e.metaKey) layoutSetZoom(v.z * Math.exp(-e.deltaY * 0.0022), [e.clientX - r.left, e.clientY - r.top]);
    else {
      const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
      v.x += dx / v.z; v.y += dy / v.z;
      layoutRequestDraw();
    }
  }, { passive: false });
  // Keyboard
  document.addEventListener("keydown", (e) => {
    if ($("layoutTab").hidden || isNativeUndoField(e.target) || e.target.closest?.("select,textarea") || document.querySelector("dialog[open]")) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if (k === " " && !mod) { if (!LY.space) { LY.space = true; layoutSyncToolbar(); } e.preventDefault(); return; }
    if (mod && !e.shiftKey && (k === "a" || k === "A")) { e.preventDefault(); LY.sel = new Set(layoutObjects().filter((o) => !o.hidden && !o.locked).map((o) => o.id)); return renderLayout(); }
    if (mod && (k === "c" || k === "C")) { if (layoutCopy()) e.preventDefault(); return; }
    if (mod && (k === "x" || k === "X")) { if (layoutCopy()) { e.preventDefault(); layoutDelete(); } return; }
    if (mod && (k === "v" || k === "V")) { if (LY.clip) { e.preventDefault(); layoutPaste(); } return; }
    if (mod && (k === "d" || k === "D")) { e.preventDefault(); if (layoutCopy()) layoutPaste(); return; }
    if (mod && (k === "g" || k === "G")) { e.preventDefault(); return e.shiftKey ? layoutUngroup() : layoutGroup(); }
    if (mod && (k === "l" || k === "L")) { e.preventDefault(); return layoutToggleLock(); }
    if (mod && (k === "]" || k === "}")) { e.preventDefault(); return e.shiftKey ? layoutOrder(true) : layoutStep(true); }
    if (mod && (k === "[" || k === "{")) { e.preventDefault(); return e.shiftKey ? layoutOrder(false) : layoutStep(false); }
    if (mod && (k === "=" || k === "+")) { e.preventDefault(); return layoutSetZoom(layoutView().z * 1.25); }
    if (mod && k === "-") { e.preventDefault(); return layoutSetZoom(layoutView().z / 1.25); }
    if (mod && k === "0") { e.preventDefault(); return layoutFit(); }
    if (mod) return;
    if (k === "Delete" || k === "Backspace") { if (LY.sel.size) { e.preventDefault(); layoutDelete(); } return; }
    if (k === "Escape") { LY.linkFrom = null; if (LY.entered) LY.entered = null; else LY.sel = new Set(); return renderLayout(); }
    const step = e.shiftKey ? 8 : state.layout.snap || 0.5;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[k]) { if (LY.sel.size) { e.preventDefault(); layoutNudge(...arrows[k]); } return; }
    const tools = { v: "select", h: "pan", l: "link" };
    if (tools[k.toLowerCase()]) { LY.tool = tools[k.toLowerCase()]; LY.linkFrom = null; layoutSyncToolbar(); return layoutDraw(); }
    if (k === "r" || k === "R") { e.preventDefault(); return layoutRotate(e.shiftKey ? -1 : 1); }
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === " " && LY.space) { LY.space = false; layoutSyncToolbar(); }
  });
  document.addEventListener("click", (e) => {
    for (const id of ["lyAutoMenu", "lyExportMenu"]) if ($(id)?.open && !e.target.closest("#" + id)) $(id).open = false;
  });
  new ResizeObserver(() => { if (!$("layoutTab").hidden) layoutRequestDraw(); }).observe($("lyStage"));
}
function renderLayoutSelectionOnly() {
  layoutDraw();
  layoutRenderInspector();
  layoutRenderLayers();
  layoutSyncToolbar();
}
