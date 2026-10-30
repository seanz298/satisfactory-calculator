const DATA = globalThis.__factoryBundle.data;
const ICONS = globalThis.__factoryBundle.icons;
const MAP_DATA = globalThis.__factoryBundle.map;
const MAP_TERRAIN = globalThis.__factoryBundle.terrain;
const I = DATA.items,
  R = DATA.recipes,
  B = DATA.buildings,
  EPS = 1e-7;
const ITEM_IDS = Object.keys(I).filter(
    (k) => I[k].selectable && !I[k].powerSlot,
  ),
  MACHINE = Object.keys(R).filter((k) => R[k].kind === "machine");
const OPTIONS = Object.fromEntries(
  ITEM_IDS.map((k) => [k, MACHINE.filter((r) => R[r].outs[k] > 0)]),
);
const DEFAULTS = Object.fromEntries(
  ITEM_IDS.map((k) => {
    const options = OPTIONS[k].filter((r) => Object.keys(R[r].outs)[0] === k);
    options.sort((a, b) => {
      const rank = (r) =>
        (R[r].alt ? 100 : 0) +
        (R[r].event ? 50 : 0) +
        (/Unpackage/.test(r) ? 200 : 0) +
        (/Residual/.test(r) ? 20 : 0);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
    return [k, I[k].raw ? "" : options[0] || ""];
  }),
);
function fresh() {
  return {
    version: 12,
    supplies: [],
    products: [],
    nodes: [],
    selected: {},
    clock: 100,
    over: false,
    strict: false,
    autoPin: true,
    sort: "desc",
    powerMult: 1,
    generationMult: 1,
    costMult: 1,
    event: true,
    mode: "forward",
    sloops: {},
    machineGroups: {},
    machineGroupsEnabled: false,
    machineClocks: {},
    inputConstraint: { id: "Desc_LiquidOil_C", q: 300 },
    geothermal: { impure: 0, normal: 0, pure: 0 },
    generators: [],
    genWater: 0,
    extraLoad: 0,
    built: {},
    transport: { belt: 1200, pipe: 600 },
    rail: freshRail(),
    progress: freshProgress(),
    map: freshMap(),
  };
}
let state = fresh();
// Session-local history includes the plan and workspace operations, not game data.
let undoReady = false, undoApplying = false, undoCurrent = '', undoStack = [], redoStack = [];
let undoEventGroup = '', undoPreviousGroup = '', undoPreviousTime = 0;
const amount = (x) => Math.max(0, Math.min(1e8, Number(x) || 0));
// Remove arithmetic noise only at the boundary where computed quantities become inputs.
function displayNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(3)) : 0;
}
function cleanComputedQuantity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n === 0) return 0;
  return Number(n.toPrecision(14));
}
function reverseSupplyBudget(plan, s = state) {
  const nodePool = {};
  for (const n of s.nodes)
    nodePool[n.item] = (nodePool[n.item] || 0) + nodeOutput(n).output;
  return Object.entries(plan.external)
    .filter(
      ([id, q]) => q > (nodePool[id] || 0) + EPS && !hasProductMaterial(id, s),
    )
    .map(([id, q]) => ({
      id,
      q: cleanComputedQuantity(Math.max(0, q - (nodePool[id] || 0))),
      stop: true,
    }));
}
function defaultPowerRecipe(s = state) {
  const priority = [
    "Desc_RocketFuel_C",
    "Desc_IonizedFuel_C",
    "Desc_LiquidTurboFuel_C",
    "Desc_LiquidFuel_C",
    "Desc_LiquidBiofuel_C",
    "Desc_Coal_C",
    "Desc_CompactedCoal_C",
    "Desc_PetroleumCoke_C",
    "Desc_NuclearFuelRod_C",
    "Desc_PlutoniumFuelRod_C",
    "Desc_FicsoniumFuelRod_C",
  ];
  for (const fuel of priority)
    if (
      s.supplies.some((p) => p.id === fuel && p.q > EPS) ||
      s.products.some((p) => p.id === fuel && p.q > EPS)
    )
      return "Power_" + fuel;
  return "Power_Desc_LiquidFuel_C";
}
function isPowerItem(id) {
  return id === "Workbench_Electricity" || !!I[id]?.powerSlot;
}
function materialId(id) {
  return I[id]?.baseItem || (isPowerItem(id) ? "Workbench_Electricity" : id);
}
function ensureProductItem(id) {
  if (Object.hasOwn(I, id)) return true;
  const match = typeof id === "string" && id.match(/^(.+)__product_(\d+)$/);
  if (
    !match ||
    !Object.hasOwn(I, match[1]) ||
    I[match[1]].baseItem ||
    Number(match[2]) > 10000
  )
    return false;
  const base = match[1];
  I[id] = {
    ...I[base],
    baseItem: base,
    productSlot: true,
    get name() {
      return I[base].name;
    },
    set name(value) {},
  };
  return true;
}
function nextProductItem(base, s = state) {
  base = materialId(base);
  if (isPowerItem(base)) return nextPowerItem(s);
  if (!s.products.some((p) => p.id === base)) return base;
  for (let n = 1; n <= 10000; n++) {
    const id = base + "__product_" + n;
    if (!s.products.some((p) => p.id === id)) {
      ensureProductItem(id);
      return id;
    }
  }
  return null;
}
function hasProductMaterial(id, s = state) {
  return s.products.some((p) => materialId(p.id) === materialId(id));
}
function recipeSpecificTarget(id, s = state) {
  return (
    isPowerItem(id) ||
    !!I[id]?.baseItem ||
    s.products.some(
      (p) => I[p.id]?.baseItem && materialId(p.id) === materialId(id),
    )
  );
}
function recipeTargetKey(id, s = state) {
  return "source:" + recipeFor(id, s) + ":" + materialId(id);
}
function productTitle(id, s = state) {
  const group = s.products.filter((p) => materialId(p.id) === materialId(id));
  const number =
    group.length > 1 ? " · #" + (group.findIndex((p) => p.id === id) + 1) : "";
  return (
    (I[id]?.name || id) +
    number +
    (recipeSpecificTarget(id, s)
      ? " · " + (R[recipeFor(id, s)]?.name || "")
      : "")
  );
}
function recipeOptions(id) {
  return OPTIONS[materialId(id)] || [];
}
function nextPowerItem(s = state) {
  return [
    "Workbench_Electricity",
    ...Array.from({ length: 64 }, (_, i) => "Workbench_Electricity_" + (i + 1)),
  ].find((id) => !s.products.some((p) => p.id === id));
}
function canonicalDemands(d) {
  const out = {};
  for (const [id, q] of Object.entries(d)) {
    const material = materialId(id);
    out[material] = (out[material] || 0) + q;
  }
  return out;
}
function recipeFor(id, s = state) {
  if (isPowerItem(id) && !Object.hasOwn(s.selected, id))
    return defaultPowerRecipe(s);
  const base = materialId(id);
  const chosen = Object.hasOwn(s.selected, id)
    ? s.selected[id]
    : I[id]?.baseItem
      ? recipeFor(base, s)
      : DEFAULTS[base];
  return chosen === "" &&
    !I[id]?.raw &&
    !s.supplies.some((x) => x.id === id) &&
    !s.nodes.some((n) => n.item === id)
    ? DEFAULTS[base]
    : chosen;
}
function restoreOrphanRecipes(s = state) {
  const restored = [];
  for (const [id, k] of Object.entries(s.selected))
    if (
      k === "" &&
      !I[id]?.raw &&
      DEFAULTS[id] &&
      !s.supplies.some((x) => x.id === id) &&
      !s.nodes.some((n) => n.item === id)
    ) {
      delete s.selected[id];
      restored.push(id);
    }
  return restored;
}
function powerSourceRecipes(s = state) {
  const products = s.products.filter((p) => isPowerItem(p.id));
  return [
    ...new Set(
      (products.length
        ? products.map((p) => recipeFor(p.id, s))
        : [recipeFor("Workbench_Electricity", s)]
      ).filter(Boolean),
    ),
  ];
}
function generatorWasteRow(r) {
  const id =
    r.fuel === "Desc_NuclearFuelRod_C"
      ? "Desc_NuclearWaste_C"
      : r.fuel === "Desc_PlutoniumFuelRod_C"
        ? "Desc_PlutoniumWaste_C"
        : null;
  return id
    ? { id, q: r.usedFuel * (r.fuel === "Desc_NuclearFuelRod_C" ? 50 : 10) }
    : null;
}
function generatorWaste(s = state) {
  return {};
}
function supplyPool(s = state) {
  const pool = {};
  for (const x of s.supplies) pool[x.id] = (pool[x.id] || 0) + x.q;
  for (const n of s.nodes) {
    const v = nodeOutput(n);
    pool[n.item] = (pool[n.item] || 0) + v.output;
  }
  return pool;
}
function nodeOutput(n) {
  const purity = { impure: 0.5, normal: 1, pure: 2 }[n.purity] || 1,
    c = Math.max(0.01, Math.min(2.5, n.clock / 100)),
    count = Math.floor(amount(n.count));
  let base = 60,
    power = 5,
    cap = n.belt || 1200,
    name = "1级采矿机";
  if (n.machine === "mk2") {
    base = 120;
    power = 15;
    name = "2级采矿机";
  }
  if (n.machine === "mk3") {
    base = 240;
    power = 45;
    name = "3级采矿机";
  }
  if (n.machine === "oil") {
    base = 120;
    power = 40;
    cap = n.pipe || 600;
    name = "油井";
  }
  if (n.machine === "water") {
    base = 120;
    power = 20;
    cap = n.pipe || 600;
    name = "抽水站";
  }
  if (n.machine === "well") {
    base = 60;
    power = 0;
    cap = n.pipe || 600;
    name = "资源抽取器";
  }
  const theoretical = base * (n.machine === "water" ? 1 : purity) * c;
  return {
    name,
    theoretical: theoretical * count,
    output: Math.min(cap, theoretical) * count,
    power:
      power * Math.pow(c, 1.321929) * count +
      (n.machine === "well"
        ? 150 * Math.pow(c, 1.321929) * (n.pressurizers || 0)
        : 0),
    limited: theoretical > cap + EPS,
    count,
  };
}
function activeRecipes(s = state, required = []) {
  const external = new Set(s.supplies.filter((x) => x.stop).map((x) => x.id));
  if (s.mode === "constrained" && s.inputConstraint?.id)
    external.add(s.inputConstraint.id);
  const allowedGeneration = new Set(),
    visited = new Set();
  // Generation is enabled only by the selected electricity source or a required waste-processing chain.
  function trace(id) {
    if (visited.has(id) || external.has(id)) return;
    visited.add(id);
    const k = recipeFor(id, s),
      r = R[k];
    if (!r || r.kind !== "machine" || (!s.event && r.event)) return;
    if (r.generation) allowedGeneration.add(k);
    for (const input of Object.keys(r.ins)) trace(input);
  }
  for (const power of powerSourceRecipes(s))
    if (R[power]?.generation && !external.has("Workbench_Electricity")) {
      allowedGeneration.add(power);
      for (const input of Object.keys(R[power].ins)) trace(input);
    }
  for (const id of required) trace(id);
  return [
    ...new Set(
      [
        ...ITEM_IDS.map((id) => (external.has(id) ? "" : recipeFor(id, s))),
        ...s.products
          .map((p) => recipeFor(p.id, s))
          .filter(
            (k) =>
              R[k]?.kind === "machine" &&
              (!R[k].generation || allowedGeneration.has(k)),
          ),
        ...allowedGeneration,
        // Fixed groups remain running processes even when another recipe is selected
        // for the same output, or their output is also supplied externally.
        ...Object.keys(s.machineGroupsEnabled ? s.machineGroups || {} : {}).filter(
          k => s.machineGroups[k].groups.some(g => g.count > 0),
        ),
      ].filter(
        (k) =>
          R[k]?.kind === "machine" &&
          (s.event || !R[k].event) &&
          (!R[k].generation || allowedGeneration.has(k) ||
            (s.machineGroupsEnabled && s.machineGroups?.[k]?.groups.some(g => g.count > 0))),
      ),
    ),
  ].flatMap(key => groupedRecipes(key, s));
}
function recipeBase(key) { return R[key]?.groupParent || key; }
function machineGroup(key, s = state) {
  if (!s.machineGroupsEnabled) return null;
  const r = R[key];
  return r?.groupParent ? s.machineGroups?.[r.groupParent]?.groups.find(g => g.id === r.groupId) || null : null;
}
function normalizeMachineGroups(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, profile] of Object.entries(value)) {
    const r = R[key];
    if (!r || r.kind !== 'machine' || r.groupParent || !Array.isArray(profile?.groups)) continue;
    const slots = B[r.b]?.sloopSlots || 0, ids = new Set(), groups = [];
    for (const [index, group] of profile.groups.slice(0, 100).entries()) {
      let id = Number.isInteger(group.id) && group.id > 0 ? group.id : index + 1;
      while (ids.has(id)) id++;
      ids.add(id);
      const count = Math.max(0, Math.min(1000000, Math.floor(Number(group.count) || 0)));
      const clock = Math.max(1, Math.min(250, Number(group.clock) || 100));
      const sloops = Math.max(0, Math.min(slots, Math.floor(Number(group.sloops) || 0)));
      groups.push({ id, count, clock, sloops });
    }
    if (groups.length) out[key] = { mode: profile.mode === 'fixed' ? 'fixed' : 'capacity', groups };
  }
  return out;
}
function groupedRecipes(key, s = state) {
  key = recipeBase(key);
  if (!s.machineGroupsEnabled) return [key];
  const profile = s.machineGroups?.[key];
  if (!profile?.groups.length) return [key];
  return profile.groups.filter(g => g.count > 0).map(group => {
    const id = key + '__machineGroup_' + group.id;
    if (!R[id]) R[id] = { ...R[key], groupParent: key, groupId: group.id,
      get name() { return R[key].name + ' · ' + (document.documentElement.lang === 'en' ? 'Group ' : '组 ') + group.id; }, set name(value) {},
      en: (R[key].en || R[key].name) + ' · Group ' + group.id };
    return id;
  });
}
function amplification(k, s = state) {
  const slots = B[R[k]?.b]?.sloopSlots || 0,
    count = Math.max(0, Math.min(slots, Math.floor(amount(machineGroup(k, s)?.sloops ?? s.sloops?.[k]))));
  return { slots, count, boost: slots ? 1 + count / slots : 1 };
}
function rates(k, s = state) {
  const r = R[k],
    f = (60 / r.time) * (B[r.b]?.speed || 1),
    boost = amplification(k, s).boost;
  return {
    ins: Object.fromEntries(
      Object.entries(r.ins).map(([id, v]) => [id, v * f * s.costMult]),
    ),
    outs: Object.fromEntries(
      Object.entries(r.outs).map(([id, v]) => [
        id,
        v *
          f *
          boost *
          (r.generation && id === "Workbench_Electricity"
            ? (s.generationMult ?? 1)
            : 1),
      ]),
    ),
  };
}
function planSolve(
  demand,
  s = state,
  { mode = null, target = null, flex = null, limit = null } = {},
) {
  mode = mode || s.mode || "forward";
  const cap = mode === "constrained" ? s.inputConstraint : null;
  if (cap && (!I[cap.id]?.selectable || hasProductMaterial(cap.id, s)))
    return { ok: false, constraintConflict: true };
  const waste = generatorWaste(s),
    pool = supplyPool(s),
    rs = activeRecipes(s, [
      ...Object.keys(demand),
      ...(target ? [target] : []),
      ...Object.keys(flex || {}),
    ]),
    model = {
      optimize: "objective",
      opType: target || flex ? "max" : "min",
      constraints: {},
      variables: {},
    };
  const materialDemand = canonicalDemands(demand),
    sourceRequests = new Map();
  for (const [id, q] of Object.entries(demand))
    if (recipeSpecificTarget(id, s)) {
      const key = recipeTargetKey(id, s);
      const entry = sourceRequests.get(key) || {
        recipe: recipeFor(id, s),
        item: materialId(id),
        q: 0,
      };
      entry.q += q;
      sourceRequests.set(key, entry);
    }
  for (const id of [...(target ? [target] : []), ...Object.keys(flex || {})])
    if (recipeSpecificTarget(id, s)) {
      const key = recipeTargetKey(id, s);
      if (!sourceRequests.has(key))
        sourceRequests.set(key, {
          recipe: recipeFor(id, s),
          item: materialId(id),
          q: 0,
        });
    }
  for (const [key, entry] of sourceRequests)
    model.constraints[key] = { min: entry.q };
  const involved = new Set([
    ...Object.keys(materialDemand),
    ...Object.keys(pool),
    ...Object.keys(waste),
  ]);
  for (const k of rs) {
    for (const id of [...Object.keys(R[k].ins), ...Object.keys(R[k].outs)])
      involved.add(id);
  }
  for (const id of involved) {
    model.constraints[id] = { min: materialDemand[id] || 0 };
    if (s.strict && I[id]?.fluid)
      model.constraints[id].max = materialDemand[id] || 0;
  }
  for (const k of rs) {
    const rr = rates(k, s),
      v = { objective: target || flex ? 0 : 0.00001 };
    for (const [id, q] of Object.entries(rr.outs)) v[id] = (v[id] || 0) + q;
    for (const [id, q] of Object.entries(rr.ins)) v[id] = (v[id] || 0) - q;
    for (const [key, entry] of sourceRequests)
      if (entry.recipe === recipeBase(k)) v[key] = rr.outs[entry.item] || 0;
    const group = machineGroup(k, s);
    if (group) {
      const capacity = group.count * machineClock(k, s) / 100;
      const key = 'machine-capacity:' + k;
      model.constraints[key] = { max: capacity };
      if (s.machineGroups[R[k].groupParent].mode === 'fixed') model.constraints[key].min = capacity;
      v[key] = 1;
    }
    model.variables[k] = v;
  }
  for (const [id, q] of Object.entries(waste))
    if (q > EPS) {
      const key = "genout:" + id;
      model.constraints[key] = { equal: 1 };
      model.variables[key] = { objective: 0, [key]: 1, [id]: q };
    }
  const externals = new Set(Object.keys(pool));
  if (s.mode === "constrained" && mode !== "forward")
    externals.add(s.inputConstraint.id);
  if (mode !== "forward")
    for (const id of involved)
      if (
        !hasProductMaterial(id, s) &&
        (I[id]?.raw ||
          !recipeFor(id, s) ||
          s.supplies.some((x) => x.id === id && x.stop))
      )
        externals.add(id);
  for (const id of externals) {
    if (hasProductMaterial(id, s) && !(I[id]?.raw && s.supplies.some(p => p.id === id))) continue;
    const v = { objective: target || flex ? 0 : 1, [id]: 1 };
    if (mode === "forward" || (cap && id === cap.id)) {
      model.constraints["s:" + id] = {
        max: cap ? amount(cap.q) : pool[id] || 0,
      };
      v["s:" + id] = 1;
    }
    model.variables["ext:" + id] = v;
  }
  if (mode === "shortage") {
    for (const id of externals) {
      model.constraints["use:" + id] = { max: pool[id] || 0 };
      const v = model.variables["ext:" + id];
      if (!v) continue;
      v.objective = 0.000001;
      v["use:" + id] = 1;
      model.variables["short:" + id] = { objective: 1, [id]: 1 };
    }
  }
  if (target || flex) {
    const v = { objective: 1 };
    for (const [id, q] of Object.entries(target ? { [target]: 1 } : flex)) {
      const item = materialId(id);
      v[item] = (v[item] || 0) - q;
      if (recipeSpecificTarget(id, s)) {
        const key = recipeTargetKey(id, s);
        v[key] = (v[key] || 0) - q;
      }
    }
    if (limit !== null) {
      model.constraints.limit = { max: limit };
      v.limit = 1;
    }
    model.variables.goal = v;
  }
  const result = solver.Solve(model);
  if (!result?.feasible || result.bounded === false)
    return { ok: false, unbounded: result?.bounded === false };
  return { ok: true, result, rs, pool, involved: [...involved], mode };
}
function demands(s = state) {
  return Object.fromEntries(
    s.products.filter((p) => p.q > EPS).map((p) => [p.id, p.q]),
  );
}
function lockedDemands(s = state, exclude = null) {
  return Object.fromEntries(
    s.products
      .filter((p) => p.lock && p.id !== exclude && p.q > EPS)
      .map((p) => [p.id, p.q]),
  );
}
function allocationMax(id, s = state) {
  return planSolve(lockedDemands(s, id), s, {
    target: id,
    limit: s.mode === "constrained" ? null : 1e8,
  });
}
function machineClock(k, s = state) {
  const group = machineGroup(k, s);
  if (group) return Math.min(s.over ? 250 : 100, group.clock);
  const v = s.machineClocks?.[R[k]?.b];
  return Number.isFinite(v) && v >= 1
    ? Math.min(s.over ? 250 : 100, v)
    : Math.max(1, Math.min(s.over ? 250 : 100, s.clock));
}
function configure(k, eq, s = state) {
  const cap = machineClock(k, s) / 100,
    full = Math.floor(eq / cap + 1e-8),
    remain = Math.max(0, eq - full * cap),
    tail = remain > EPS ? Math.max(0.01, remain) : 0,
    duty = tail ? remain / tail : 1,
    n = full + (tail ? 1 : 0),
    exponent = B[R[k].b]?.exp || 1.321929,
    factor =
      full * Math.pow(cap, exponent) +
      (tail ? Math.pow(tail, exponent) * duty : 0);
  const amp = amplification(k, s);
  const group = machineGroup(k, s);
  return {
    full,
    cap,
    tail,
    duty,
    n: group ? group.count : n,
    activeN: n,
    groupId: R[k].groupId || null,
    sloops: amp.count,
    sloopTotal: (group ? group.count : n) * amp.count,
    boost: amp.boost,
    power: R[k].p * factor * s.powerMult * amp.boost ** 2,
    peak: R[k].peak * factor * s.powerMult * amp.boost ** 2,
    shards:
      full * Math.max(0, Math.ceil((cap - 1 - 1e-7) / 0.5)) +
      (tail ? Math.max(0, Math.ceil((tail - 1 - 1e-7) / 0.5)) : 0),
  };
}
function summarize(solution, s = state) {
  if (!solution.ok) return null;
  const rows = [],
    external = {},
    surplus = {},
    input = {},
    output = {};
  let power = 0,
    peak = 0,
    machines = 0,
    shards = 0;
  for (const k of solution.rs) {
    const eq = solution.result[k] || 0;
    if (eq < EPS && !machineGroup(k, s)) continue;
    const rr = rates(k, s),
      config = configure(k, eq, s),
      ins = {},
      outs = {};
    for (const [id, v] of Object.entries(rr.ins)) {
      ins[id] = v * eq;
      input[id] = (input[id] || 0) + v * eq;
    }
    for (const [id, v] of Object.entries(rr.outs)) {
      outs[id] = v * eq;
      output[id] = (output[id] || 0) + v * eq;
    }
    rows.push({ k, eq, ins, outs, ...config });
    power += config.power;
    peak += config.peak;
    machines += config.n;
    shards += config.shards;
  }
  for (const id of solution.involved) {
    external[id] =
      (solution.result["ext:" + id] || 0) +
      (solution.result["short:" + id] || 0);
    surplus[id] = Math.max(
      0,
      (output[id] || 0) +
        external[id] -
        (input[id] || 0) -
        (canonicalDemands(demands(s))[id] || 0),
    );
  }
  for (const [id, q] of Object.entries(generatorWaste(s)))
    output[id] = (output[id] || 0) + q;
  for (const id of solution.involved)
    surplus[id] = Math.max(
      0,
      (output[id] || 0) +
        (external[id] || 0) -
        (input[id] || 0) -
        (canonicalDemands(demands(s))[id] || 0),
    );
  const mining =
    s.nodes.reduce((a, n) => a + nodeOutput(n).power, 0) * s.powerMult;
  return {
    rows,
    external,
    surplus,
    input,
    output,
    power: power + mining,
    productionPower: power,
    miningPower: mining,
    peak: peak + mining,
    machines,
    shards,
    sloopTotal: rows.reduce((n, r) => n + (r.sloopTotal || 0), 0),
    generation:
      (output.Workbench_Electricity || 0) + geothermalPower(s).average,
    importedPower: supplyPool(s).Workbench_Electricity || 0,
    geothermal: geothermalPower(s),
  };
}
function diagnose(id, q, s = state) {
  const d = { ...lockedDemands(s, id), [id]: q };
  if (s.mode === "constrained") {
    const free = planSolve(d, s, { mode: "reverse" });
    if (free.ok) {
      const need = free.result["ext:" + s.inputConstraint.id] || 0;
      if (need > s.inputConstraint.q + EPS)
        return {
          missing: [],
          reason:
            "单输入约束不足：" +
            I[s.inputConstraint.id].name +
            " 需要 " +
            cleanComputedQuantity(need) +
            " / 分，上限 " +
            s.inputConstraint.q +
            " / 分。请提高上限、降低目标或切换配方。",
        };
    }
  }
  const relaxed = planSolve(d, s, { mode: "shortage" });
  if (relaxed.ok) {
    const missing = Object.entries(relaxed.result)
      .filter(([k, v]) => k.startsWith("short:") && v > 1e-5)
      .map(([k, v]) => ({ id: k.slice(6), q: v }));
    if (missing.length)
      return {
        requested: d,
        targetId: id,
        targetQ: q,
        missing,
        reason: "满足该产量与锁定项，还需增加以下供给（按当前配方反推）",
      };
  }
  if (
    s.strict &&
    planSolve(d, { ...s, strict: false }, { mode: "shortage" }).ok
  )
    return {
      missing: [],
      reason: "流体副产物无法消纳：请增加下游用量、切换配方，或允许流体外送。",
    };
  return {
    missing: [],
    reason:
      "当前配方无法形成完整生产链：请检查外供起点、季节配方开关、循环配方及手工物品。",
  };
}
function changeQuantity(id, wanted, integer = false) {
  if (isPowerItem(id) && !Object.hasOwn(state.selected, id))
    state.selected[id] = defaultPowerRecipe(state);
  const p = state.products.find((p) => p.id === id);
  if (!p || p.lock) return { reason: "该产物已锁定，请先解锁。", missing: [] };
  wanted = amount(wanted);
  if (integer) wanted = Math.round(wanted);
  if (state.mode === "reverse") {
    p.q = wanted;
    return null;
  }
  const max = allocationMax(id),
    cap = max.unbounded ? 1e8 : max.ok ? Math.max(0, max.result.goal || 0) : 0,
    target = Math.min(wanted, integer ? Math.floor(cap + EPS) : cap),
    fixed = { ...lockedDemands(state, id), [id]: target },
    flex = Object.fromEntries(
      state.products
        .filter((x) => x.id !== id && !x.lock && x.q > EPS)
        .map((x) => [x.id, x.q]),
    );
  let ratio = 1;
  if (Object.keys(flex).length) {
    const r = planSolve(fixed, state, { flex, limit: 1 });
    if (!r.ok)
      return { reason: "锁定项已超过供给，请补充供给或解锁。", missing: [] };
    ratio = Math.min(1, Math.max(0, r.result.goal || 0));
  }
  for (const x of state.products)
    if (x.id !== id && !x.lock) x.q = cleanComputedQuantity(x.q * ratio);
  p.q = cleanComputedQuantity(target);
  return wanted > target + 1e-5
    ? diagnose(id, wanted)
    : ratio < 0.999999
      ? {
          missing: [],
          reason: "其他未锁定产物已按比例缩减；锁定产量保持不变。",
        }
      : null;
}
function fitSupplies() {
  if (state.mode === "reverse") return;
  const fixed = lockedDemands(),
    flex = Object.fromEntries(
      state.products
        .filter((x) => !x.lock && x.q > EPS)
        .map((x) => [x.id, x.q]),
    );
  if (!planSolve(fixed).ok) return;
  const r = Object.keys(flex).length
    ? planSolve(fixed, state, { flex, limit: 1 })
    : null;
  if (r?.ok) {
    const ratio = Math.min(1, Math.max(0, r.result.goal || 0));
    for (const p of state.products)
      if (!p.lock) p.q = cleanComputedQuantity(p.q * ratio);
  }
}
function isRecycledOutput(recipe, item) {
  const r = R[recipe];
  return Object.keys(r.outs).indexOf(item) > 0 || Object.hasOwn(r.ins, item);
}
function reuseAndStartup(plan, s = state) {
  const graph = flowGraph(plan, s),
    recipeIds = new Set(plan.rows.map((row) => row.k));
  const targets = canonicalDemands(demands(s)),
    items = new Map();
  for (const row of plan.rows)
    for (const [id, q] of Object.entries(row.outs)) {
      if (!isRecycledOutput(row.k, id) || q <= EPS || isPowerItem(id)) continue;
      const entry = items.get(id) || {
        id,
        produced: 0,
        reused: 0,
        toTarget: 0,
        surplus: 0,
        sources: new Set(),
      };
      entry.produced += q;
      entry.sources.add(row.k);
      items.set(id, entry);
    }
  for (const e of graph.edges) {
    const entry = items.get(e.item);
    if (!entry || !entry.sources.has(e.from)) continue;
    if (recipeIds.has(e.to)) entry.reused += e.q;
    else if (e.to.startsWith("p:")) entry.toTarget += e.q;
    else if (e.to.startsWith("w:")) entry.surplus += e.q;
  }
  return [...items.values()]
    .map((entry) => {
      const steady = plan.external[entry.id] || 0;
      const primaryOutput = Math.max(
        0,
        (plan.output[entry.id] || 0) - entry.produced,
      );
      // Conservative rate while byproduct output has not reached consumers yet.
      const startup = Math.max(
        steady,
        (plan.input[entry.id] || 0) + (targets[entry.id] || 0) - primaryOutput,
      );
      return {
        ...entry,
        steady,
        startup,
        additional: Math.max(0, startup - steady),
      };
    })
    .sort(
      (a, b) =>
        Number(b.reused > EPS) - Number(a.reused > EPS) ||
        b.additional - a.additional ||
        a.id.localeCompare(b.id),
    );
}
function renderReuseAndStartup(plan) {
  const rows = reuseAndStartup(plan);
  const table = rows.length
    ? `<div class="tablewrap"><table><thead><tr><th>副产物</th><th>产生 / 分</th><th>内部回用 / 分</th><th>最终产物 / 分</th><th>待处理 / 分</th><th>启动供给能力 / 分</th><th>稳态外供 / 分</th><th>回用后可减少 / 分</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(I[r.id]?.name || r.id)}<small> ${unit(r.id)}</small>${r.steady < EPS && r.additional > EPS ? '<div class="badge">需预充或临时外供</div>' : ""}</td><td>${fmt(r.produced)}</td><td>${fmt(r.reused)}</td><td>${fmt(r.toTarget)}</td><td>${fmt(r.surplus)}</td><td><b>${fmt(r.startup)}</b></td><td>${fmt(r.steady)}</td><td>${fmt(r.additional)}</td></tr>`).join("")}</tbody></table></div>`
    : '<p class="small">当前方案没有产生需要回用的副产物。</p>';
  $("processBalance").innerHTML = table;
}

function flowGraph(plan, s = state) {
  const nodes = [],
    edges = [],
    supply = {};
  const add = (id, label, type, info = {}) =>
    nodes.push({ id, label, type, ...info });
  for (const [id, q] of Object.entries(plan.external))
    if (q > 1e-6) {
      add("e:" + id, I[id].name, "external", { item: id, q });
      (supply[id] ??= []).push({ node: "e:" + id, q, priority: 2 });
    }
  for (const row of plan.rows) {
    add(row.k, R[row.k].name, "recipe", {
      row,
      item: Object.keys(row.outs)[0],
    });
    for (const [id, q] of Object.entries(row.outs))
      (supply[id] ??= []).push({
        node: row.k,
        q,
        priority: isRecycledOutput(row.k, id) ? 0 : 1,
      });
  }
  const take = (item, q, to, preferred = null) => {
    // Allocate byproducts before primary production and external supply.
    // Electricity targets still prefer their explicitly selected generator.
    const list = [...(supply[item] || [])].sort(
      (a, b) =>
        (preferred
          ? Number(recipeBase(b.node) === preferred) - Number(recipeBase(a.node) === preferred)
          : 0) || a.priority - b.priority,
    );
    for (const src of list) {
      if (q < 1e-6) break;
      const n = Math.min(q, src.q);
      if (n > 1e-6) {
        edges.push({ from: src.node, to, item, q: n });
        src.q -= n;
        q -= n;
      }
    }
  };
  for (const p of s.products)
    if (p.q > 1e-6) {
      add("p:" + p.id, productTitle(p.id, s), "product", {
        item: p.id,
        q: p.q,
      });
      take(
        materialId(p.id),
        p.q,
        "p:" + p.id,
        recipeSpecificTarget(p.id, s) ? recipeFor(p.id, s) : null,
      );
    }
  for (const row of plan.rows)
    for (const [id, q] of Object.entries(row.ins)) take(id, q, row.k);
  for (const [id, list] of Object.entries(supply)) {
    const q = list.reduce((a, x) => a + x.q, 0);
    if (q > 1e-5) {
      add("w:" + id, I[id].name, "surplus", { item: id, q });
      take(id, q, "w:" + id);
    }
  }
  return { nodes, edges };
}

const BUILD_RECIPES = (() => {
  const map = {};
  for (const [k, r] of Object.entries(R))
    if (r.kind === "build")
      for (const id of Object.keys(r.outs)) if (!map[id]) map[id] = k;
  return map;
})();
function constructionName(id) {
  return B[id.replace("Desc_", "Build_")]?.name || I[id]?.name || id;
}
function buildCost(id, n = 1) {
  const r = R[BUILD_RECIPES[id]];
  return r
    ? Object.fromEntries(
        Object.entries(r.ins).map(([k, q]) => [k, (q * n) / (r.outs[id] || 1)]),
      )
    : {};
}
function builtCount(key, n, s = state) {
  return Math.min(n, Math.floor(amount(s.built?.[key])));
}
function machineIsBuilt(row, s = state) {
  return row.n > 0 && builtCount("recipe:" + row.k, row.n, s) >= row.n;
}
function machineDisplayOrder(rows, s = state, plan = null) {
  const flow = flowGraph(plan || { rows, external: {} }, s);
  prepareBoardLayout(flow, s);
  const nodes = new Map(flow.nodes.map((n) => [n.id, n])),
    levels = [
      ...new Set(
        flow.nodes.filter((n) => n.type === "recipe").map((n) => n.level),
      ),
    ].sort((a, b) => a - b);
  return rows
    .map((row) => ({
      ...row,
      flowStage: levels.indexOf(nodes.get(row.k)?.level) + 1,
      flowCycle: !!nodes.get(row.k)?.cycle,
    }))
    .sort(
      (a, b) =>
        a.flowStage - b.flowStage ||
        (nodes.get(a.k)?.y || 0) - (nodes.get(b.k)?.y || 0) ||
        a.k.localeCompare(b.k),
    );
}
function buildProgress(key, n) {
  const done = builtCount(key, n);
  return `<label class="buildcheck"><input type="checkbox" data-built-all="${esc(key)}" data-total="${n}" ${done === n ? "checked" : ""}> 已建成</label><label class="small">已建 <input class="built-number" type="number" min="0" max="${n}" step="1" data-built-count="${esc(key)}" data-total="${n}" value="${displayNumber(done)}"> / ${fmt(n)} 台</label>`;
}
function costText(id, n) {
  if (n <= 0) return "—";
  const c = buildCost(id, n);
  return (
    Object.entries(c)
      .map(([k, q]) => `${esc(I[k]?.name || k)} <b>${fmt(q)}</b>`)
      .join(" · ") || "—"
  );
}
function machineBuildCells(row) {
  const key = "recipe:" + row.k,
    id = R[row.k].b.replace("Build_", "Desc_"),
    done = builtCount(key, row.n);
  return `<td class="wrap buildcell"><div>总建材：${costText(id, row.n)}</div><div class="remaining">待建材：${costText(id, row.n - done)}</div></td><td class="wrap">${buildProgress(key, row.n)}</td>`;
}
function constructionPlan(plan = current, s = state) {
  if (!plan) return null;
  const rows = [],
    counts = {},
    materials = {},
    remainingMaterials = {},
    unknown = [];
  const add = (
    key,
    id,
    n,
    shards = 0,
    remainingShards = shards,
    label = "",
  ) => {
    if (n <= 0) return;
    const done = builtCount(key, n, s);
    rows.push({
      key,
      id,
      n,
      done,
      left: n - done,
      shards,
      remainingShards,
      label: label || constructionName(id),
    });
    counts[id] = (counts[id] || 0) + n;
    if (!BUILD_RECIPES[id]) unknown.push(id);
    for (const [k, q] of Object.entries(buildCost(id, n)))
      materials[k] = (materials[k] || 0) + q;
    for (const [k, q] of Object.entries(buildCost(id, n - done)))
      remainingMaterials[k] = (remainingMaterials[k] || 0) + q;
  };
  for (const r of plan.rows) {
    const key = "recipe:" + r.k,
      done = builtCount(key, r.n, s),
      fullShard = Math.max(0, Math.ceil((r.cap - 1 - 1e-7) / 0.5)),
      tailShard = Math.max(0, Math.ceil((r.tail - 1 - 1e-7) / 0.5)),
      leftShards =
        Math.max(0, r.full - done) * fullShard +
        (r.tail && done < r.n ? tailShard : 0);
    add(
      key,
      R[r.k].b.replace("Build_", "Desc_"),
      r.n,
      r.shards,
      leftShards,
      R[r.k].name,
    );
  }
  for (const n of s.nodes) {
    const map = {
        mk1: "Desc_MinerMk1_C",
        mk2: "Desc_MinerMk2_C",
        mk3: "Desc_MinerMk3_C",
        oil: "Desc_OilPump_C",
        water: "Desc_WaterPump_C",
        well: "Desc_FrackingExtractor_C",
      },
      key = "node:" + n.id + ":" + n.machine,
      shard = Math.max(0, Math.ceil((n.clock - 100 - 1e-5) / 50));
    add(
      key,
      map[n.machine],
      n.count,
      n.machine === "well" ? 0 : n.count * shard,
      n.machine === "well"
        ? 0
        : (n.count - builtCount(key, n.count, s)) * shard,
      I[n.item].name + " · " + constructionName(map[n.machine]),
    );
    if (n.machine === "well") {
      const press = "press:" + n.id;
      add(
        press,
        "Desc_FrackingSmasher_C",
        n.pressurizers,
        n.pressurizers * shard,
        (n.pressurizers - builtCount(press, n.pressurizers, s)) * shard,
      );
    }
  }
  for (const purity of ["impure", "normal", "pure"]) {
    const n = normalizeGeothermal(s.geothermal)[purity];
    add(
      "geo:" + purity,
      "Desc_GeneratorGeoThermal_C",
      n,
      0,
      0,
      "地热发电 · " + purity,
    );
  }
  for (const g of s.generators) {
    const key = "gen:" + g.id + ":" + g.fuel,
      shard = Math.max(0, Math.ceil((g.clock - 100 - 1e-5) / 50));
    add(
      key,
      GEN[g.fuel].b,
      g.count,
      g.count * shard,
      (g.count - builtCount(key, g.count, s)) * shard,
      GEN[g.fuel].type + " · " + I[g.fuel].name + " " + fmt(g.clock) + "%",
    );
  }
  return {
    rows,
    counts,
    materials,
    remainingMaterials,
    devices: rows.reduce((a, r) => a + r.n, 0),
    done: rows.reduce((a, r) => a + r.done, 0),
    left: rows.reduce((a, r) => a + r.left, 0),
    shards: rows.reduce((a, r) => a + r.shards, 0),
    remainingShards: rows.reduce((a, r) => a + r.remainingShards, 0),
    unknown: [...new Set(unknown)],
  };
}
function renderBill() {
  renderProjectViews();
  const b = constructionPlan();
  if (!b) {
    $("buildStats").innerHTML = "";
    $("bill").innerHTML = "<p>先生成可行产线，再统计建材。</p>";
    return;
  }
  $("buildStats").innerHTML = [
    ["计划机器 / 设备", fmt(b.devices)],
    ["已建 / 待建", fmt(b.done) + " / " + fmt(b.left)],
    ["建设进度", `${fmt(b.devices ? (100 * b.done) / b.devices : 0)}% 已完成`],
    ["待备能量碎片", fmt(b.remainingShards)],
  ]
    .map(
      ([k, v]) =>
        `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`,
    )
    .join("");
  const extra = b.rows.filter((r) => !r.key.startsWith("recipe:"));
  $("bill").innerHTML =
    (extra.length
      ? `<h3>采集设备与发电机组</h3><div class="tablewrap"><table><thead><tr><th>设备</th><th>计划台数</th><th>本组建材</th><th>建设进度</th></tr></thead><tbody>${extra.map((r) => `<tr><td class="wrap">${esc(r.label)}</td><td>${fmt(r.n)}</td><td class="wrap">总建材：${costText(r.id, r.n)}<div class="remaining">待建材：${costText(r.id, r.left)}</div></td><td>${buildProgress(r.key, r.n)}</td></tr>`).join("")}</tbody></table></div>`
      : "") +
    `<div class="toolbar"><h3>建材汇总</h3><div class="buttons"><button data-build-action="finish">全部标记已建</button><button data-build-action="reset">重置建设进度</button></div></div><div class="tablewrap"><table><thead><tr><th>物料</th><th>总需求</th><th>已建消耗</th><th>剩余需求</th></tr></thead><tbody>${
      Object.entries(b.materials)
        .filter(([id, q]) => q > EPS)
        .sort(
          (a, c) =>
            (b.remainingMaterials[c[0]] || 0) -
            (b.remainingMaterials[a[0]] || 0),
        )
        .map(
          ([id, q]) =>
            `<tr><td>${material(id, 0).replace(" <b>0</b>", "")}</td><td>${fmt(q)}</td><td>${fmt(q - (b.remainingMaterials[id] || 0))}</td><td><b>${fmt(b.remainingMaterials[id] || 0)}</b></td></tr>`,
        )
        .join("") || '<tr><td colspan="4">暂无建造需求。</td></tr>'
    }</tbody></table></div>${b.unknown.length ? '<p class="over">缺少建造配方：' + b.unknown.map((id) => esc(constructionName(id))).join("、") + "</p>" : ""}`;
}

let graphPreview = null,
  comparison = null,
  missingChoice = null,
  genPreview = null;
function clonePlanState() {
  return JSON.parse(JSON.stringify(state));
}
function comparisonData(id, candidate) {
  const a = clonePlanState(),
    b = clonePlanState();
  b.selected[id] = candidate;
  let d = demands(a);
  if (!Object.keys(d).length) {
    a.products = [{ id, q: 1 }];
    b.products = [{ id, q: 1 }];
    d = { [id]: 1 };
  }
  const sa = planSolve(d, a, { mode: "reverse" }),
    sb = planSolve(d, b, { mode: "reverse" });
  return {
    id,
    candidate,
    a,
    b,
    d,
    base: summarize(sa, a),
    next: summarize(sb, b),
    supplied: planSolve(d, b, { mode: "forward" }).ok,
  };
}
function openComparison(id, candidate) {
  if (candidate === undefined)
    candidate =
      recipeOptions(id).find((k) => k !== recipeFor(id)) || recipeFor(id) || "";
  comparison = { id, candidate };
  $("compareTitle").textContent = I[id].name + " · 配方对比";
  $("compareChoice").innerHTML =
    '<option value="">外供 / 不自动生产</option>' +
    recipeOptions(id)
      .map((k) => `<option value="${k}">${esc(R[k].name)}</option>`)
      .join("");
  $("compareChoice").value = candidate;
  renderComparison();
  $("compareDialog").showModal();
}
function comparisonRecipeDetails(key, s, title) {
  const r = R[key];
  if (!r || r.kind !== "machine")
    return `<section class="compare-recipe"><h3>${title}</h3><p>外供 / 不自动生产</p><p class="small">该物料从外部供给取得，不配置生产机器。</p></section>`;
  const rr = rates(key, s);
  const lines = (values) =>
    Object.entries(values)
      .map(
        ([id, q]) =>
          `<div class="compare-material">${icon(id)}<span>${esc(I[id]?.name || id)}</span><strong>${fmt(q)}</strong><small>${unit(id)}</small></div>`,
      )
      .join("") || '<p class="small">无</p>';
  const amp = amplification(key, s);
  return `<section class="compare-recipe"><div class="compare-recipe-title"><small>${title}</small><h3>${esc(r.name)}</h3></div><div class="itemhead">${icon(r.b)}<div><b>${esc(B[r.b]?.name || r.b)}</b><span class="compare-recipe-basis">单台机器 · 100% 频率</span></div></div><div class="compare-material-block"><h4>输入材料</h4>${lines(rr.ins)}</div><div class="compare-material-block"><h4>输出产物</h4>${lines(rr.outs)}</div>${amp.count ? `<p class="small">索莫晶体 / 台：${amp.count} · 产出 ×${fmt(amp.boost)}</p>` : ""}</section>`;
}

function renderComparison() {
  if (!comparison) return;
  const { id } = comparison,
    candidate = $("compareChoice").value;
  comparison = comparisonData(id, candidate);
  const { base: a, next: b, d } = comparison;
  const delta = (x, y) => {
    const n = y - x;
    return (n > EPS ? "+" : "") + fmt(n);
  };
  let html = `<div class="compare-recipes">${comparisonRecipeDetails(recipeFor(id, comparison.a), comparison.a, "当前配方详情")}${comparisonRecipeDetails(candidate, comparison.b, "候选配方详情")}</div><p>固定最终产量：${Object.entries(
    d,
  )
    .map(([i, q]) => esc(I[i].name) + " " + fmt(q) + " " + unit(i))
    .join("；")}</p>`;
  if (!a || !b)
    html +=
      '<p class="over">' +
      (!a ? "当前配方" : "候选配方") +
      "无法在当前外供起点、季节开关与副产物约束下形成完整生产链。</p>";
  if (a && b) {
    html += `<div class="tablewrap"><table><thead><tr><th>整条产线</th><th>当前</th><th>候选</th><th>变化</th></tr></thead><tbody>${[
      ["机器台数", a.machines, b.machines],
      ["平均耗电 MW", a.power, b.power],
      ["峰值耗电 MW", a.peak, b.peak],
    ]
      .map(
        ([n, x, y]) =>
          `<tr><td>${n}</td><td>${fmt(x)}</td><td>${fmt(y)}</td><td>${delta(x, y)}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div><h3>外部资源需求</h3><div class="tablewrap"><table><thead><tr><th>资源 / 单位</th><th>当前</th><th>候选</th><th>变化</th></tr></thead><tbody>${[
      ...new Set([...Object.keys(a.external), ...Object.keys(b.external)]),
    ]
      .filter((i) => (a.external[i] || 0) > EPS || (b.external[i] || 0) > EPS)
      .map(
        (i) =>
          `<tr><td>${esc(I[i].name)} <small>${unit(i)}</small>${!(a.external[i] > EPS) && b.external[i] > EPS ? ' <span class="badge">新增资源</span>' : ""}</td><td>${fmt(a.external[i])}</td><td>${fmt(b.external[i])}</td><td>${delta(a.external[i] || 0, b.external[i] || 0)}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
    if (candidate && !b.rows.some((r) => r.k === candidate))
      html +=
        '<p class="notice">此目标已由其他工序的副产物满足，候选配方无需运行。</p>';
  }
  if (b && state.mode === "forward" && !comparison.supplied)
    html +=
      '<p class="notice">当前供给不足以维持这些产量。应用后未锁定产物会重新分配，锁定项保持不变。</p>';
  $("compareBody").innerHTML = html;
  $("applyComparison").disabled = !b || candidate === (recipeFor(id) || "");
}
function missingPlan(d = diagnostic) {
  if (!d?.requested) return null;
  const s = clonePlanState();
  s.products = s.products.map((p) => ({ ...p, q: d.requested[p.id] || 0 }));
  const sol = planSolve(d.requested, s, { mode: "shortage" }),
    plan = summarize(sol, s);
  return plan ? { plan, s } : null;
}
function openMissing(id) {
  if (!diagnostic?.missing?.length) return;
  missingChoice = id;
  $("missingMessage").textContent = "";
  const pool = supplyPool();
  $("missingBody").innerHTML =
    `<p>${esc(diagnostic.reason)}</p><div class="tablewrap"><table><thead><tr><th>添加</th><th>物料</th><th>现有供给</th><th>缺口 / 分</th><th>本次添加 / 分</th></tr></thead><tbody>${diagnostic.missing.map((x) => `<tr><td><input type="checkbox" data-missing-check="${x.id}" ${x.id === id ? "checked" : ""}></td><td>${esc(I[x.id].name)} <small>${unit(x.id)}</small></td><td>${fmt(pool[x.id])}</td><td>${fmt(x.q)}</td><td><input type="number" min="0" step="any" data-missing-amount="${x.id}" value="${displayNumber(+x.q.toFixed(3))}"></td></tr>`).join("")}</tbody></table></div>`;
  const preview = missingPlan();
  if (preview) {
    const affected = preview.plan.rows.filter((r) => r.ins[id] > EPS);
    $("missingBody").innerHTML +=
      `<h3>直接使用${esc(I[id].name)}的工序</h3><p>${affected.map((r) => esc(R[r.k].name) + " · " + fmt(r.ins[id]) + " " + unit(id)).join("；") || "查看目标产线的供给路径。"}</p>`;
  }
  $("missingGraph").disabled = !preview;
  $("missingDialog").showModal();
}
function showMissingGraph() {
  const preview = missingPlan();
  if (!preview) return;
  graphPreview = { ...preview, item: missingChoice };
  dirtyGraph = true;
  $("missingDialog").close();
  switchTab("graph");
  $("viewNetwork").click();
  requestAnimationFrame(() => {
    const node = document.querySelector(
      '[data-missing-node="' + missingChoice + '"]',
    );
    node?.scrollIntoView({ block: "center", inline: "center" });
  });
}
function graphHighlight(g) {
  const nodes = new Set(),
    edges = new Set();
  if (!graphPreview) return { nodes, edges };
  nodes.add("e:" + graphPreview.item);
  let again = true;
  while (again) {
    again = false;
    for (const e of g.edges)
      if (nodes.has(e.from) && !nodes.has(e.to)) {
        nodes.add(e.to);
        again = true;
      }
  }
  for (const e of g.edges)
    if (nodes.has(e.from) && nodes.has(e.to)) edges.add(e);
  return { nodes, edges };
}
function renderGraphPreviewLabel() {
  const el = $("graphPreviewLabel");
  if (!el) return;
  el.hidden = !graphPreview;
  el.innerHTML = graphPreview
    ? `缺料目标预览：${esc(I[graphPreview.item].name)}的影响路径已标红。<button id="leavePreview">返回当前产线</button> <button data-inspectmissing="${graphPreview.item}">选择添加供给</button>`
    : "";
}
function initEnhancements() {
  document.addEventListener("click", (e) => {
    const d = e.target.closest("button")?.dataset || {};
    if (d.compare) openComparison(d.compare);
    if (d.inspectmissing) openMissing(d.inspectmissing);
    if (e.target.closest("[data-missing-node]"))
      openMissing(e.target.closest("[data-missing-node]").dataset.missingNode);
    if (e.target.id === "leavePreview") {
      graphPreview = null;
      dirtyGraph = true;
      renderGraph();
    }
    if (d.buildAction) {
      const b = constructionPlan();
      if (!b) return;
      for (const r of b.rows)
        state.built[r.key] = d.buildAction === "finish" ? r.n : 0;
      renderResults();
      save();
    }
  });
  document.addEventListener("change", (e) => {
    const d = e.target.dataset,
      key = d.builtAll || d.builtCount;
    if (!key) return;
    state.built ??= {};
    state.built[key] = d.builtAll
      ? e.target.checked
        ? +d.total
        : 0
      : Math.min(+d.total, Math.floor(amount(e.target.value)));
    renderResults();
    save();
  });
  $("closeComparison").onclick = () => $("compareDialog").close();
  $("compareChoice").onchange = renderComparison;
  $("applyComparison").onclick = () => {
    if (!comparison?.next) return;
    const { id, candidate } = comparison;
    $("compareDialog").close();
    applyRecipe(id, candidate);
  };
  $("closeMissing").onclick = () => $("missingDialog").close();
  $("missingGraph").onclick = showMissingGraph;
  $("addSelectedMissing").onclick = () => {
    let n = 0;
    for (const x of diagnostic?.missing || []) {
      if (!document.querySelector(`[data-missing-check="${x.id}"]`)?.checked)
        continue;
      const q = amount(
        document.querySelector(`[data-missing-amount="${x.id}"]`)?.value,
      );
      if (q <= EPS || hasProductMaterial(x.id) || I[x.id].handOnly) continue;
      let sup = state.supplies.find((s) => s.id === x.id);
      if (!sup) {
        sup = { id: x.id, q: 0, stop: true };
        state.supplies.push(sup);
      }
      sup.q += q;
      n++;
    }
    if (!n) {
      $("missingMessage").textContent = "请勾选物料并填写大于0的添加量。";
      return;
    }
    $("missingDialog").close();
    diagnostic = null;
    renderAll();
    setStatus("已添加所选供给；可以再次调整目标产量。");
  };
}

const WORKSPACE_KEY = "factory-workspace-12",
  BELTS = [60, 120, 270, 480, 780, 1200];
function emptyWorkspace() {
  return {
    format: "satisfactory-workspace",
    configVersion: 1,
    gameVersion: DATA.version,
    active: { name: "未命名方案", kind: "new", id: null },
    existing: null,
    plans: [],
    nextId: 1,
    compareId: "existing",
    previous: null,
  };
}
let workshop = emptyWorkspace(),
  workspaceReady = false,
  saveProblem = false;
function copy(x) {
  return JSON.parse(JSON.stringify(x));
}
function cleanTitle(x, fallback) {
  return typeof x === "string" && x.trim() ? x.trim().slice(0, 100) : fallback;
}
function validSnapshot(x) {
  if (!x || typeof x !== "object") throw Error("配置中缺少方案内容");
  return safeState(x);
}
function normalizeWorkspace(x) {
  if (x?.format !== "satisfactory-workspace" || x.configVersion !== 1)
    throw Error("不支持此配置格式或版本");
  const w = emptyWorkspace();
  w.active = {
    name: cleanTitle(x.active?.name, "未命名方案"),
    kind: x.active?.kind === "retrofit" ? "retrofit" : "new",
    id: Number.isInteger(x.active?.id) ? x.active.id : null,
  };
  const s = validSnapshot(x.active?.state);
  if (!Array.isArray(x.plans)) throw Error("配置中的方案列表无效");
  const used = new Set();
  w.plans = x.plans.map((p, i) => {
    const id = Number.isInteger(p.id) && p.id > 0 ? p.id : i + 1;
    if (used.has(id)) throw Error("配置中方案编号重复");
    used.add(id);
    return {
      id,
      name: cleanTitle(p.name, "方案" + id),
      kind: p.kind === "retrofit" ? "retrofit" : "new",
      savedAt: typeof p.savedAt === "string" ? p.savedAt : "",
      state: validSnapshot(p.state),
    };
  });
  w.nextId = Math.max(
    1,
    ...w.plans.map((p) => p.id + 1),
    Number.isInteger(x.nextId) ? x.nextId : 1,
  );
  w.compareId =
    x.compareId === "existing" ? "existing" : String(x.compareId || "existing");
  if (x.existing) {
    const e = x.existing,
      es = validSnapshot(e.state);
    if (
      !e.inventory ||
      typeof e.inventory !== "object" ||
      Array.isArray(e.inventory)
    )
      throw Error("已有产线缺少设备清单");
    w.existing = {
      name: cleanTitle(e.name, "已有产线"),
      recordedAt: typeof e.recordedAt === "string" ? e.recordedAt : "",
      scope: e.scope === "built" ? "built" : "all",
      state: es,
      inventory: Object.fromEntries(
        Object.entries(e.inventory)
          .filter(([id]) => BUILD_RECIPES[id])
          .map(([id, q]) => [id, Math.floor(amount(q))]),
      ),
    };
  }
  if (x.previous?.state)
    w.previous = {
      active: {
        name: cleanTitle(x.previous.active?.name, "切换前编辑"),
        kind: x.previous.active?.kind === "retrofit" ? "retrofit" : "new",
        id: Number.isInteger(x.previous.active?.id)
          ? x.previous.active.id
          : null,
      },
      state: validSnapshot(x.previous.state),
    };
  return { w, s };
}
function workspacePayload() {
  return {
    ...copy(workshop),
    active: { ...copy(workshop.active), state: copy(state) },
    gameVersion: DATA.version,
  };
}
function persistWorkspace() {
  if (!workspaceReady) return;
  recordUndoHistory();
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspacePayload()));
    saveProblem = false;
  } catch {
    saveProblem = true;
  }
  if ($("storageStatus"))
    $("storageStatus").textContent = saveProblem
      ? "浏览器保存失败，请导出配置文件。"
      : "配置已自动保存在当前浏览器";
}
function loadWorkspace() {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (raw) {
      const { w, s } = normalizeWorkspace(JSON.parse(raw));
      workshop = w;
      state = s;
    } else {
      const old = localStorage.getItem("factory-workbench-12");
      if (old) state = safeState(JSON.parse(old));
    }
    workspaceReady = true;
  } catch (e) {
    workspaceReady = false;
    saveProblem = true;
    setTimeout(
      () =>
        setStatus(
          "读取已保存配置失败：" + e.message + "。原配置已保留，可重新导入。",
          true,
        ),
      0,
    );
  }
}
function exportSinglePlan(plan = null) {
  const source = plan || { ...workshop.active, state };
  const payload = PlanFiles.payload(source, DATA.version);
  download(PlanFiles.filename(payload.name), JSON.stringify(payload, null, 2));
}
async function importWorkspaceFile(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  try {
    const batches = await Promise.all(files.map(async file => PlanFiles.read(
      JSON.parse(await file.text()), file.name.replace(/\.json$/i, ''), validSnapshot,
    )));
    const incoming = batches.flat();
    workshop = PlanFiles.merge(workshop, incoming);
    workspaceReady = true;
    save();
    renderWorkspace();
    setStatus('已合并 ' + incoming.length + ' 个方案，可在方案列表中载入。');
  } catch (err) {
    setStatus('导入失败：' + err.message, true);
  } finally {
    e.target.value = '';
  }
}
function evaluatePlan(s) {
  const p = summarize(planSolve(demands(s), s, { mode: s.mode }), s);
  return p ? { plan: p, bill: constructionPlan(p, s) } : null;
}
function lineLanes(q, cap) {
  return q > EPS ? Math.max(1, Math.ceil(q / cap - 1e-8)) : 0;
}
function logisticsPlan(plan = current, s = state) {
  if (!plan) return { links: [], ports: [], nodes: [] };
  const f = flowGraph(plan, s),
    names = Object.fromEntries(
      f.nodes.map((n) => [
        n.id,
        n.type === "recipe"
          ? n.label + " / " + (B[R[n.id].b]?.name || "机器")
          : ({ external: "外供 · ", product: "成品 · ", surplus: "外送 · " }[
              n.type
            ] || "") + n.label,
      ]),
    ),
    caps = s.transport || { belt: 1200, pipe: 600 };
  const links = f.edges.map((e) => {
    const cap = I[e.item].fluid ? caps.pipe : caps.belt;
    return {
      ...e,
      fromName: names[e.from],
      toName: names[e.to],
      cap,
      lanes: lineLanes(e.q, cap),
    };
  });
  const ports = [];
  for (const row of plan.rows) {
    const rr = rates(row.k, s),
      clock = Math.max(row.full ? row.cap : 0, row.tail);
    for (const [direction, values] of [
      ["输入", rr.ins],
      ["输出", rr.outs],
    ])
      for (const [id, base] of Object.entries(values)) {
        const cap = I[id].fluid ? caps.pipe : caps.belt,
          q = base * clock;
        if (q > cap + EPS)
          ports.push({
            recipe: row.k,
            item: id,
            direction,
            q,
            cap,
            maxClock: (cap / base) * 100,
          });
      }
  }
  return { links, ports, nodes: f.nodes };
}
function constructionStages(plan = current, s = state) {
  if (!plan) return [];
  const g = flowGraph(plan, s),
    recipes = new Set(plan.rows.map((r) => r.k)),
    adj = new Map([...recipes].map((k) => [k, new Set()]));
  for (const e of g.edges)
    if (recipes.has(e.from) && recipes.has(e.to)) adj.get(e.from).add(e.to);
  let index = 0,
    stack = [],
    idx = {},
    low = {},
    on = new Set(),
    components = [],
    component = {};
  function visit(v) {
    idx[v] = low[v] = index++;
    stack.push(v);
    on.add(v);
    for (const w of adj.get(v)) {
      if (idx[w] === undefined) {
        visit(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (on.has(w)) low[v] = Math.min(low[v], idx[w]);
    }
    if (low[v] === idx[v]) {
      let w,
        group = [];
      do {
        w = stack.pop();
        on.delete(w);
        component[w] = components.length;
        group.push(w);
      } while (w !== v);
      components.push(group);
    }
  }
  for (const k of recipes) if (idx[k] === undefined) visit(k);
  const parents = components.map(() => new Set());
  for (const [k, outs] of adj)
    for (const v of outs)
      if (component[k] !== component[v])
        parents[component[v]].add(component[k]);
  const ranks = {};
  function rank(c) {
    return (
      ranks[c] ??
      (ranks[c] = parents[c].size
        ? Math.max(...[...parents[c]].map(rank)) + 1
        : 1)
    );
  }
  return components
    .map((keys, i) => ({
      stage: rank(i),
      cycle: keys.length > 1 || adj.get(keys[0]).has(keys[0]),
      keys,
      rows: keys.map((k) => plan.rows.find((r) => r.k === k)),
    }))
    .sort((a, b) => a.stage - b.stage || a.keys[0].localeCompare(b.keys[0]));
}
function renderProjectViews() {
  if (!$("logisticsRows")) return;
  $("beltCapacity").value = state.transport.belt;
  $("pipeCapacity").value = state.transport.pipe;
  const l = logisticsPlan(),
    b = constructionPlan(),
    all = $("allLogistics").checked,
    links = l.links.filter((e) => all || e.lanes > 1);
  $("logisticsStats").textContent = current
    ? `${l.links.length}条物料连接 · ${l.links.filter((e) => e.lanes > 1).length}条需要并行线路 · ${l.ports.length}处单机接口超限`
    : "先生成可行产线";
  $("logisticsRows").innerHTML =
    links
      .map(
        (e) =>
          `<tr class="${e.lanes > 1 ? "capacity-warning" : ""}"><td class="wrap">${esc(e.fromName)} → ${esc(e.toName)}</td><td>${esc(I[e.item].name)}</td><td>${fmt(e.q)} ${unit(e.item)}</td><td>${fmt(e.cap)}</td><td><b>${e.lanes}条${I[e.item].fluid ? "管道" : "传送带"}</b></td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="5">' +
      (current ? "当前没有需要并行的连接。" : "暂无产线。") +
      "</td></tr>";
  $("portWarnings").innerHTML = l.ports.length
    ? "<h3>单台机器接口超限</h3>" +
      l.ports
        .map(
          (x) =>
            `<p class="over">${esc(R[x.recipe].name)} · ${esc(I[x.item].name)}${x.direction} ${fmt(x.q)} ${unit(x.item)}；当前线路上限 ${x.cap}，单台频率需不高于 ${fmt(x.maxClock)}%。</p>`,
        )
        .join("")
    : "";
  if (!current || !b) {
    $("buildSequence").innerHTML = "<p>先生成可行产线。</p>";
    if (!$("workspaceTab").hidden) renderWorkspace();
    return;
  }
  const stages = constructionStages();
  const prep = b.rows.filter((r) => !r.key.startsWith("recipe:"));
  $("buildSequence").innerHTML =
    (prep.length
      ? `<details open class="stage"><summary>准备 / 采集与供电设备</summary>${prep.map((r) => `<div class="stage-row"><div><b>${esc(r.label)}</b><small> ${r.n} 台</small></div><div>${buildProgress(r.key, r.n)}</div></div>`).join("")}</details>`
      : "") +
      stages
        .map(
          (g) =>
            `<details open class="stage"><summary>第 ${g.stage} 步${g.cycle ? " · 循环工序，同组建设" : ""}</summary>${g.rows
              .map((r) => {
                const key = "recipe:" + r.k,
                  done = builtCount(key, r.n);
                return `<div class="stage-row"><div><b>${esc(R[r.k].name)}</b><p>${esc(B[R[r.k].b].name)} · ${machineLabel(r)}</p><small>${Object.entries(
                  r.outs,
                )
                  .map(
                    ([id, q]) =>
                      esc(I[id].name) + " " + fmt(q) + " " + unit(id),
                  )
                  .join(
                    "；",
                  )}</small><p class="remaining">待建材：${costText(R[r.k].b.replace("Build_", "Desc_"), r.n - done)}</p><button data-locate-machine="${r.k}">查看机器配置</button></div><div>${buildProgress(key, r.n)}</div></div>`;
              })
              .join("")}</details>`,
        )
        .join("") || "<p>暂无生产工序。</p>";
  if (!$("workspaceTab").hidden) renderWorkspace();
}
function retrofitReport(
  base = workshop.existing,
  ev = current ? { plan: current, bill: constructionPlan() } : null,
) {
  if (!base || !ev) return null;
  const rows = [
    ...new Set([
      ...Object.keys(base.inventory),
      ...Object.keys(ev.bill.counts),
    ]),
  ]
    .map((id) => {
      const existing = base.inventory[id] || 0,
        target = ev.bill.counts[id] || 0;
      return {
        id,
        existing,
        target,
        reuse: Math.min(existing, target),
        add: Math.max(0, target - existing),
        spare: Math.max(0, existing - target),
      };
    })
    .filter((r) => r.existing || r.target);
  const materials = {};
  for (const r of rows)
    for (const [id, q] of Object.entries(buildCost(r.id, r.add)))
      materials[id] = (materials[id] || 0) + q;
  return {
    rows,
    materials,
    reuse: rows.reduce((a, r) => a + r.reuse, 0),
    add: rows.reduce((a, r) => a + r.add, 0),
    spare: rows.reduce((a, r) => a + r.spare, 0),
  };
}
function renderWorkspace() {
  if (!$("plansList")) return;
  $("activePlanName").value = workshop.active.name;
  $("activePlanKind").value = workshop.active.kind;
  $("activePlanTag").textContent = workshop.active.id
    ? "编辑方案 #" + workshop.active.id
    : "未保存为命名方案";
  $("updatePlan").disabled = !workshop.plans.some(
    (p) => p.id === workshop.active.id,
  );
  $("restoreDraft").disabled = !workshop.previous;
  $("storageStatus").textContent = saveProblem
    ? "浏览器保存失败，请导出配置文件。"
    : "配置已自动保存在当前浏览器";
  const e = workshop.existing;
  $("existingSummary").innerHTML = e
    ? `<h3>${esc(e.name)}</h3><p>${Object.values(e.inventory).reduce((a, n) => a + n, 0)} 台设备 · ${e.scope === "built" ? "按已建数量记录" : "按完整产线记录"} · ${esc(e.recordedAt.replace("T", " ").slice(0, 19))} UTC</p><details><summary>已有机器清单</summary><div class="tablewrap"><table><thead><tr><th>机器</th><th>已有数量</th></tr></thead><tbody>${Object.entries(
        e.inventory,
      )
        .filter(([, n]) => n > 0)
        .map(
          ([id, n]) =>
            `<tr><td>${esc(constructionName(id))}</td><td>${n}</td></tr>`,
        )
        .join(
          "",
        )}</tbody></table></div></details><div class="buttons"><button id="loadExisting">载入已有产线设计</button><button id="reuseExisting">按已有机器设置已建数量</button></div>`
    : "<p>尚未记录已有产线。</p>";
  $("plansList").innerHTML = workshop.plans.length
    ? `<div class="tablewrap"><table><thead><tr><th>名称</th><th>类型</th><th>保存时间</th><th>操作</th></tr></thead><tbody>${workshop.plans.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.kind === "retrofit" ? "改装" : "新建"}</td><td>${esc(p.savedAt.replace("T", " ").slice(0, 19))} UTC</td><td><div class="buttons"><button data-load-plan="${p.id}">载入</button><button data-export-plan="${p.id}">导出方案</button><button data-export-supply="${p.id}" ${p.id === workshop.active.id ? "disabled" : ""}>产物 → 当前供给</button><button data-compare-plan="${p.id}">对比</button><button data-delete-plan="${p.id}">删除</button></div></td></tr>`).join("")}</tbody></table></div>`
    : "<p>尚未保存命名方案。</p>";
  $("planCompareChoice").innerHTML =
    '<option value="existing">已有产线基准</option>' +
    workshop.plans
      .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
      .join("");
  $("planCompareChoice").value = workshop.compareId;
  if (!$("planCompareChoice").value) {
    workshop.compareId = "existing";
    $("planCompareChoice").value = "existing";
  }
  renderPlanComparison();
  renderRetrofit();
}
function renderPlanComparison() {
  const ref =
    workshop.compareId === "existing"
      ? workshop.existing
      : workshop.plans.find((p) => String(p.id) === workshop.compareId);
  if (!ref) {
    $("planComparison").innerHTML =
      "<p>先记录已有产线，或选择一个已保存方案。</p>";
    return;
  }
  const a = evaluatePlan(ref.state),
    b = current ? { plan: current, bill: constructionPlan() } : null;
  if (!a || !b) {
    $("planComparison").innerHTML =
      '<p class="over">有方案不可行，请检查供给或目标产量。</p>';
    return;
  }
  const delta = (x, y) => (y - x > EPS ? "+" : "") + fmt(y - x);
  const table = (label, ids, left, right) =>
    `<h3>${label}</h3><div class="tablewrap"><table><thead><tr><th>物料 / 单位</th><th>${esc(ref.name)}</th><th>当前方案</th><th>变化</th></tr></thead><tbody>${ids
      .filter((id) => (left[id] || 0) > EPS || (right[id] || 0) > EPS)
      .map(
        (id) =>
          `<tr><td>${esc(I[id]?.name || id)} <small>${unit(id)}</small></td><td>${fmt(left[id])}</td><td>${fmt(right[id])}</td><td>${delta(left[id] || 0, right[id] || 0)}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
  $("planComparison").innerHTML =
    `<div class="tablewrap"><table><thead><tr><th>指标</th><th>${esc(ref.name)}</th><th>当前方案</th><th>变化</th></tr></thead><tbody>${[
      ["规划设备总数", a.bill.devices, b.bill.devices],
      ["平均耗电 MW", a.plan.power, b.plan.power],
      ["峰值耗电 MW", a.plan.peak, b.plan.peak],
    ]
      .map(
        ([n, x, y]) =>
          `<tr><td>${n}</td><td>${fmt(x)}</td><td>${fmt(y)}</td><td>${delta(x, y)}</td></tr>`,
      )
      .join("")}</tbody></table></div>` +
    table(
      "最终产量",
      [
        ...new Set([
          ...ref.state.products.map((p) => p.id),
          ...state.products.map((p) => p.id),
        ]),
      ],
      demands(ref.state),
      demands(),
    ) +
    table(
      "外部供给需求",
      [
        ...new Set([
          ...Object.keys(a.plan.external),
          ...Object.keys(b.plan.external),
        ]),
      ],
      a.plan.external,
      b.plan.external,
    );
}
function renderRetrofit() {
  const r = retrofitReport();
  if (!r) {
    $("retrofitReport").innerHTML =
      "<p>记录已有产线后，在这里查看当前方案的改装需求。</p>";
    return;
  }
  const old = evaluatePlan(workshop.existing.state);
  $("retrofitReport").innerHTML =
    `<div class="stats"><div class="stat"><span>同型号可复用</span><strong>${r.reuse} 台</strong></div><div class="stat"><span>需要新增</span><strong>${r.add} 台</strong></div><div class="stat"><span>可闲置 / 拆除</span><strong>${r.spare} 台</strong></div></div><div class="tablewrap"><table><thead><tr><th>机器型号</th><th>已有</th><th>目标</th><th>可复用</th><th>新增</th><th>多余</th></tr></thead><tbody>${r.rows.map((x) => `<tr><td>${esc(constructionName(x.id))}</td><td>${x.existing}</td><td>${x.target}</td><td>${x.reuse}</td><td>${x.add}</td><td>${x.spare}</td></tr>`).join("")}</tbody></table></div><h3>新增机器建材</h3><div class="chipline">${
      Object.entries(r.materials)
        .filter(([, q]) => q > EPS)
        .map(
          ([id, q]) =>
            `<span class="chip">${esc(I[id].name)} <b>${fmt(q)}</b></span>`,
        )
        .join("") || "无需新增机器建材。"
    }</div><h3>工序与频率调整</h3><div class="tablewrap"><table><thead><tr><th>工序</th><th>已有设计</th><th>改装目标</th></tr></thead><tbody>${[
      ...new Set([
        ...(old?.plan.rows || []).map((x) => x.k),
        ...current.rows.map((x) => x.k),
      ]),
    ]
      .map((k) => {
        const a = old?.plan.rows.find((x) => x.k === k),
          b = current.rows.find((x) => x.k === k);
        return `<tr><td>${esc(R[k].name)}</td><td>${a ? machineLabel(a) : "—"}</td><td>${b ? machineLabel(b) : "停用此工序"}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
}
function rememberEditing() {
  workshop.previous = { active: copy(workshop.active), state: copy(state) };
}
function loadNamedPlan(p) {
  rememberEditing();
  state = validSnapshot(p.state);
  workshop.active = { name: p.name, kind: p.kind || "new", id: p.id || null };
  renderAll();
  renderWorkspace();
  setStatus("已载入 " + p.name + "；切换前的编辑可恢复。");
}
function applyExistingProgress() {
  const e = workshop.existing,
    b = constructionPlan();
  if (!e || !b) return;
  const pool = copy(e.inventory),
    built = { ...state.built },
    old = evaluatePlan(e.state);
  for (const r of b.rows) {
    const match = old?.bill.rows.find((x) => x.key === r.key && x.id === r.id),
      n = Math.min(r.n, pool[r.id] || 0, match?.n || 0);
    built[r.key] = n;
    pool[r.id] = (pool[r.id] || 0) - n;
  }
  for (const r of b.rows) {
    const n = Math.min(r.n - built[r.key], pool[r.id] || 0);
    built[r.key] += n;
    pool[r.id] = (pool[r.id] || 0) - n;
  }
  state.built = built;
  renderResults();
  save();
  setStatus("已按同型号设备分配可复用机器，剩余建材已更新。");
}
function initProjects() {
  $("beltCapacity").onchange = $("pipeCapacity").onchange = () => {
    state.transport = {
      belt: +$("beltCapacity").value,
      pipe: +$("pipeCapacity").value,
    };
    renderProjectViews();
    dirtyGraph = true;
    if (!$("graphTab").hidden) renderGraph();
    save();
  };
  $("allLogistics").onchange = renderProjectViews;
  for (const id of ["activePlanName", "activePlanKind"])
    $(id).onchange = () => {
      workshop.active.name = cleanTitle(
        $("activePlanName").value,
        "未命名方案",
      );
      workshop.active.kind = $("activePlanKind").value;
      save();
    };
  $("saveNewPlan").onclick = () => {
    const id = workshop.nextId++,
      name = cleanTitle($("activePlanName").value, "方案" + id),
      kind = $("activePlanKind").value;
    workshop.plans.push({
      id,
      name,
      kind,
      savedAt: new Date().toISOString(),
      state: copy(state),
    });
    workshop.active = { id, name, kind };
    save();
    renderWorkspace();
    setStatus("已保存方案：" + name);
  };
  $("updatePlan").onclick = () => {
    const p = workshop.plans.find((p) => p.id === workshop.active.id);
    if (!p) return;
    Object.assign(p, {
      name: cleanTitle($("activePlanName").value, p.name),
      kind: $("activePlanKind").value,
      savedAt: new Date().toISOString(),
      state: copy(state),
    });
    workshop.active = { id: p.id, name: p.name, kind: p.kind };
    save();
    renderWorkspace();
    setStatus("已更新命名方案。");
  };
  $("recordExisting").onclick = () => {
    const b = constructionPlan();
    if (!b) {
      setStatus("先生成可行产线再记录基准。", true);
      return;
    }
    const scope = $("existingScope").value,
      inventory = {};
    for (const r of b.rows)
      inventory[r.id] =
        (inventory[r.id] || 0) + (scope === "built" ? r.done : r.n);
    const baselineState = copy(state);
    if (scope === "all")
      for (const r of b.rows) baselineState.built[r.key] = r.n;
    workshop.existing = {
      name: cleanTitle($("existingName").value, "已有产线"),
      recordedAt: new Date().toISOString(),
      scope,
      state: baselineState,
      inventory,
    };
    save();
    renderWorkspace();
    setStatus("已记录已有产线基准。后续编辑不会改变此基准。");
  };
  $("restoreDraft").onclick = () => {
    if (!workshop.previous) return;
    const p = copy(workshop.previous);
    rememberEditing();
    state = p.state;
    workshop.active = p.active;
    renderAll();
    renderWorkspace();
    setStatus("已恢复切换前的编辑。");
  };
  $("planCompareChoice").onchange = (e) => {
    workshop.compareId = e.target.value;
    renderPlanComparison();
    save();
  };
  $("exportConfig").onclick = () => exportSinglePlan();
  document.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    const d = button.dataset;
    if (d.exportPlan) {
      const plan = workshop.plans.find(p => p.id === +d.exportPlan);
      if (plan) exportSinglePlan(plan);
    }
    if (d.loadPlan) {
      const p = workshop.plans.find((p) => p.id === +d.loadPlan);
      if (p) loadNamedPlan(p);
    }
    if (d.comparePlan) {
      workshop.compareId = d.comparePlan;
      renderWorkspace();
      $("planCompareSection").scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
      save();
    }
    if (d.deletePlan) {
      workshop.plans = workshop.plans.filter((p) => p.id !== +d.deletePlan);
      if (workshop.active.id === +d.deletePlan) workshop.active.id = null;
      save();
      renderWorkspace();
    }
    if (button.id === "loadExisting" && workshop.existing)
      loadNamedPlan({ ...workshop.existing, kind: "retrofit" });
    if (button.id === "reuseExisting") applyExistingProgress();
    if (d.locateMachine) {
      switchTab("planner");
      revealPlannerTarget("machine-" + d.locateMachine);
    }
  });
  renderProjectViews();
}

const MAP_BY_ID = Object.fromEntries(MAP_DATA.nodes.map((n) => [n.id, n]));
const MAP_TYPES = {
  node: "矿点",
  well: "资源井",
  geyser: "间歇泉",
  "slug-blue": "蓝色能量蛞蝓",
  "slug-yellow": "黄色能量蛞蝓",
  "slug-purple": "紫色能量蛞蝓",
  mercer: "梅瑟尔球",
  somersloop: "索莫晶体",
  "hard-drive": "硬盘",
};
const MAP_PURITY = { impure: "贫瘠", normal: "普通", pure: "纯净" };
const MAP_RESOURCE_LAYERS = [
  ...new Set(
    MAP_DATA.nodes
      .filter((n) => ["node", "well", "geyser"].includes(n.kind))
      .map((n) => n.layer),
  ),
];
const MAP_POI_LAYERS = [
  "hard-drive",
  "slug-blue",
  "slug-yellow",
  "slug-purple",
  "mercer",
  "somersloop",
];
function freshMap() {
  return {
    view: { x: 503.015, y: 0, zoom: 1 },
    layers: [
      ...new Set(
        MAP_DATA.nodes
          .filter((n) => ["node", "well", "geyser"].includes(n.kind))
          .map((n) => n.layer),
      ),
    ],
    purities: ["impure", "normal", "pure"],
    kind: "all",
    minZ: -1000,
    maxZ: 1000,
    pins: [],
    collected: [],
    terrain: true,
    grid: false,
    baseline: true,
    hideUsed: false,
    hideCollected: true,
    measure: [],
  };
}
function normalizeMap(x) {
  const m = freshMap();
  if (!x || typeof x !== "object") return m;
  const coordinate = (v, d = 0) =>
    Number.isFinite(+v) ? Math.max(-10000, Math.min(10000, +v)) : d;
  m.view = {
    x: coordinate(x.view?.x, 503.015),
    y: coordinate(x.view?.y),
    zoom: Math.max(1, Math.min(32, +x.view?.zoom || 1)),
  };
  if (Array.isArray(x.layers))
    m.layers = [
      ...new Set(
        x.layers.filter(
          (k) => MAP_RESOURCE_LAYERS.includes(k) || MAP_POI_LAYERS.includes(k),
        ),
      ),
    ];
  if (Array.isArray(x.purities))
    m.purities = [
      ...new Set(x.purities.filter((k) => Object.hasOwn(MAP_PURITY, k))),
    ];
  m.kind = ["all", "node", "well", "geyser"].includes(x.kind) ? x.kind : "all";
  m.minZ = coordinate(x.minZ, -1000);
  m.maxZ = coordinate(x.maxZ, 1000);
  if (m.minZ > m.maxZ) [m.minZ, m.maxZ] = [m.maxZ, m.minZ];
  for (const k of ["terrain", "grid", "baseline", "hideUsed", "hideCollected"])
    if (typeof x[k] === "boolean") m[k] = x[k];
  const used = new Set();
  m.pins = (Array.isArray(x.pins) ? x.pins : [])
    .filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        !used.has(p.id) &&
        used.add(p.id) &&
        Number.isFinite(+p.x) &&
        Number.isFinite(+p.y),
    )
    .map((p) => ({
      id: p.id.slice(0, 120),
      name: cleanTitle(p.name, "工厂标记"),
      kind: ["existing", "planned", "note"].includes(p.kind)
        ? p.kind
        : "planned",
      x: coordinate(p.x),
      y: coordinate(p.y),
      note: typeof p.note === "string" ? p.note.slice(0, 500) : "",
    }));
  m.collected = (Array.isArray(x.collected) ? x.collected : []).filter(
    (id) =>
      MAP_BY_ID[id] && !["node", "well", "geyser"].includes(MAP_BY_ID[id].kind),
  );
  m.measure = (Array.isArray(x.measure) ? x.measure : [])
    .slice(0, 2)
    .filter((p) => Number.isFinite(+p.x) && Number.isFinite(+p.y))
    .map((p) => ({ x: coordinate(p.x), y: coordinate(p.y) }));
  return m;
}
function bindMappedNode(out, raw) {
  const n = MAP_BY_ID[raw.mapId];
  if (!n || !["node", "well"].includes(n.kind)) return out;
  out.mapId = n.id;
  out.mapCore = n.core || "";
  out.item = n.item;
  out.purity = n.purity;
  out.count = 1;
  if (n.kind === "well") out.machine = "well";
  else if (n.item === "Desc_LiquidOil_C") out.machine = "oil";
  else if (!["mk1", "mk2", "mk3"].includes(out.machine)) out.machine = "mk1";
  return out;
}
function normalizeMappedGroups(s = state) {
  const used = new Set();
  s.nodes = s.nodes.filter(
    (n) => !n.mapId || (!used.has(n.mapId) && used.add(n.mapId)),
  );
  const groups = {};
  for (const n of s.nodes)
    if (n.mapCore) {
      if (!groups[n.mapCore]) {
        groups[n.mapCore] = n;
        n.pressurizers = 1;
      } else {
        n.pressurizers = 0;
        n.clock = groups[n.mapCore].clock;
      }
    }
}
let mapUI = {
  ready: false,
  image: null,
  images: {},
  selected: null,
  mode: "browse",
  width: 0,
  height: 0,
  pointers: new Map(),
  dragged: false,
  pendingPin: null,
  frame: 0,
  hover: null,
};
function mapLabel(n) {
  return I[n.item]?.name || MAP_TYPES[n.kind] || n.name;
}
function mapScale() {
  return (
    (Math.min(mapUI.width, mapUI.height) /
      (MAP_DATA.bounds.south - MAP_DATA.bounds.north)) *
    state.map.view.zoom
  );
}
function mapToScreen(x, y) {
  const s = mapScale();
  return {
    x: (x - state.map.view.x) * s + mapUI.width / 2,
    y: (y - state.map.view.y) * s + mapUI.height / 2,
  };
}
function screenToMap(x, y) {
  const s = mapScale();
  return {
    x: (x - mapUI.width / 2) / s + state.map.view.x,
    y: (y - mapUI.height / 2) / s + state.map.view.y,
  };
}
function mapUsed(id) {
  return (
    state.nodes.some((n) => n.mapId === id) ||
    !!(
      state.map.baseline &&
      workshop.existing?.state.nodes.some((n) => n.mapId === id)
    )
  );
}
function filteredMapNodes() {
  const m = state.map,
    q = ($("mapSearch")?.value || "").toLowerCase().replace(/\s/g, "");
  return MAP_DATA.nodes.filter(
    (n) =>
      m.layers.includes(n.layer) &&
      (!n.purity || m.purities.includes(n.purity)) &&
      (m.kind === "all" || n.kind === m.kind) &&
      n.z >= m.minZ &&
      n.z <= m.maxZ &&
      (!m.hideUsed || !mapUsed(n.id)) &&
      (!m.hideCollected || !m.collected.includes(n.id)) &&
      (!q ||
        (I[n.item] && itemMatch(n.item, q)) ||
        [n.id, mapLabel(n), MAP_TYPES[n.kind], MAP_PURITY[n.purity]]
          .join(" ")
          .toLowerCase()
          .replace(/\s/g, "")
          .includes(q)),
  );
}
function visibleMapPins() {
  const pins = state.map.pins.map((p) => ({ ...p, baseline: false }));
  if (state.map.baseline)
    for (const p of workshop.existing?.state.map?.pins || [])
      if (!pins.some((x) => x.id === p.id)) pins.push({ ...p, baseline: true });
  return pins;
}
function requestMapDraw() {
  if (mapUI.frame) return;
  mapUI.frame = requestAnimationFrame(() => {
    mapUI.frame = 0;
    drawWorldMap();
  });
}
function clampMapView() {
  const b = MAP_DATA.bounds,
    v = state.map.view;
  v.x = Math.max(b.west, Math.min(b.east, v.x));
  v.y = Math.max(b.north, Math.min(b.south, v.y));
}
function mapZoomAt(factor, x = mapUI.width / 2, y = mapUI.height / 2) {
  const before = screenToMap(x, y);
  state.map.view.zoom = Math.max(1, Math.min(32, state.map.view.zoom * factor));
  const after = screenToMap(x, y);
  state.map.view.x += before.x - after.x;
  state.map.view.y += before.y - after.y;
  clampMapView();
  requestMapDraw();
}
function mapIcon(id) {
  if (!ICONS[id]) return null;
  if (!mapUI.images[id]) {
    const im = new Image();
    im.onload = requestMapDraw;
    im.src = ICONS[id];
    mapUI.images[id] = im;
  }
  return mapUI.images[id].complete ? mapUI.images[id] : null;
}
function drawWorldMap() {
  if (!mapUI.ready || $("worldmapTab").hidden) return;
  const canvas = $("worldCanvas"),
    rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;
  mapUI.width = rect.width;
  mapUI.height = rect.height;
  const ratio = Math.min(devicePixelRatio || 1, 2);
  if (
    canvas.width !== Math.round(rect.width * ratio) ||
    canvas.height !== Math.round(rect.height * ratio)
  ) {
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
  }
  const c = canvas.getContext("2d");
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.clearRect(0, 0, rect.width, rect.height);
  c.fillStyle = "#e9eff1";
  c.fillRect(0, 0, rect.width, rect.height);
  const b = MAP_DATA.bounds,
    top = mapToScreen(b.west, b.north),
    bottom = mapToScreen(b.east, b.south);
  if (state.map.terrain && mapUI.image?.complete)
    c.drawImage(mapUI.image, top.x, top.y, bottom.x - top.x, bottom.y - top.y);
  else {
    c.fillStyle = "#f9fbfc";
    c.fillRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
  }
  if (state.map.grid || !state.map.terrain) {
    const step =
      state.map.view.zoom < 3 ? 1000 : state.map.view.zoom < 10 ? 500 : 100;
    const a = screenToMap(0, 0),
      z = screenToMap(rect.width, rect.height);
    c.lineWidth = 1;
    c.strokeStyle = state.map.terrain ? "rgba(255,255,255,.35)" : "#cad6dc";
    c.fillStyle = state.map.terrain ? "white" : "#47606a";
    c.font = "10px sans-serif";
    for (let x = Math.ceil(a.x / step) * step; x < z.x; x += step) {
      const p = mapToScreen(x, 0);
      c.beginPath();
      c.moveTo(p.x, 0);
      c.lineTo(p.x, rect.height);
      c.stroke();
      c.fillText(fmt(x), p.x + 3, 12);
    }
    for (let y = Math.ceil(a.y / step) * step; y < z.y; y += step) {
      const p = mapToScreen(0, y);
      c.beginPath();
      c.moveTo(0, p.y);
      c.lineTo(rect.width, p.y);
      c.stroke();
      c.fillText(fmt(y), 3, p.y - 3);
    }
  }
  const selected = MAP_BY_ID[mapUI.selected];
  if (selected?.core) {
    const core = MAP_DATA.cores[selected.core],
      p = mapToScreen(core.x, core.y);
    c.strokeStyle = "#fff4a8";
    c.lineWidth = 2;
    c.setLineDash([5, 4]);
    for (const id of core.nodes) {
      const n = MAP_BY_ID[id],
        to = mapToScreen(n.x, n.y);
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(to.x, to.y);
      c.stroke();
    }
    c.setLineDash([]);
    c.fillStyle = "#ffe5a1";
    c.fillRect(p.x - 6, p.y - 6, 12, 12);
  }
  const nodes = filteredMapNodes(),
    added = new Set(state.nodes.map((n) => n.mapId));
  let shown = 0;
  for (const n of nodes) {
    const p = mapToScreen(n.x, n.y);
    if (
      p.x < -25 ||
      p.y < -25 ||
      p.x > rect.width + 25 ||
      p.y > rect.height + 25
    )
      continue;
    shown++;
    const r = state.map.view.zoom > 3 ? 12 : 7,
      curr = n.id === mapUI.selected;
    c.globalAlpha = state.map.collected.includes(n.id) ? 0.35 : 1;
    if (curr) {
      c.beginPath();
      c.arc(p.x, p.y, r + 5, 0, 2 * Math.PI);
      c.fillStyle = "#ffcc49";
      c.fill();
    }
    c.beginPath();
    c.arc(p.x, p.y, r, 0, 2 * Math.PI);
    c.fillStyle = n.color || "#fff";
    c.fill();
    c.lineWidth = curr ? 3 : 2;
    c.strokeStyle = added.has(n.id)
      ? "#111"
      : { pure: "#27853b", normal: "#e59b28", impure: "#cf4b45" }[n.purity] ||
        "#fff";
    c.stroke();
    const im = mapIcon(n.item);
    if (im && r >= 12)
      c.drawImage(im, p.x - r + 2, p.y - r + 2, 2 * r - 4, 2 * r - 4);
    if (added.has(n.id)) {
      c.fillStyle = "#111";
      c.font = "bold 11px sans-serif";
      c.fillText("✓", p.x + r - 4, p.y - r + 3);
    }
    c.globalAlpha = 1;
  }
  for (const pin of visibleMapPins()) {
    const p = mapToScreen(pin.x, pin.y);
    if (
      p.x < -80 ||
      p.x > rect.width + 80 ||
      p.y < -40 ||
      p.y > rect.height + 40
    )
      continue;
    c.fillStyle = pin.baseline
      ? "#777"
      : pin.kind === "existing"
        ? "#225982"
        : pin.kind === "planned"
          ? "#c26916"
          : "#7752a8";
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(p.x - 9, p.y - 18);
    c.lineTo(p.x + 9, p.y - 18);
    c.closePath();
    c.fill();
    c.strokeStyle = "#fff";
    c.lineWidth = 2;
    c.stroke();
    c.font = "bold 12px sans-serif";
    const text = pin.name.slice(0, 24);
    const w = c.measureText(text).width;
    c.fillStyle = "rgba(255,255,255,.92)";
    c.fillRect(p.x - w / 2 - 4, p.y - 39, w + 8, 18);
    c.fillStyle = "#111";
    c.fillText(text, p.x - w / 2, p.y - 26);
  }
  const measure = state.map.measure;
  if (measure.length) {
    c.strokeStyle = "#fff";
    c.fillStyle = "#bb2d24";
    c.lineWidth = 3;
    for (const pt of measure) {
      const p = mapToScreen(pt.x, pt.y);
      c.beginPath();
      c.arc(p.x, p.y, 5, 0, 2 * Math.PI);
      c.fill();
      c.stroke();
    }
    if (measure.length === 2) {
      const a = mapToScreen(measure[0].x, measure[0].y),
        z = mapToScreen(measure[1].x, measure[1].y);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(z.x, z.y);
      c.strokeStyle = "#bd2a21";
      c.stroke();
    }
  }
  const scale = mapScale(),
    distance = 100 / scale,
    exp = Math.pow(10, Math.floor(Math.log10(distance))),
    meters =
      [1, 2, 5, 10]
        .map((v) => v * exp)
        .filter((v) => v <= distance)
        .pop() || exp;
  c.fillStyle = "rgba(255,255,255,.92)";
  c.fillRect(12, rect.height - 43, meters * scale + 20, 32);
  c.strokeStyle = "#111";
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(22, rect.height - 22);
  c.lineTo(22 + meters * scale, rect.height - 22);
  c.stroke();
  c.fillStyle = "#111";
  c.font = "11px sans-serif";
  c.fillText(fmt(meters) + " m", 22, rect.height - 29);
  $("mapCounts").textContent =
    `筛选 ${nodes.length} 处 · 当前视野 ${shown} 处 · 已接入 ${state.nodes.filter((n) => n.mapId).length} 处`;
  $("mapZoomValue").textContent = fmt(state.map.view.zoom) + "×";
  $("mapDistance").textContent =
    measure.length === 2
      ? "水平直线距离 " +
        fmt(
          Math.hypot(measure[1].x - measure[0].x, measure[1].y - measure[0].y),
        ) +
        " m"
      : measure.length === 1
        ? "再点击终点"
        : "点击两点测距";
  renderMapList(nodes);
}
function mapHit(x, y) {
  let hit = null,
    best = 18;
  for (const pin of visibleMapPins()) {
    const p = mapToScreen(pin.x, pin.y - 0);
    const d = Math.hypot(x - p.x, y - (p.y - 9));
    if (d < best) {
      best = d;
      hit = { pin };
    }
  }
  for (const n of filteredMapNodes()) {
    const p = mapToScreen(n.x, n.y),
      d = Math.hypot(x - p.x, y - p.y);
    if (d < best) {
      best = d;
      hit = { node: n };
    }
  }
  return hit;
}
function renderMapList(nodes = filteredMapNodes()) {
  const nearby = nodes
    .filter((n) => {
      const p = mapToScreen(n.x, n.y);
      return p.x >= 0 && p.y >= 0 && p.x <= mapUI.width && p.y <= mapUI.height;
    })
    .sort(
      (a, b) =>
        Math.hypot(a.x - state.map.view.x, a.y - state.map.view.y) -
        Math.hypot(b.x - state.map.view.x, b.y - state.map.view.y),
    );
  $("mapNodeList").innerHTML =
    nearby
      .slice(0, 60)
      .map(
        (n) =>
          `<button data-map-focus="${esc(n.id)}" class="map-list-node"><span>${esc(mapLabel(n))} ${MAP_PURITY[n.purity] || ""}</span><small>${MAP_TYPES[n.kind]} · X ${fmt(n.x)} / Y ${fmt(n.y)}</small></button>`,
      )
      .join("") || '<p class="small">当前视野没有匹配点位。</p>';
}
function focusMapNode(id) {
  const n = MAP_BY_ID[id];
  if (!n) return;
  mapUI.selected = id;
  state.map.view = { x: n.x, y: n.y, zoom: Math.max(5, state.map.view.zoom) };
  if (!state.map.layers.includes(n.layer)) state.map.layers.push(n.layer);
  if (n.purity && !state.map.purities.includes(n.purity))
    state.map.purities.push(n.purity);
  state.map.kind = "all";
  state.map.hideUsed = false;
  state.map.hideCollected = false;
  state.map.minZ = Math.min(state.map.minZ, n.z);
  state.map.maxZ = Math.max(state.map.maxZ, n.z);
  $("mapSearch").value = "";
  switchTab("worldmap");
  syncMapUI();
  renderMapDetail();
  save();
}
function mapNodeOptions(n) {
  return n.kind === "well"
    ? [["well", "资源抽取器"]]
    : n.item === "Desc_LiquidOil_C"
      ? [["oil", "油井"]]
      : [
          ["mk1", "1级采矿机"],
          ["mk2", "2级采矿机"],
          ["mk3", "3级采矿机"],
        ];
}
function renderMapDetail() {
  const n = MAP_BY_ID[mapUI.selected];
  if (!n) {
    $("mapDetail").innerHTML = "<p>点击地图点位查看详情。</p>";
    return;
  }
  const existing = state.nodes.find((x) => x.mapId === n.id),
    conflict = hasProductMaterial(n.item),
    collectible = !["node", "well", "geyser"].includes(n.kind),
    core = n.core && MAP_DATA.cores[n.core];
  $("mapDetail").innerHTML =
    `<div class="itemhead">${ICONS[materialId(n.item)] ? icon(n.item) : ""}<div><h3>${esc(mapLabel(n))}</h3><small>${MAP_TYPES[n.kind]} ${MAP_PURITY[n.purity] || ""}</small></div></div><p>X ${fmt(n.x)} m<br>Y ${fmt(n.y)} m<br>高度 ${fmt(n.z)} m</p>${
      ["node", "well"].includes(n.kind)
        ? `<label>采集设备<select id="mapMiner">${mapNodeOptions(n)
            .map(
              ([k, t]) =>
                `<option value="${k}" ${k === existing?.machine ? "selected" : ""}>${t}</option>`,
            )
            .join(
              "",
            )}</select></label><label>频率 %<input id="mapClock" type="number" min="1" max="250" step="any" value="${displayNumber(existing?.clock || 100)}"></label><label>出口上限<select id="mapOutlet">${(I[n.item]?.fluid ? [300, 600] : BELTS).map((q) => `<option value="${q}" ${q === (existing ? (I[n.item].fluid ? existing.pipe : existing.belt) : I[n.item].fluid ? 600 : 1200) ? "selected" : ""}>${q} ${unit(n.item)}</option>`).join("")}</select></label><p id="mapNodeRate"></p>${core ? `<p class="small">同井 ${core.nodes.length} 个卫星点，共用一座增压站和同一频率。</p>` : ""}<button class="primary" id="mapAddSupply" ${conflict ? "disabled" : ""}>${existing ? "更新此点供给" : "加入当前供给"}</button>${core ? `<button id="mapAddWell" ${conflict ? "disabled" : ""}>加入整组资源井</button>` : ""}${conflict ? '<p class="over">该资源已选作最终产物，请先移除该最终产物。</p>' : ""}`
        : ""
    }${n.kind === "geyser" ? "<p>地热位置参考点。</p>" : ""}${collectible ? `<label><input type="checkbox" id="mapCollected" ${state.map.collected.includes(n.id) ? "checked" : ""}> 已收集</label>` : ""}${n.requirement ? `<p>硬盘解锁：${[n.requirement.itemQuantity ? esc(I[n.requirement.itemId]?.name || n.requirement.itemId) + " × " + fmt(n.requirement.itemQuantity) : "", n.requirement.powerNeeded ? fmt(n.requirement.powerNeeded) + " MW" : ""].filter(Boolean).join(" ＋ ") || "无物料或功率要求"}</p>` : ""}<button id="mapPinAtNode">在此标记工厂</button><details><summary class="small">点位编号</summary><small class="map-id">${esc(n.id)}</small></details>`;
  for (const id of ["mapMiner", "mapClock", "mapOutlet"])
    if ($(id)) $(id).onchange = updateMapNodeRate;
  if ($("mapAddSupply")) $("mapAddSupply").onclick = () => addMapSupply(false);
  if ($("mapAddWell")) $("mapAddWell").onclick = () => addMapSupply(true);
  if ($("mapCollected"))
    $("mapCollected").onchange = (e) => {
      state.map.collected = state.map.collected.filter((id) => id !== n.id);
      if (e.target.checked) state.map.collected.push(n.id);
      requestMapDraw();
      save();
    };
  $("mapPinAtNode").onclick = () => openMapPin(n.x, n.y);
  updateMapNodeRate();
}
function mapNodeDraft(n) {
  const clock = Math.max(1, Math.min(250, amount($("mapClock")?.value) || 100)),
    machine = $("mapMiner")?.value || mapNodeOptions(n)[0][0],
    out = +$("mapOutlet")?.value;
  return normalizeNode({
    id: 0,
    item: n.item,
    mapId: n.id,
    machine,
    clock,
    count: 1,
    purity: n.purity,
    belt: I[n.item]?.fluid ? 1200 : out,
    pipe: I[n.item]?.fluid ? out : 600,
    pressurizers: n.core ? 1 : 0,
  });
}
function updateMapNodeRate() {
  const n = MAP_BY_ID[mapUI.selected];
  if (!n || !$("mapNodeRate")) return;
  const d = mapNodeDraft(n),
    v = nodeOutput(d);
  $("mapNodeRate").textContent =
    `${fmt(v.output)} ${unit(n.item)}${v.limited ? " · 受出口限速" : ""}`;
}
function addMapSupply(whole) {
  const selected = MAP_BY_ID[mapUI.selected];
  if (!selected || !["node", "well"].includes(selected.kind)) return;
  const ids =
    whole && selected.core
      ? MAP_DATA.cores[selected.core].nodes
      : [selected.id];
  if (hasProductMaterial(selected.item)) {
    setStatus("该资源与最终产物冲突。", true);
    return;
  }
  const draft = mapNodeDraft(selected);
  if (selected.core)
    for (const n of state.nodes)
      if (n.mapCore === selected.core) n.clock = draft.clock;
  let added = 0;
  for (const id of ids) {
    const n = MAP_BY_ID[id],
      old = state.nodes.find((x) => x.mapId === id),
      next = normalizeNode({
        ...draft,
        mapId: id,
        item: n.item,
        id: old?.id || Math.max(0, ...state.nodes.map((x) => x.id)) + 1,
      });
    if (old) Object.assign(old, next);
    else {
      state.nodes.push(next);
      added++;
    }
  }
  normalizeMappedGroups();
  fitSupplies();
  renderAll();
  renderMapDetail();
  setStatus(
    `已${added ? "添加 " + added + " 个地图资源点" : "更新地图资源点"}，供给与采集耗电已重新计算。`,
  );
  save();
}
function openMapPin(x, y, pin = null) {
  mapUI.pendingPin = pin || {
    id:
      "pin_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 7),
    x,
    y,
  };
  $("mapPinName").value =
    pin?.name || workshop.active.name.replace("未命名方案", "工厂");
  $("mapPinKind").value = pin?.kind || "planned";
  $("mapPinX").value = +x.toFixed(3);
  $("mapPinY").value = +y.toFixed(3);
  $("mapPinNote").value = pin?.note || "";
  $("mapDeletePin").hidden = !pin;
  $("mapPinDialog").showModal();
}
function showMapPin(pin) {
  mapUI.selected = null;
  $("mapDetail").innerHTML =
    `<h3>${esc(pin.name)}</h3><p>${pin.baseline ? "已有基准 · " : ""}${{ existing: "已有工厂", planned: "规划工厂", note: "普通标记" }[pin.kind]}</p><p>X ${fmt(pin.x)} m<br>Y ${fmt(pin.y)} m</p><p>${esc(pin.note)}</p>${!pin.baseline ? '<button id="mapEditPin">编辑标记</button>' : ""}`;
  if ($("mapEditPin"))
    $("mapEditPin").onclick = () => openMapPin(pin.x, pin.y, pin);
}
function mapClick(x, y) {
  const hit = mapHit(x, y),
    point = hit?.node || hit?.pin || screenToMap(x, y);
  if (mapUI.mode === "pin") {
    openMapPin(point.x, point.y);
    return;
  }
  if (mapUI.mode === "measure") {
    if (state.map.measure.length === 2) state.map.measure = [];
    state.map.measure.push({ x: point.x, y: point.y });
    requestMapDraw();
    save();
    return;
  }
  if (hit?.node) {
    mapUI.selected = hit.node.id;
    renderMapDetail();
  } else if (hit?.pin) showMapPin(hit.pin);
  else {
    mapUI.selected = null;
    renderMapDetail();
  }
  requestMapDraw();
}
function syncMapUI() {
  if (!mapUI.ready) return;
  const m = state.map;
  for (const k of ["terrain", "grid", "baseline", "hideUsed", "hideCollected"])
    $("map-" + k).checked = m[k];
  $("mapKind").value = m.kind;
  $("mapMinZ").value = m.minZ;
  $("mapMaxZ").value = m.maxZ;
  for (const input of document.querySelectorAll("[data-map-layer]"))
    input.checked = m.layers.includes(input.dataset.mapLayer);
  for (const input of document.querySelectorAll("[data-map-purity]"))
    input.checked = m.purities.includes(input.dataset.mapPurity);
  if (!$("worldmapTab").hidden) {
    requestMapDraw();
    renderMapDetail();
  }
}
function initWorldMap() {
  mapUI.ready = true;
  mapUI.image = new Image();
  mapUI.image.onload = requestMapDraw;
  mapUI.image.src = MAP_TERRAIN;
  const count = (key) => MAP_DATA.nodes.filter((n) => n.layer === key).length,
    layerName = (key) => I[key]?.name || MAP_TYPES[key] || "间歇泉";
  $("mapResourceFilters").innerHTML = MAP_RESOURCE_LAYERS.map(
    (k) =>
      `<label><input type="checkbox" data-map-layer="${k}" checked> ${esc(layerName(k))} <small>${count(k)}</small></label>`,
  ).join("");
  $("mapPoiFilters").innerHTML = MAP_POI_LAYERS.map(
    (k) =>
      `<label><input type="checkbox" data-map-layer="${k}"> ${layerName(k)} <small>${count(k)}</small></label>`,
  ).join("");
  const c = $("worldCanvas"),
    point = (e) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
  c.onpointerdown = (e) => {
    e.preventDefault();
    c.focus();
    c.setPointerCapture(e.pointerId);
    mapUI.pointers.set(e.pointerId, point(e));
    mapUI.dragged = mapUI.pointers.size > 1;
    mapUI.down = point(e);
  };
  c.onpointermove = (e) => {
    const p = point(e),
      old = mapUI.pointers.get(e.pointerId);
    if (old) {
      const before = [...mapUI.pointers.values()];
      mapUI.pointers.set(e.pointerId, p);
      if (before.length > 1) {
        const after = [...mapUI.pointers.values()],
          midA = {
            x: (before[0].x + before[1].x) / 2,
            y: (before[0].y + before[1].y) / 2,
          },
          midB = {
            x: (after[0].x + after[1].x) / 2,
            y: (after[0].y + after[1].y) / 2,
          },
          d1 = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y),
          d2 = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
        mapZoomAt(d2 / Math.max(d1, 1), midA.x, midA.y);
        state.map.view.x -= (midB.x - midA.x) / mapScale();
        state.map.view.y -= (midB.y - midA.y) / mapScale();
        mapUI.dragged = true;
      } else {
        if (Math.hypot(p.x - mapUI.down.x, p.y - mapUI.down.y) > 4)
          mapUI.dragged = true;
        if (mapUI.dragged) {
          state.map.view.x -= (p.x - old.x) / mapScale();
          state.map.view.y -= (p.y - old.y) / mapScale();
        }
      }
      clampMapView();
      requestMapDraw();
    }
    const world = screenToMap(p.x, p.y);
    $("mapCursor").textContent = `X ${fmt(world.x)} m · Y ${fmt(world.y)} m`;
    const hit = mapHit(p.x, p.y);
    c.title = hit?.node
      ? `${mapLabel(hit.node)} ${MAP_PURITY[hit.node.purity] || ""} · 高度 ${fmt(hit.node.z)} m`
      : hit?.pin?.name || "";
  };
  const end = (e) => {
    const p = point(e);
    if (
      mapUI.pointers.has(e.pointerId) &&
      mapUI.pointers.size === 1 &&
      !mapUI.dragged
    )
      mapClick(p.x, p.y);
    mapUI.pointers.delete(e.pointerId);
    if (mapUI.pointers.size) mapUI.dragged = true;
    save();
  };
  c.onpointerup = end;
  c.onpointercancel = (e) => {
    mapUI.pointers.delete(e.pointerId);
    mapUI.dragged = true;
    save();
  };
  c.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const p = point(e);
      mapZoomAt(
        Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.004),
        p.x,
        p.y,
      );
      save();
    },
    { passive: false },
  );
  c.ondblclick = (e) => {
    const p = point(e);
    mapZoomAt(1.8, p.x, p.y);
    save();
  };
  c.onkeydown = (e) => {
    let handled = true;
    const v = state.map.view,
      step = 80 / mapScale();
    if (e.key === "ArrowLeft") v.x -= step;
    else if (e.key === "ArrowRight") v.x += step;
    else if (e.key === "ArrowUp") v.y -= step;
    else if (e.key === "ArrowDown") v.y += step;
    else if (["+", "="].includes(e.key)) mapZoomAt(1.4);
    else if (e.key === "-") mapZoomAt(1 / 1.4);
    else if (e.key === "Home") {
      v.x = 503.015;
      v.y = 0;
      v.zoom = 1;
    } else handled = false;
    if (handled) {
      e.preventDefault();
      clampMapView();
      requestMapDraw();
      save();
    }
  };
  new ResizeObserver(requestMapDraw).observe(c);
  $("mapZoomIn").onclick = () => {
    mapZoomAt(1.5);
    save();
  };
  $("mapZoomOut").onclick = () => {
    mapZoomAt(1 / 1.5);
    save();
  };
  $("mapFit").onclick = () => {
    state.map.view = { x: 503.015, y: 0, zoom: 1 };
    requestMapDraw();
    save();
  };
  $("mapMode").onchange = (e) => {
    mapUI.mode = e.target.value;
    c.style.cursor = mapUI.mode === "browse" ? "grab" : "crosshair";
  };
  $("mapClearMeasure").onclick = () => {
    state.map.measure = [];
    requestMapDraw();
    save();
  };
  $("mapGo").onclick = () => {
    const x = Number($("mapGoX").value),
      y = Number($("mapGoY").value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    state.map.view = { x, y, zoom: Math.max(4, state.map.view.zoom) };
    clampMapView();
    requestMapDraw();
    save();
  };
  $("mapSearch").oninput = requestMapDraw;
  for (const k of ["terrain", "grid", "baseline", "hideUsed", "hideCollected"])
    $("map-" + k).onchange = (e) => {
      state.map[k] = e.target.checked;
      requestMapDraw();
      save();
    };
  $("mapKind").onchange = (e) => {
    state.map.kind = e.target.value;
    requestMapDraw();
    save();
  };
  for (const [id, key] of [
    ["mapMinZ", "minZ"],
    ["mapMaxZ", "maxZ"],
  ])
    $(id).onchange = (e) => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v)) return;
      state.map[key] = v;
      if (state.map.minZ > state.map.maxZ)
        [state.map.minZ, state.map.maxZ] = [state.map.maxZ, state.map.minZ];
      syncMapUI();
      save();
    };
  $("mapAllResources").onclick = () => {
    state.map.layers = MAP_RESOURCE_LAYERS.slice();
    state.map.purities = ["impure", "normal", "pure"];
    state.map.kind = "all";
    $("mapSearch").value = "";
    syncMapUI();
    save();
  };
  $("mapNoLayers").onclick = () => {
    state.map.layers = [];
    syncMapUI();
    save();
  };
  document.addEventListener("change", (e) => {
    const d = e.target.dataset;
    if (d.mapLayer) {
      state.map.layers = state.map.layers.filter((k) => k !== d.mapLayer);
      if (e.target.checked) state.map.layers.push(d.mapLayer);
      requestMapDraw();
      save();
    }
    if (d.mapPurity) {
      state.map.purities = state.map.purities.filter((k) => k !== d.mapPurity);
      if (e.target.checked) state.map.purities.push(d.mapPurity);
      requestMapDraw();
      save();
    }
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.mapFocus) focusMapNode(b.dataset.mapFocus);
  });
  $("mapCancelPin").onclick = () => $("mapPinDialog").close();
  $("mapSavePin").onclick = () => {
    const x = Number($("mapPinX").value),
      y = Number($("mapPinY").value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const pin = {
      id: mapUI.pendingPin.id,
      name: cleanTitle($("mapPinName").value, "工厂标记"),
      kind: $("mapPinKind").value,
      x: Math.max(MAP_DATA.bounds.west, Math.min(MAP_DATA.bounds.east, x)),
      y: Math.max(MAP_DATA.bounds.north, Math.min(MAP_DATA.bounds.south, y)),
      note: $("mapPinNote").value.slice(0, 500),
    };
    state.map.pins = state.map.pins.filter((p) => p.id !== pin.id);
    state.map.pins.push(pin);
    $("mapPinDialog").close();
    showMapPin(pin);
    requestMapDraw();
    save();
  };
  $("mapDeletePin").onclick = () => {
    state.map.pins = state.map.pins.filter((p) => p.id !== mapUI.pendingPin.id);
    $("mapPinDialog").close();
    mapUI.selected = null;
    renderMapDetail();
    requestMapDraw();
    save();
  };
  syncMapUI();
}

const PROGRESSION = {
  phases: [
    {
      id: "phase1",
      name: "太空电梯 · 阶段 1",
      tier: -1,
      unlock: "层级 3–4",
      cost: { Desc_SpaceElevatorPart_1_C: 50 },
    },
    {
      id: "phase2",
      name: "太空电梯 · 阶段 2",
      tier: -1,
      unlock: "层级 5–6",
      cost: {
        Desc_SpaceElevatorPart_1_C: 1000,
        Desc_SpaceElevatorPart_2_C: 1000,
        Desc_SpaceElevatorPart_3_C: 100,
      },
    },
    {
      id: "phase3",
      name: "太空电梯 · 阶段 3",
      tier: -1,
      unlock: "层级 7–8",
      cost: {
        Desc_SpaceElevatorPart_2_C: 2500,
        Desc_SpaceElevatorPart_4_C: 500,
        Desc_SpaceElevatorPart_5_C: 100,
      },
    },
    {
      id: "phase4",
      name: "太空电梯 · 阶段 4",
      tier: -1,
      unlock: "层级 9",
      cost: {
        Desc_SpaceElevatorPart_7_C: 500,
        Desc_SpaceElevatorPart_6_C: 500,
        Desc_SpaceElevatorPart_8_C: 250,
        Desc_SpaceElevatorPart_9_C: 100,
      },
    },
    {
      id: "phase5",
      name: "太空电梯 · 阶段 5",
      tier: -1,
      unlock: "完成组装计划",
      cost: {
        Desc_SpaceElevatorPart_9_C: 1000,
        Desc_SpaceElevatorPart_10_C: 1000,
        Desc_SpaceElevatorPart_12_C: 256,
        Desc_SpaceElevatorPart_11_C: 200,
      },
    },
  ],
  milestones: [
    {
      id: "Schematic_Tutorial1_C",
      name: "枢纽升级1",
      en: "HUB Upgrade 1",
      tier: 0,
      order: 0.0,
      cost: { Desc_IronRod_C: 10.0 },
      time: 0.0,
    },
    {
      id: "Schematic_Tutorial1_5_C",
      name: "枢纽升级2",
      en: "HUB Upgrade 2",
      tier: 0,
      order: 1.0,
      cost: { Desc_IronRod_C: 20.0, Desc_IronPlate_C: 10.0 },
      time: 0.0,
    },
    {
      id: "Schematic_Tutorial2_C",
      name: "枢纽升级3",
      en: "HUB Upgrade 3",
      tier: 0,
      order: 2.0,
      cost: { Desc_IronPlate_C: 20.0, Desc_IronRod_C: 20.0, Desc_Wire_C: 20.0 },
      time: 0.0,
    },
    {
      id: "Schematic_Tutorial3_C",
      name: "枢纽升级4",
      en: "HUB Upgrade 4",
      tier: 0,
      order: 3.0,
      cost: { Desc_IronPlate_C: 75.0, Desc_Cable_C: 20.0, Desc_Cement_C: 10.0 },
      time: 0.0,
    },
    {
      id: "Schematic_Tutorial4_C",
      name: "枢纽升级5",
      en: "HUB Upgrade 5",
      tier: 0,
      order: 4.0,
      cost: { Desc_IronRod_C: 75.0, Desc_Cable_C: 50.0, Desc_Cement_C: 20.0 },
      time: 0.0,
    },
    {
      id: "Schematic_Tutorial5_C",
      name: "枢纽升级6",
      en: "HUB Upgrade 6",
      tier: 0,
      order: 5.0,
      cost: {
        Desc_IronRod_C: 100.0,
        Desc_IronPlate_C: 100.0,
        Desc_Wire_C: 100.0,
        Desc_Cement_C: 50.0,
      },
      time: 0.0,
    },
    {
      id: "Schematic_1-1_C",
      name: "基地建筑",
      en: "Base Building",
      tier: 1,
      order: 1.0,
      cost: {
        Desc_Cement_C: 200.0,
        Desc_IronPlate_C: 100.0,
        Desc_IronRod_C: 100.0,
      },
      time: 120.0,
    },
    {
      id: "Schematic_1-2_C",
      name: "物流",
      en: "Logistics",
      tier: 1,
      order: 2.0,
      cost: {
        Desc_IronPlate_C: 150.0,
        Desc_IronRod_C: 150.0,
        Desc_Wire_C: 300.0,
      },
      time: 240.0,
    },
    {
      id: "Schematic_1-3_C",
      name: "实地考察",
      en: "Field Research",
      tier: 1,
      order: 3.0,
      cost: {
        Desc_Wire_C: 300.0,
        Desc_IronScrew_C: 300.0,
        Desc_IronPlate_C: 100.0,
      },
      time: 180.0,
    },
    {
      id: "Schematic_2-1_C",
      name: "零件组装",
      en: "Part Assembly",
      tier: 2,
      order: 1.0,
      cost: {
        Desc_Cable_C: 200.0,
        Desc_IronRod_C: 200.0,
        Desc_IronScrew_C: 500.0,
        Desc_IronPlate_C: 300.0,
      },
      time: 360.0,
    },
    {
      id: "Schematic_2-2_C",
      name: "障碍清理",
      en: "Obstacle Clearing",
      tier: 2,
      order: 2.0,
      cost: {
        Desc_IronScrew_C: 500.0,
        Desc_Cable_C: 100.0,
        Desc_Cement_C: 100.0,
      },
      time: 180.0,
    },
    {
      id: "Schematic_2-3_C",
      name: "弹射板",
      en: "Jump Pads",
      tier: 2,
      order: 3.0,
      cost: {
        Desc_Rotor_C: 50.0,
        Desc_IronPlate_C: 300.0,
        Desc_Cable_C: 150.0,
      },
      time: 240.0,
    },
    {
      id: "Schematic_2-5_C",
      name: "资源回收奖励项目",
      en: "Resource Sink Bonus Program",
      tier: 2,
      order: 4.0,
      cost: {
        Desc_Cement_C: 400.0,
        Desc_Wire_C: 500.0,
        Desc_IronRod_C: 200.0,
        Desc_IronPlate_C: 200.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_3-2_C",
      name: "2级物流",
      en: "Logistics Mk.2",
      tier: 2,
      order: 5.0,
      cost: {
        Desc_IronPlateReinforced_C: 50.0,
        Desc_Cement_C: 200.0,
        Desc_IronRod_C: 300.0,
        Desc_IronPlate_C: 300.0,
      },
      time: 360.0,
    },
    {
      id: "Schematic_3-1_C",
      name: "煤炭发电",
      en: "Coal Power",
      tier: 3,
      order: 1.0,
      cost: {
        Desc_IronPlateReinforced_C: 150.0,
        Desc_Rotor_C: 50.0,
        Desc_Cable_C: 500.0,
      },
      time: 480.0,
    },
    {
      id: "Schematic_3-3_C",
      name: "载具运输",
      en: "Vehicular Transport",
      tier: 3,
      order: 2.0,
      cost: {
        Desc_ModularFrame_C: 25.0,
        Desc_Rotor_C: 100.0,
        Desc_Cable_C: 200.0,
        Desc_IronPlate_C: 400.0,
      },
      time: 240.0,
    },
    {
      id: "Schematic_3-4_C",
      name: "基础钢铁生产",
      en: "Basic Steel Production",
      tier: 3,
      order: 3.0,
      cost: {
        Desc_ModularFrame_C: 50.0,
        Desc_Rotor_C: 150.0,
        Desc_Cement_C: 500.0,
        Desc_Wire_C: 1000.0,
      },
      time: 480.0,
    },
    {
      id: "Schematic_4-2_C",
      name: "强化资产保护",
      en: "Enhanced Asset Security",
      tier: 3,
      order: 4.0,
      cost: {
        Desc_IronPlateReinforced_C: 100.0,
        Desc_IronRod_C: 600.0,
        Desc_Wire_C: 1500.0,
      },
      time: 180.0,
    },
    {
      id: "Schematic_4-5_C",
      name: "FICSIT蓝图",
      en: "FICSIT Blueprints",
      tier: 4,
      order: 1.0,
      cost: {
        Desc_ModularFrame_C: 100.0,
        Desc_SteelPlate_C: 200.0,
        Desc_Cable_C: 500.0,
        Desc_Cement_C: 1000.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_5-3_C",
      name: "3级物流",
      en: "Logistics Mk.3",
      tier: 4,
      order: 2.0,
      cost: {
        Desc_SteelPlate_C: 200.0,
        Desc_SteelPipe_C: 200.0,
        Desc_IronPlateReinforced_C: 400.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_4-1_C",
      name: "进阶钢铁生产",
      en: "Advanced Steel Production",
      tier: 4,
      order: 3.0,
      cost: {
        Desc_SteelPipe_C: 100.0,
        Desc_ModularFrame_C: 100.0,
        Desc_Rotor_C: 200.0,
        Desc_Cement_C: 500.0,
      },
      time: 600.0,
    },
    {
      id: "Schematic_4-3_C",
      name: "扩展能源基础设施",
      en: "Expanded Power Infrastructure",
      tier: 4,
      order: 4.0,
      cost: {
        Desc_SteelPlateReinforced_C: 50.0,
        Desc_SteelPlate_C: 100.0,
        Desc_ModularFrame_C: 200.0,
        Desc_Wire_C: 2000.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_4-4_C",
      name: "超级管道",
      en: "Hypertubes",
      tier: 4,
      order: 5.0,
      cost: {
        Desc_SteelPlateReinforced_C: 50.0,
        Desc_SteelPipe_C: 300.0,
        Desc_CopperSheet_C: 500.0,
      },
      time: 600.0,
    },
    {
      id: "Schematic_6-2_C",
      name: "喷射背包",
      en: "Jetpack",
      tier: 5,
      order: 1.0,
      cost: {
        Desc_Motor_C: 50.0,
        Desc_Cable_C: 1000.0,
        Desc_IronPlate_C: 1000.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_5-1_C",
      name: "石油加工",
      en: "Oil Processing",
      tier: 5,
      order: 2.0,
      cost: {
        Desc_Motor_C: 50.0,
        Desc_SteelPlateReinforced_C: 100.0,
        Desc_SteelPipe_C: 500.0,
        Desc_CopperSheet_C: 500.0,
      },
      time: 600.0,
    },
    {
      id: "Schematic_6-1_C",
      name: "4级物流",
      en: "Logistics Mk.4",
      tier: 5,
      order: 3.0,
      cost: {
        Desc_Rubber_C: 200.0,
        Desc_SteelPlateReinforced_C: 300.0,
        Desc_ModularFrame_C: 400.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_5-4_C",
      name: "液体灌装",
      en: "Fluid Packaging",
      tier: 5,
      order: 4.0,
      cost: {
        Desc_Plastic_C: 200.0,
        Desc_SteelPlate_C: 400.0,
        Desc_CopperSheet_C: 1000.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_5-5_C",
      name: "石油发电",
      en: "Petroleum Power",
      tier: 5,
      order: 5.0,
      cost: {
        Desc_Motor_C: 100.0,
        Desc_SteelPlateReinforced_C: 100.0,
        Desc_Rubber_C: 200.0,
        Desc_Plastic_C: 200.0,
      },
      time: 600.0,
    },
    {
      id: "Schematic_5-2_C",
      name: "工业制造",
      en: "Industrial Manufacturing",
      tier: 6,
      order: 1.0,
      cost: {
        Desc_Motor_C: 200.0,
        Desc_ModularFrame_C: 200.0,
        Desc_Plastic_C: 400.0,
        Desc_Cable_C: 1000.0,
      },
      time: 900.0,
    },
    {
      id: "Schematic_6-3_C",
      name: "单轨列车技术",
      en: "Monorail Train Technology",
      tier: 6,
      order: 2.0,
      cost: {
        Desc_Motor_C: 250.0,
        Desc_SteelPlateReinforced_C: 500.0,
        Desc_SteelPlate_C: 1000.0,
        Desc_SteelPipe_C: 1000.0,
      },
      time: 600.0,
    },
    {
      id: "Schematic_6-7_C",
      name: "铁轨信号灯",
      en: "Railway Signalling",
      tier: 6,
      order: 3.0,
      cost: {
        Desc_Computer_C: 50.0,
        Desc_SteelPipe_C: 400.0,
        Desc_CopperSheet_C: 1000.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_6-5_C",
      name: "2级管道工程",
      en: "Pipeline Engineering Mk.2",
      tier: 6,
      order: 4.0,
      cost: {
        Desc_ModularFrameHeavy_C: 50.0,
        Desc_Plastic_C: 1000.0,
        Desc_Rubber_C: 1000.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_6-6_C",
      name: "2级FICSIT蓝图",
      en: "FICSIT Blueprints Mk.2",
      tier: 6,
      order: 5.0,
      cost: {
        Desc_ModularFrameHeavy_C: 100.0,
        Desc_Computer_C: 100.0,
        Desc_Rubber_C: 400.0,
        Desc_Cement_C: 1500.0,
      },
      time: 600.0,
    },
    {
      id: "Schematic_7-1_C",
      name: "铝土矿精炼",
      en: "Bauxite Refinement",
      tier: 7,
      order: 1.0,
      cost: {
        Desc_Computer_C: 100.0,
        Desc_ModularFrameHeavy_C: 100.0,
        Desc_Motor_C: 250.0,
        Desc_Rubber_C: 500.0,
      },
      time: 600.0,
    },
    {
      id: "Schematic_8-3_C",
      name: "悬浮背包",
      en: "Hoverpack",
      tier: 7,
      order: 2.0,
      cost: {
        Desc_AluminumPlate_C: 100.0,
        Desc_ModularFrameHeavy_C: 100.0,
        Desc_Computer_C: 100.0,
        Desc_Motor_C: 250.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_7-2_C",
      name: "5级物流",
      en: "Logistics Mk.5",
      tier: 7,
      order: 3.0,
      cost: {
        Desc_AluminumPlate_C: 200.0,
        Desc_SteelPlateReinforced_C: 400.0,
        Desc_IronPlateReinforced_C: 600.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_7-3_C",
      name: "防护服",
      en: "Hazmat Suit",
      tier: 7,
      order: 4.0,
      cost: {
        Desc_Filter_C: 50.0,
        Desc_AluminumCasing_C: 100.0,
        Desc_HighSpeedWire_C: 500.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_7-5_C",
      name: "控制系统开发",
      en: "Control System Development",
      tier: 7,
      order: 5.0,
      cost: {
        Desc_AluminumPlate_C: 200.0,
        Desc_AluminumCasing_C: 400.0,
        Desc_Computer_C: 200.0,
        Desc_Plastic_C: 1000.0,
      },
      time: 900.0,
    },
    {
      id: "Schematic_7-4_C",
      name: "航空工程",
      en: "Aeronautical Engineering",
      tier: 8,
      order: 1.0,
      cost: {
        Desc_ModularFrameLightweight_C: 50.0,
        Desc_AluminumPlate_C: 100.0,
        Desc_AluminumCasing_C: 200.0,
        Desc_Motor_C: 300.0,
      },
      time: 600.0,
    },
    {
      id: "Schematic_8-1_C",
      name: "核能",
      en: "Nuclear Power",
      tier: 8,
      order: 2.0,
      cost: {
        Desc_ComputerSuper_C: 50.0,
        Desc_ModularFrameHeavy_C: 200.0,
        Desc_Cable_C: 1000.0,
        Desc_Cement_C: 2000.0,
      },
      time: 900.0,
    },
    {
      id: "Schematic_8-2_C",
      name: "进阶铝制品生产",
      en: "Advanced Aluminum Production",
      tier: 8,
      order: 3.0,
      cost: {
        Desc_ModularFrameLightweight_C: 50.0,
        Desc_AluminumCasing_C: 200.0,
        Desc_AluminumPlate_C: 400.0,
        Desc_Wire_C: 3000.0,
      },
      time: 900.0,
    },
    {
      id: "Schematic_8-4_C",
      name: "尖端生产",
      en: "Leading-Edge Production",
      tier: 8,
      order: 4.0,
      cost: {
        Desc_ModularFrameFused_C: 50.0,
        Desc_ComputerSuper_C: 100.0,
        Desc_SteelPipe_C: 1000.0,
      },
      time: 300.0,
    },
    {
      id: "Schematic_8-5_C",
      name: "粒子富集",
      en: "Particle Enrichment",
      tier: 8,
      order: 5.0,
      cost: {
        Desc_MotorLightweight_C: 50.0,
        Desc_ModularFrameFused_C: 100.0,
        Desc_CoolingSystem_C: 200.0,
        Desc_HighSpeedWire_C: 2500.0,
      },
      time: 1200.0,
    },
    {
      id: "Schematic_9-1_C",
      name: "物质转化",
      en: "Matter Conversion",
      tier: 9,
      order: 1.0,
      cost: {
        Desc_ModularFrameFused_C: 100.0,
        Desc_ModularFrameLightweight_C: 250.0,
        Desc_CoolingSystem_C: 500.0,
      },
      time: 900.0,
    },
    {
      id: "Schematic_9-2_C",
      name: "量子编码",
      en: "Quantum Encoding",
      tier: 9,
      order: 2.0,
      cost: {
        Desc_TimeCrystal_C: 50.0,
        Desc_FicsiteMesh_C: 100.0,
        Desc_MotorLightweight_C: 200.0,
        Desc_ComputerSuper_C: 400.0,
      },
      time: 1200.0,
    },
    {
      id: "Schematic_9-3_C",
      name: "3级FICSIT蓝图",
      en: "FICSIT Blueprints Mk.3",
      tier: 9,
      order: 3.0,
      cost: {
        Desc_TemporalProcessor_C: 100.0,
        Desc_TimeCrystal_C: 250.0,
        Desc_FicsiteMesh_C: 500.0,
        Desc_ModularFrameFused_C: 500.0,
      },
      time: 900.0,
    },
    {
      id: "Schematic_9-4_C",
      name: "空间能量管制",
      en: "Spatial Energy Regulation",
      tier: 9,
      order: 4.0,
      cost: {
        Desc_QuantumOscillator_C: 100.0,
        Desc_MotorLightweight_C: 250.0,
        Desc_ModularFrameLightweight_C: 500.0,
        Desc_SAMFluctuator_C: 1000.0,
      },
      time: 600.0,
    },
    {
      id: "Schematic_9-5_C",
      name: "极致效率",
      en: "Peak Efficiency",
      tier: 9,
      order: 5.0,
      cost: {
        Desc_TimeCrystal_C: 250.0,
        Desc_FicsiteMesh_C: 250.0,
        Desc_AluminumPlate_C: 5000.0,
        Desc_IronPlate_C: 10000.0,
      },
      time: 600.0,
    },
  ],
};
function freshProgress() {
  return {
    kind: "elevator",
    tier: 1,
    task: "phase1",
    multiplier: 1,
    hubMultiplier: 1,
    minutes: 60,
    depth: 1,
    records: {},
  };
}
function normalizeProgress(x) {
  const p = freshProgress();
  if (!x || typeof x !== "object") return p;
  p.kind = x.kind === "hub" ? "hub" : "elevator";
  p.tier = Math.max(0, Math.min(9, Math.floor(amount(x.tier))));
  p.multiplier = Math.max(0.01, Math.min(100, amount(x.multiplier) || 1));
  p.hubMultiplier = Math.max(0.01, Math.min(100, amount(x.hubMultiplier) || 1));
  p.minutes = Math.max(1, Math.min(1e6, amount(x.minutes) || 60));
  p.depth = Math.max(0, Math.min(3, Math.floor(amount(x.depth ?? 1))));
  const tasks = [...PROGRESSION.phases, ...PROGRESSION.milestones];
  p.task = tasks.some((t) => t.id === x.task) ? x.task : "phase1";
  for (const t of tasks) {
    const record = x.records?.[t.id];
    if (!record) continue;
    p.records[t.id] = {};
    for (const id of Object.keys(t.cost))
      p.records[t.id][id] = {
        delivered: Math.floor(amount(record[id]?.delivered)),
        stock: Math.floor(amount(record[id]?.stock)),
      };
  }
  return p;
}
let progressCollapsed = new Set(),
  progressNodes = [],
  progressDetail = null;
function progressTasks() {
  return state.progress.kind === "hub"
    ? PROGRESSION.milestones.filter((t) => t.tier === state.progress.tier)
    : PROGRESSION.phases;
}
function progressTask() {
  const tasks = progressTasks();
  return tasks.find((t) => t.id === state.progress.task) || tasks[0];
}
function progressRows(task = progressTask()) {
  if (!task) return [];
  const p = state.progress,
    mult = task.tier < 0 ? p.multiplier : p.hubMultiplier;
  return Object.entries(task.cost).map(([id, cost]) => {
    const rec = p.records[task.id]?.[id] || {},
      need = Math.ceil(cost * mult),
      delivered = Math.min(need, Math.floor(amount(rec.delivered))),
      stock = Math.floor(amount(rec.stock)),
      left = Math.max(0, need - delivered - stock),
      q = state.products
        .filter((x) => materialId(x.id) === id)
        .reduce((sum, x) => sum + x.q, 0);
    return {
      id,
      need,
      delivered,
      stock,
      left,
      q,
      eta: left === 0 ? 0 : q > EPS ? left / q : null,
      rate: left / p.minutes,
    };
  });
}
function progressETA(n) {
  return n === null ? "尚未规划" : n === 0 ? "已备齐" : fmt(n) + " 分钟";
}
function renderProgress() {
  state.progress = normalizeProgress(state.progress);
  const p = state.progress,
    t = progressTask();
  if (!t) return;
  p.task = t.id;
  $("progressKind").value = p.kind;
  $("progressTier").value = p.tier;
  $("progressTierWrap").hidden = p.kind !== "hub";
  $("progressTask").innerHTML = progressTasks()
    .map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`)
    .join("");
  $("progressTask").value = p.task;
  $("progressMultiplier").value =
    p.kind === "hub" ? p.hubMultiplier : p.multiplier;
  $("progressMinutes").value = p.minutes;
  $("progressDepth").value = p.depth;
  $("progressTitle").textContent = t.name;
  $("phaseCards").innerHTML = (p.kind === "elevator" ? PROGRESSION.phases : [])
    .map((x) => {
      const rs = progressRows(x),
        complete = rs.every((r) => r.delivered >= r.need),
        ready = rs.every((r) => r.left === 0);
      return `<button data-progress-task="${x.id}" class="${x.id === p.task ? "selected" : ""}">${esc(x.name)} · ${complete ? "已提交" : ready ? "物资已备齐" : "待准备"}</button>`;
    })
    .join("");
  const rows = progressRows(t),
    prior =
      t.tier < 0
        ? PROGRESSION.phases
            .slice(0, PROGRESSION.phases.indexOf(t))
            .filter((x) => progressRows(x).some((r) => r.delivered < r.need))
        : [],
    gate = t.tier >= 3 ? Math.min(4, Math.floor((t.tier - 1) / 2)) : 0;
  $("progressNotice").textContent =
    (t.unlock
      ? "完成后：" + t.unlock + "。 "
      : gate
        ? "需要先完成太空电梯阶段 " + gate + "。 "
        : "") +
    (prior.length ? "前序阶段尚有未提交记录；可提前规划当前阶段。 " : "") +
    (rows.every((r) => r.delivered === r.need)
      ? "本任务物资已全部提交。"
      : rows.every((r) => r.left === 0)
        ? "物资已备齐，请在游戏中提交；太空电梯仍需手动确认发射。"
        : "剩余数量已扣除已提交量和未提交库存。");
  $("progressTable").innerHTML =
    `<table><thead><tr><th>物品</th><th>总需求</th><th>已提交</th><th>未提交库存</th><th>还需生产</th><th>规划产量 / 分</th><th>预计备齐</th><th>操作</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${icon(r.id)} ${esc(I[r.id].name)}</td><td>${fmt(r.need)}</td><td><input style="width:100px" aria-label="${esc(I[r.id].name)}已提交" data-progress-item="${r.id}" data-progress-field="delivered" type="number" min="0" max="${r.need}" step="1" value="${displayNumber(r.delivered)}"></td><td><input style="width:100px" aria-label="${esc(I[r.id].name)}库存" data-progress-item="${r.id}" data-progress-field="stock" type="number" min="0" step="1" value="${displayNumber(r.stock)}"></td><td>${fmt(r.left)}</td><td>${fmt(r.q)}</td><td>${progressETA(r.eta)}</td><td><button data-progress-add="${r.id}" ${!r.left ? "disabled" : ""}>规划 ${fmt(r.rate)}/分</button></td></tr>`).join("")}</tbody></table>`;
  drawProgressMap();
}
function addProgressTargets(entries) {
  const notices = [];
  let added = 0;
  for (const { id, rate } of entries) {
    if (!(rate > EPS)) continue;
    const item = I[id];
    if (!item?.selectable || item.handOnly) {
      notices.push((item?.name || id) + "不能自动生产");
      continue;
    }
    if (
      state.supplies.some((x) => x.id === id) ||
      state.nodes.some((x) => x.item === id)
    ) {
      notices.push(item.name + "已在供给中，请先调整供给");
      continue;
    }
    const related = state.products.filter((x) => materialId(x.id) === id);
    const total = related.reduce((sum, x) => sum + x.q, 0);
    if (total + EPS >= rate) continue;
    const old = related.find((x) => !x.lock);
    if (related.length && !old) {
      notices.push(item.name + "已锁定，未修改");
      continue;
    }
    if (old) old.q = cleanComputedQuantity(old.q + rate - total);
    else state.products.push({ id, q: rate, lock: false, pin: false });
    added++;
  }
  if (added) state.mode = "reverse";
  renderAll();
  $("progressMessage").textContent =
    (added
      ? "已将 " + added + " 项加入反推规划，原有更高产量和锁定值保留。 "
      : "没有新增规划。 ") + notices.join("；");
  if (added)
    setStatus("阶段物资已加入反推规划，可在“资源与产物”查看机器和原料需求。");
  save();
}
function progressTree() {
  const t = progressTask(),
    p = state.progress;
  let budget = 400;
  function itemNode(id, q, key, depth, path) {
    const k = recipeFor(id),
      recipe = R[k],
      cycle = path.has(id),
      external =
        state.supplies.some((x) => x.id === id && x.stop) || I[id]?.raw;
    const label = I[id]?.name || id,
      n = {
        key,
        id,
        q,
        label,
        subtitle:
          fmt(q) +
          " 件" +
          (cycle ? " · 循环回流" : external ? " · 外部供给" : ""),
        children: [],
      };
    if (
      !cycle &&
      !external &&
      recipe?.kind === "machine" &&
      depth > 0 &&
      budget-- > 0
    ) {
      const inputs = Object.entries(rates(k).ins).map(([a, b]) => [
        a,
        (b * q) / rates(k).outs[id],
      ]);
      n.children = [
        {
          key: key + "/recipe",
          label: recipe.name,
          subtitle: B[recipe.b]?.name || "生产配方",
          children: inputs.map(([a, b], i) =>
            itemNode(a, b, key + "/" + i, depth - 1, new Set([...path, id])),
          ),
        },
      ];
    }
    if (I[id]?.fluid) n.subtitle = n.subtitle.replace(" 件", " m³");
    return n;
  }
  return {
    key: "root",
    label: t.name,
    subtitle: "剩余生产量 · " + p.minutes + " 分钟目标",
    children: progressRows().map((r, i) =>
      itemNode(r.id, r.left, "item/" + i, p.depth, new Set()),
    ),
  };
}
function drawProgressMap() {
  const root = progressTree(),
    nodes = [],
    edges = [];
  let y = 35;
  function walk(n, depth) {
    n.depth = depth;
    nodes.push(n);
    const cs = progressCollapsed.has(n.key) ? [] : n.children;
    if (cs.length) {
      for (const c of cs) {
        walk(c, depth + 1);
        edges.push([n, c]);
      }
      n.y = (cs[0].y + cs.at(-1).y) / 2;
    } else {
      n.y = y;
      y += 76;
    }
    n.x = 20 + depth * 240;
  }
  walk(root, 0);
  progressNodes = nodes;
  const width = Math.max(750, ...nodes.map((n) => n.x + 235)),
    height = Math.max(180, y + 5),
    zoom = +$("progressZoom").value / 100;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="阶段物资思维导图" width="${width * zoom}" height="${height * zoom}" viewBox="0 0 ${width} ${height}" style="background:white;font-family:Arial,sans-serif"><g fill="none" stroke="#a7b4bd" stroke-width="1.5">${edges.map(([a, b]) => `<path d="M${a.x + 212},${a.y} C${a.x + 228},${a.y} ${b.x - 16},${b.y} ${b.x},${b.y}"/>`).join("")}</g>${nodes.map((n, i) => `<g transform="translate(${n.x},${n.y - 28})"><rect width="212" height="56" rx="8" fill="${n.id ? "#fff" : "#edf2f5"}" stroke="#899ba6"/><g ${n.id ? `data-progress-detail="${i}" role="button" tabindex="0" style="cursor:pointer"` : ""}><title>${esc(n.label + " · " + n.subtitle)}</title><text x="10" y="22" font-size="12" fill="#111">${esc(n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label)}</text><text x="10" y="42" font-size="11" fill="#47565e">${esc(n.subtitle)}</text></g>${n.children.length ? `<g data-progress-toggle="${esc(n.key)}" role="button" tabindex="0" style="cursor:pointer" aria-label="展开或收起 ${esc(n.label)}"><circle cx="212" cy="28" r="10" fill="white" stroke="#899ba6"/><text x="212" y="32" text-anchor="middle" font-size="14">${progressCollapsed.has(n.key) ? "+" : "−"}</text></g>` : ""}</g>`).join("")}</svg>`;
  $("progressMap").innerHTML = svg;
}
function openProgressDetail(i) {
  const n = progressNodes[i];
  if (!n?.id) return;
  progressDetail = { id: n.id, rate: n.q / state.progress.minutes };
  $("progressDialogTitle").textContent = I[n.id].name;
  $("progressDialogBody").innerHTML =
    `<p>${icon(n.id)} 此分支需要 ${fmt(n.q)} ${I[n.id].fluid ? "m³" : "件"}，按 ${fmt(state.progress.minutes)} 分钟折算为 ${fmt(progressDetail.rate)} ${unit(n.id)}。</p><p>添加后作为独立最终产物；已有主产物的上游用量仍单独计入。</p>`;
  $("progressDialogAdd").disabled = !n.q || I[n.id].raw || I[n.id].handOnly;
  $("progressDialog").showModal();
}
function initProgress() {
  for (const id of [
    "progressKind",
    "progressTier",
    "progressTask",
    "progressMultiplier",
    "progressMinutes",
    "progressDepth",
  ])
    $(id).onchange = () => {
      const p = state.progress;
      if (id === "progressKind") p.kind = $(id).value;
      if (id === "progressTier") p.tier = +$(id).value;
      if (id === "progressTask") p.task = $(id).value;
      if (id === "progressMultiplier")
        p[p.kind === "hub" ? "hubMultiplier" : "multiplier"] = Math.max(
          0.01,
          Math.min(100, +$(id).value || 1),
        );
      if (id === "progressMinutes")
        p.minutes = Math.max(1, Math.min(1e6, +$(id).value || 60));
      if (id === "progressDepth") p.depth = +$(id).value;
      progressCollapsed.clear();
      renderProgress();
      save();
    };
  $("progressPlan").onclick = () =>
    addProgressTargets(progressRows().map((r) => ({ id: r.id, rate: r.rate })));
  $("progressZoom").oninput = drawProgressMap;
  $("progressExpand").onclick = () => {
    progressCollapsed.clear();
    drawProgressMap();
  };
  $("progressSvg").onclick = () => {
    const svg = $("progressMap").querySelector("svg");
    if (svg)
      download(
        "satisfactory-stage-mindmap.svg",
        svg.outerHTML,
        "image/svg+xml",
      );
  };
  $("progressDialogClose").onclick = () => $("progressDialog").close();
  $("progressDialogAdd").onclick = () => {
    if (progressDetail) addProgressTargets([progressDetail]);
    $("progressDialog").close();
  };
  document.addEventListener("change", (e) => {
    const d = e.target.dataset;
    if (!d.progressItem) return;
    const p = state.progress,
      t = progressTask(),
      r = progressRows().find((x) => x.id === d.progressItem);
    p.records[t.id] ??= {};
    p.records[t.id][r.id] ??= {};
    p.records[t.id][r.id][d.progressField] = Math.min(
      d.progressField === "delivered" ? r.need : 1e8,
      Math.floor(amount(e.target.value)),
    );
    renderProgress();
    save();
  });
  document.addEventListener("click", (e) => {
    const el = e.target.closest(
      "[data-progress-task],[data-progress-add],[data-progress-toggle],[data-progress-detail]",
    );
    if (!el) return;
    const d = el.dataset;
    if (d.progressTask) {
      state.progress.task = d.progressTask;
      progressCollapsed.clear();
      renderProgress();
      save();
    }
    if (d.progressAdd) {
      const r = progressRows().find((x) => x.id === d.progressAdd);
      if (r) addProgressTargets([{ id: r.id, rate: r.rate }]);
    }
    if (d.progressToggle) {
      progressCollapsed.has(d.progressToggle)
        ? progressCollapsed.delete(d.progressToggle)
        : progressCollapsed.add(d.progressToggle);
      drawProgressMap();
    }
    if (d.progressDetail !== undefined) openProgressDetail(+d.progressDetail);
  });
  $("progressMap").addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });
}

const UI_PAGES = {
  settings: ["设置", "build"],
  rail: ["火车运力", "network"],
  home: ["首页", "home"],
  planner: ["产线规划", "factory"],
  graph: ["产线图与思维导图", "network"],
  construction: ["物流与施工", "build"],
  workspace: ["方案与改装", "folder"],
  worldmap: ["交互式地图", "map"],
  catalog: ["物品与配方", "box"],
  progress: ["里程碑与太空电梯", "flag"],
  journal: ["更新记录", "document"],
};
const UI_KEY = "factory-workbench-ui-13";
let interfaceReady = false,
  interfaceState = {
    tabs: ["planner"],
    active: "planner",
    folded: false,
    compact: false,
  },
  milestonePage = 1;
function uiIcon(name) {
  const paths = {
    home: "M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9",
    factory: "M3 21V8h5v5l6-4v4l7-4v12ZM7 17h1m4 0h1m4 0h1M5 8V3h3v5",
    layers: "m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5",
    network:
      "M5 6h5m4 0h5M5 18h5m4 0h5M5 8v8m14-8v8M10 4h4v4h-4ZM3 16h4v4H3Zm14 0h4v4h-4Z",
    bolt: "m13 2-9 12h7l-1 8 10-13h-8Z",
    build: "m14 7 3-4 4 4-4 3M15 9 4 20l-2-2L13 7M4 3l17 17",
    folder: "M3 6h7l2 3h9v12H3ZM3 6V3h6l3 3",
    map: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2ZM9 3v16m6-14v16",
    box: "m12 3 9 5v10l-9 4-9-4V8Zm-9 5 9 5 9-5M12 13v9",
    flag: "M4 22V3m0 1c6-5 10 5 16 0v10c-6 5-10-5-16 0",
    document: "M5 2h10l4 4v16H5ZM15 2v5h4M8 11h8m-8 4h8m-8 4h5",
  };
  return `<span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"><path d="${paths[name] || paths.box}"/></svg></span>`;
}
function storeInterface() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(interfaceState));
  } catch {}
}
function interfaceNavigate(tab) {
  if (!interfaceReady || !UI_PAGES[tab]) return;
  const changed = interfaceState.active !== tab;
  interfaceState.active = tab;
  if (changed) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  if (!interfaceState.tabs.includes(tab)) interfaceState.tabs.push(tab);
  $("pageCaption").textContent = UI_PAGES[tab][0];
  document.querySelectorAll("#appSidebar [data-tab]").forEach((el) => {
    const active = el.dataset.tab === tab;
    el.classList.toggle("selected", active);
    el.setAttribute("aria-current", active ? "page" : "false");
  });
  $("workspaceTabs").innerHTML = interfaceState.tabs
    .map(
      (k) =>
        `<div class="workspace-tab${k === tab ? " active" : ""}"><button data-tab="${k}">${esc(UI_PAGES[k][0])}</button>${k !== "planner" ? `<button class="tab-close" data-close-tab="${k}" aria-label="关闭${esc(UI_PAGES[k][0])}页签">×</button>` : ""}</div>`,
    )
    .join("");
  document.body.classList.remove("sidebar-mobile-open");
  if (tab === "home") renderHome();
  if (tab === "progress") renderMilestoneGallery();
  if (tab === "worldmap") requestMapDraw();
  storeInterface();
}
function renderHome() {
  const data = [
    ["最终产物", state.products.length + " 项"],
    ["当前机器", fmt(current?.machines || 0) + " 台"],
    ["生产平均耗电", fmt(current?.power || 0) + " MW"],
    ["已保存方案", workshop.plans.length + " 个"],
  ];
  $("homeStats").innerHTML = data
    .map(
      ([label, n]) =>
        `<div class="stat"><span>${label}</span><strong>${n}</strong></div>`,
    )
    .join("");
  const desc = {
    planner: "添加供给和目标产物，切换配方与逐台频率。",
    worldmap: "搜索资源点、选择矿机，直接加入供给。",
    progress: "查找阶段物资，记录库存与提交进度。",
    catalog: "按中英文和拼音搜索，查看图片与配方。",
    workspace: "保存方案，对比已有产线与改装清单。",
  };
  $("homeLinks").innerHTML = Object.entries(desc)
    .map(
      ([k, t]) =>
        `<button class="home-card" data-tab="${k}">${uiIcon(UI_PAGES[k][1])}<strong>${UI_PAGES[k][0]}</strong><p>${t}</p></button>`,
    )
    .join("");
  $("homePlan").innerHTML =
    `<h3>${esc(workshop.active.name || "未命名方案")}</h3><p>${state.mode === "reverse" ? "目标产量反推" : "按供给分配产物"} · ${state.supplies.length} 项外部供给 · ${state.nodes.length} 项采集设备</p><div class="chipline" style="margin:14px 0">${
      state.products
        .slice(0, 12)
        .map(
          (p) =>
            `<span class="chip">${icon(p.id)} ${esc(I[p.id].name)} <b>${fmt(p.q)} /分</b></span>`,
        )
        .join("") || "<p>当前方案尚未添加产物。点击“开始产线规划”添加。</p>"
    }</div>`;
}
function milestoneMatches() {
  const q = $("milestoneSearch").value.trim().toLowerCase(),
    tier = $("milestoneTier").value;
  return PROGRESSION.milestones.filter(
    (t) =>
      (tier === "all" || t.tier === +tier) &&
      (!q ||
        [
          t.name,
          t.en,
          ...Object.keys(t.cost).flatMap((id) => [
            I[id].name,
            I[id].en,
            I[id].py,
            I[id].initials,
          ]),
        ].some((v) => String(v).toLowerCase().includes(q))),
  );
}
function renderMilestoneGallery() {
  if (!$("milestoneGallery")) return;
  const list = milestoneMatches(),
    pages = Math.max(1, Math.ceil(list.length / 12));
  milestonePage = Math.min(pages, Math.max(1, milestonePage));
  $("milestoneGallery").innerHTML =
    list
      .slice((milestonePage - 1) * 12, milestonePage * 12)
      .map(
        (t) =>
          `<button class="milestone-tile" data-milestone-detail="${esc(t.id)}"><b>${esc(t.name)}</b><div>${Object.keys(
            t.cost,
          )
            .slice(0, 4)
            .map((id) => icon(id))
            .join(
              "",
            )}</div><small>Tier ${t.tier} · ${Object.keys(t.cost).length} 种物资</small></button>`,
      )
      .join("") || "<p>没有匹配的里程碑。</p>";
  $("milestonePage").textContent =
    `共 ${list.length} 项 · ${milestonePage} / ${pages}`;
  $("milestonePrev").disabled = milestonePage <= 1;
  $("milestoneNext").disabled = milestonePage >= pages;
}
function costTable(cost) {
  return `<div class="tablewrap"><table><thead><tr><th>物品</th><th>数量</th></tr></thead><tbody>${Object.entries(
    cost,
  )
    .map(
      ([id, q]) =>
        `<tr><td><button class="mini-link" data-encyclopedia="${esc(id)}">${icon(id)} ${esc(I[id]?.name || id)}</button></td><td><span class="cost-quantity">${fmt(q)}</span></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}
function openMilestone(id) {
  const t = PROGRESSION.milestones.find((x) => x.id === id);
  if (!t) return;
  $("referenceDetail").innerHTML =
    `<div class="detail-hero"><h2>${esc(t.name)}</h2><p>${esc(t.en)}</p><div style="margin:16px">${Object.keys(
      t.cost,
    )
      .slice(0, 3)
      .map((x) => icon(x, true))
      .join(
        "",
      )}</div><span class="badge">Tier ${t.tier}</span> <span class="badge">${fmt(t.time || 0)} 秒</span></div><h3>解锁所需物资 · 标准数量</h3>${costTable(t.cost)}<div class="buttons"><button class="primary" data-track-milestone="${t.id}">跟踪物资与反推产线</button></div>`;
  $("referenceDialog").showModal();
}
function openEncyclopedia(id) {
  const item = I[id];
  if (!item) return;
  const recipes = Object.keys(R).filter((k) => R[k].outs[id] > 0),
    building = BUILD_RECIPES[id],
    r = R[building];
  $("referenceDetail").innerHTML =
    `<div class="detail-hero"><h2>${esc(item.name)}</h2>${icon(id, true)}<p>${esc(item.en)}</p><span class="badge">${item.build ? "建筑 / 设备" : item.raw ? "原始资源" : item.fluid ? "流体" : "物品"}</span></div>${r ? "<h3>单台建造材料</h3>" + costTable(Object.fromEntries(Object.entries(r.ins).map(([k, q]) => [k, q / r.outs[id]]))) : ""}<h3 style="margin:20px 0 12px">${item.build ? "相关建造配方" : "生产配方"}</h3><div class="detail-recipes">${
      recipes
        .slice(0, 30)
        .map((k) => {
          const rr = R[k];
          return `<div class="detail-recipe"><b>${esc(rr.name)}</b> ${rr.alt ? '<span class="badge">替代</span>' : ""}<p class="small">每批 ${fmt(rr.time)} 秒 ${rr.b ? " · " + esc(B[rr.b]?.name || rr.b) : ""}</p><div class="recipeDetail">${Object.entries(
            rr.ins,
          )
            .map(([a, q]) => material(a, q))
            .join(" + ")} → ${Object.entries(rr.outs)
            .map(([a, q]) => material(a, q))
            .join(
              " + ",
            )}</div>${rr.kind === "machine" ? `<button data-detail-recipe="${k}">在配方库使用此配方</button>` : ""}</div>`;
        })
        .join("") || "<p>通过采集或外部供给获得。</p>"
    }</div>${!item.build && item.selectable && !item.handOnly ? `<div class="buttons"><button data-detail-add="${id}">添加为最终产物</button></div>` : ""}`;
  $("referenceDialog").showModal();
}
function renderReferenceCatalog(original) {
  const type = $("catalogDisplay").value;
  if (type === "recipes") {
    original();
    return;
  }
  const q = $("catalogSearch").value;
  const list = Object.keys(I)
    .filter((id) =>
      type === "buildings"
        ? I[id].build && BUILD_RECIPES[id]
        : I[id].selectable && !I[id].build && !I[id].powerSlot,
    )
    .filter((id) => itemMatch(id, q))
    .sort((a, b) => I[a].name.localeCompare(I[b].name, "zh-CN"));
  $("catalogCount").textContent =
    `匹配 ${list.length} 项 · 显示前 ${Math.min(catalogLimit, list.length)} 项`;
  $("catalogMore").hidden = catalogLimit >= list.length;
  $("catalog").innerHTML =
    list
      .slice(0, catalogLimit)
      .map(
        (id) =>
          `<article class="card reference-item-card"><div class="itemhead">${icon(id, true)}<div><h3>${esc(I[id].name)}</h3><p>${esc(I[id].en)}</p></div></div><small>${type === "buildings" ? "查看建造材料" : (OPTIONS[id]?.length || 0) + " 个机器配方"}</small><button data-encyclopedia="${id}">查看详情</button></article>`,
      )
      .join("") || '<div class="empty">没有匹配结果。</div>';
}
function quickMap(mode) {
  if (mode === "default") {
    const defaults = freshMap();
    for (const k of [
      "layers",
      "purities",
      "kind",
      "minZ",
      "maxZ",
      "hideUsed",
      "hideCollected",
    ])
      state.map[k] = defaults[k];
  }
  if (mode === "all") {
    state.map.layers = [...MAP_RESOURCE_LAYERS, ...MAP_POI_LAYERS];
    state.map.kind = "all";
  }
  if (mode === "pure") {
    state.map.layers = MAP_RESOURCE_LAYERS.slice();
    state.map.purities = ["pure"];
    state.map.kind = "all";
  }
  if (mode === "hard-drive") {
    state.map.layers = ["hard-drive"];
    state.map.kind = "all";
  }
  if (mode === "none") state.map.layers = [];
  $("mapSearch").value = "";
  syncMapUI();
  requestMapDraw();
  save();
}
function initInterface() {
  try {
    const x = JSON.parse(localStorage.getItem(UI_KEY));
    if (x && typeof x === "object") {
      if (x.active === "process") x.active = "planner";
      if (Array.isArray(x.tabs))
        x.tabs = x.tabs.map((k) => (k === "process" ? "planner" : k));
    }
    if (x && typeof x === "object")
      interfaceState = {
        tabs: [
          ...new Set([
            "planner",
            ...(Array.isArray(x.tabs) ? x.tabs.filter((k) => UI_PAGES[k]) : []),
          ]),
        ],
        active: "planner",
        folded: !!x.folded,
        compact: !!x.compact,
      };
  } catch {}
  const navButton = (k, label) =>
    `<button data-tab="${k}">${uiIcon(UI_PAGES[k][1])}<span>${label || UI_PAGES[k][0]}</span></button>`;
  const group = (name, content) =>
    `<details open><summary>${name}</summary><div>${content}</div></details>`;
  $("appSidebar").innerHTML =
    navButton("planner") +
    group(
      "产线工具",
      ["graph", "rail", "construction", "workspace"]
        .map((k) => navButton(k))
        .join(""),
    ) +
    group("探索世界", navButton("worldmap")) +
    group(
      "游戏资料",
      navButton("catalog") +
        `<button data-catalog-view="items">${uiIcon("box")}<span>物品图鉴</span></button><button data-catalog-view="buildings">${uiIcon("build")}<span>建筑图鉴</span></button>`,
    ) +
    group("游戏进程", navButton("progress")) +
    group(
      "工作台",
      [navButton("settings"), navButton("home"), navButton("journal")].join(""),
    ) +
    '<div class="sidebar-foot">离线产线工作台<br>配置保存在当前浏览器<br>每个方案单独导出 JSON</div>';
  for (const el of document.querySelectorAll("main > .source, main > footer"))
    document.querySelector("main").append(el);
  const planner = $("plannerTab"),
    configuration = planner.querySelector(":scope > .panel"),
    productionLayout = planner.querySelector(".layout"),
    supplyRow = productionLayout.querySelector(":scope > aside");
  supplyRow.classList.add("planner-inputs");
  planner.insertBefore(supplyRow, configuration);
  configuration.classList.add("planner-settings");
  const heading = document.createElement("div");
  heading.className = "planner-heading";
  heading.innerHTML =
    '<div><h1>产线规划</h1><p>供给 → 产物 → 机器与建设 · 核燃料、发电与废料统一配平</p></div><div class="buttons"><button data-open="supply">＋ 添加供给</button><button class="primary" data-open="product">＋ 添加产物</button><button data-planner-mind>思维导图 ↗</button></div>';
  planner.prepend(heading);
  const settings = document.createElement("details");
  settings.className = "panel planner-settings-fold";
  settings.innerHTML =
    "<summary>计算设置 <span>方向 · 频率 · 副产物</span></summary>";
  configuration.before(settings);
  settings.append(configuration);
  const baseCatalog = renderCatalog;
  renderCatalog = () => renderReferenceCatalog(baseCatalog);
  const baseProgress = renderProgress;
  renderProgress = () => {
    baseProgress();
    renderMilestoneGallery();
  };
  const mapTab = $("worldmapTab"),
    filter = mapTab.querySelector(":scope > .panel"),
    layout = mapTab.querySelector(".map-layout"),
    wrap = document.createElement("div");
  wrap.className = "map-workspace";
  mapTab.insertBefore(wrap, filter);
  filter.classList.add("map-filter-panel");
  wrap.append(filter, layout);
  const quick = document.createElement("div");
  quick.className = "map-quick";
  quick.innerHTML = [
    ["default", "默认筛选"],
    ["all", "全部开启"],
    ["none", "全部关闭"],
    ["pure", "只看纯净"],
    ["hard-drive", "只看硬盘"],
  ]
    .map(([k, t]) => `<button data-map-quick="${k}">${t}</button>`)
    .join("");
  filter.querySelector(".toolbar").after(quick);
  document.body.classList.toggle("sidebar-folded", interfaceState.folded);
  document.body.classList.toggle("compact", interfaceState.compact);
  $("densityToggle").textContent = interfaceState.compact ? "宽松" : "紧凑";
  $("sidebarToggle").setAttribute(
    "aria-expanded",
    String(!interfaceState.folded),
  );
  $("sidebarToggle").onclick = () => {
    if (innerWidth <= 900) {
      const show = document.body.classList.toggle("sidebar-mobile-open");
      $("sidebarToggle").setAttribute("aria-expanded", String(show));
    } else {
      interfaceState.folded = !interfaceState.folded;
      document.body.classList.toggle("sidebar-folded", interfaceState.folded);
      $("sidebarToggle").setAttribute(
        "aria-expanded",
        String(!interfaceState.folded),
      );
      storeInterface();
    }
    requestMapDraw();
  };
  $("navShade").onclick = () => {
    document.body.classList.remove("sidebar-mobile-open");
    $("sidebarToggle").setAttribute("aria-expanded", "false");
  };
  $("densityToggle").onclick = () => {
    interfaceState.compact = !interfaceState.compact;
    document.body.classList.toggle("compact", interfaceState.compact);
    $("densityToggle").textContent = interfaceState.compact ? "宽松" : "紧凑";
    storeInterface();
  };
  $("fullscreenToggle").onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setStatus("当前浏览器不支持页面全屏，请使用浏览器全屏功能。");
    }
  };
  $("referenceClose").onclick = () => $("referenceDialog").close();
  $("milestoneSearch").oninput = $("milestoneTier").onchange = () => {
    milestonePage = 1;
    renderMilestoneGallery();
  };
  $("milestonePrev").onclick = () => {
    milestonePage--;
    renderMilestoneGallery();
  };
  $("milestoneNext").onclick = () => {
    milestonePage++;
    renderMilestoneGallery();
  };
  document.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el) return;
    const d = el.dataset;
    if (d.plannerMind !== undefined) {
      selectProductionGraph("mind");
      switchTab("graph");
    }
    if (d.closeTab) {
      interfaceState.tabs = interfaceState.tabs.filter((k) => k !== d.closeTab);
      switchTab(
        interfaceState.active === d.closeTab
          ? interfaceState.tabs.at(-1) || "home"
          : interfaceState.active,
      );
    }
    if (d.catalogView) {
      $("catalogDisplay").value = d.catalogView;
      $("catalogSearch").value = "";
      catalogLimit = 40;
      switchTab("catalog");
    }
    if (d.encyclopedia) openEncyclopedia(d.encyclopedia);
    if (d.milestoneDetail) openMilestone(d.milestoneDetail);
    if (d.trackMilestone) {
      const t = PROGRESSION.milestones.find((x) => x.id === d.trackMilestone);
      state.progress.kind = "hub";
      state.progress.tier = t.tier;
      state.progress.task = t.id;
      $("referenceDialog").close();
      switchTab("progress");
      $("milestoneGalleryPanel").open = false;
      $("progressTitle").scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
      save();
    }
    if (d.mapQuick) quickMap(d.mapQuick);
    if (d.detailRecipe) {
      $("referenceDialog").close();
      $("catalogDisplay").value = "recipes";
      $("catalogSearch").value = d.detailRecipe;
      $("catalogKind").value = "all";
      switchTab("catalog");
    }
    if (d.detailAdd) {
      const id = d.detailAdd;
      if (
        state.supplies.some((p) => p.id === id) ||
        state.nodes.some((p) => p.item === id)
      ) {
        setStatus("该物品已经在供给中，请先移除供给再添加为最终产物。", true);
        $("referenceDialog").close();
        return;
      }
      if (!state.products.some((p) => p.id === id))
        state.products.push({ id, q: 0, lock: false, pin: false });
      $("referenceDialog").close();
      renderAll();
      switchTab("planner");
      setStatus("已添加 " + I[id].name + "，请输入目标产量。");
    }
  });
  interfaceReady = true;
  switchTab(interfaceState.active);
}

// Recipe-card canvas, using the same solved material flow as the main production plan.
let boardFlow = null,
  boardSelected = "",
  boardFocus = "",
  boardDrag = null,
  boardSuppressClick = false;
function normalizeBoard(x) {
  const out = { positions: {}, collapsed: [], notes: {} };
  if (!x || typeof x !== "object") return out;
  for (const [id, v] of Object.entries(x.positions || {}).slice(0, 3000))
    if (Array.isArray(v) && v.length === 2 && v.every(Number.isFinite))
      out.positions[id] = v.map((n) => Math.max(20, Math.min(100000, n)));
  out.collapsed = Array.isArray(x.collapsed)
    ? x.collapsed.filter((v) => typeof v === "string").slice(0, 3000)
    : [];
  for (const [id, n] of Object.entries(x.notes || {}).slice(0, 3000))
    if (typeof n === "string") out.notes[id] = n.slice(0, 500);
  return out;
}
function boardState() {
  const s = graphPreview?.s || state;
  return (s.board ??= normalizeBoard());
}
function boardReach(flow, start, direction = "both") {
  const found = new Set([start]),
    todo = [start];
  while (todo.length) {
    const id = todo.pop();
    for (const e of flow.edges) {
      const next =
        direction === "up"
          ? e.to === id
            ? e.from
            : null
          : direction === "down"
            ? e.from === id
              ? e.to
              : null
            : e.from === id
              ? e.to
              : e.to === id
                ? e.from
                : null;
      if (next && !found.has(next)) {
        found.add(next);
        todo.push(next);
      }
    }
  }
  return found;
}
function boardLayout(flow) {
  const by = new Map(flow.nodes.map((n) => [n.id, n])),
    adj = new Map(flow.nodes.map((n) => [n.id, []]));
  flow.edges.forEach((e) => adj.get(e.from)?.push(e.to));
  let time = 0;
  const index = new Map(),
    low = new Map(),
    stack = [],
    on = new Set(),
    groups = [];
  function visit(id) {
    index.set(id, time);
    low.set(id, time++);
    stack.push(id);
    on.add(id);
    for (const next of adj.get(id)) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id), low.get(next)));
      } else if (on.has(next))
        low.set(id, Math.min(low.get(id), index.get(next)));
    }
    if (low.get(id) === index.get(id)) {
      const g = [];
      let v;
      do {
        v = stack.pop();
        on.delete(v);
        g.push(v);
      } while (v !== id);
      groups.push(g);
    }
  }
  flow.nodes.forEach((n) => {
    if (!index.has(n.id)) visit(n.id);
  });
  const membership = new Map();
  groups.forEach((g, i) => g.forEach((id) => membership.set(id, i)));
  const rank = groups.map(() => 0),
    indeg = groups.map(() => 0),
    links = groups.map(() => new Set());
  for (const e of flow.edges) {
    const a = membership.get(e.from),
      b = membership.get(e.to);
    if (a !== b && !links[a].has(b)) {
      links[a].add(b);
      indeg[b]++;
    }
  }
  const q = indeg.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  while (q.length) {
    const a = q.shift();
    for (const b of links[a]) {
      rank[b] = Math.max(rank[b], rank[a] + 1);
      if (--indeg[b] === 0) q.push(b);
    }
  }
  const columns = new Map();
  for (const n of flow.nodes) {
    n.level = rank[membership.get(n.id)];
    n.cycle =
      groups[membership.get(n.id)].length > 1 || adj.get(n.id).includes(n.id);
    (columns.get(n.level) || columns.set(n.level, []).get(n.level)).push(n);
  }
  const levels = [...columns.keys()].sort((a, b) => a - b),
    incoming = new Map(flow.nodes.map((n) => [n.id, []])),
    outgoing = new Map(flow.nodes.map((n) => [n.id, []]));
  for (const e of flow.edges) {
    incoming.get(e.to).push(by.get(e.from));
    outgoing.get(e.from).push(by.get(e.to));
  }
  const indexOf = new Map();
  const update = () => {
    for (const list of columns.values())
      list.forEach((n, i) => indexOf.set(n.id, i));
  };
  update();
  // Barycentre sweeps align connected branches and reduce crossings without changing material flow.
  for (let pass = 0; pass < 6; pass++) {
    for (const [order, neighbors] of [
      [levels, incoming],
      [levels.slice().reverse(), outgoing],
    ])
      for (const level of order) {
        const list = columns.get(level),
          old = new Map(list.map((n, i) => [n.id, i])),
          score = (n) => {
            const peers = neighbors.get(n.id).filter((p) => p.level !== level);
            return peers.length
              ? peers.reduce((a, p) => a + indexOf.get(p.id), 0) / peers.length
              : old.get(n.id);
          };
        list.sort(
          (a, b) => score(a) - score(b) || old.get(a.id) - old.get(b.id),
        );
        update();
      }
  }
  const routed = flow.edges.filter(
      (e) => by.get(e.to).level !== by.get(e.from).level + 1,
    ),
    topSpace = 48 + Math.min(30, routed.length) * 16;
  for (const [level, list] of columns) {
    let y = topSpace;
    for (const n of list) {
      n.x = 36 + level * 520;
      n.y = y;
      y += n.h + 36;
    }
  }
  const columnHeight = (list) => list.reduce((h, n) => h + n.h + 36, 0) - 36,
    maxHeight = Math.max(...[...columns.values()].map(columnHeight), 0);
  for (const list of columns.values()) {
    let y = topSpace + (maxHeight - columnHeight(list)) / 2;
    for (const n of list) {
      n.y = y;
      y += n.h + 36;
    }
  }
  // Shift compact columns towards their neighbours within a fixed bounding height.
  for (let pass = 0; pass < 3; pass++)
    for (const [order, neighbors] of [
      [levels, incoming],
      [levels.slice().reverse(), outgoing],
    ])
      for (const level of order) {
        const list = columns.get(level),
          shifts = [];
        for (const n of list)
          for (const peer of neighbors.get(n.id))
            if (peer.level !== level)
              shifts.push(peer.y + peer.h / 2 - n.y - n.h / 2);
        if (!shifts.length) continue;
        shifts.sort((a, b) => a - b);
        const start = list[0].y,
          target = Math.max(
            topSpace,
            Math.min(
              topSpace + maxHeight - columnHeight(list),
              start + shifts[Math.floor(shifts.length / 2)],
            ),
          );
        for (const n of list) n.y += target - start;
      }
  return by;
}
function prepareBoardLayout(flow, s = state) {
  for (const n of flow.nodes) {
    n.ports = boardPorts(n);
    n.fold = !!s.board?.collapsed?.includes(n.id);
    n.h = n.fold
      ? 102
      : 160 +
        Math.max(n.ports.ins.length, n.ports.outs.length) * 42 +
        (n.row ? 40 : 0);
  }
  return boardLayout(flow);
}
function boardPorts(n) {
  return {
    ins: n.row
      ? Object.entries(n.row.ins)
      : n.type === "product" || n.type === "surplus"
        ? [[materialId(n.item), n.q]]
        : [],
    outs: n.row
      ? Object.entries(n.row.outs)
      : n.type === "external"
        ? [[materialId(n.item), n.q]]
        : [],
  };
}
function boardPort(n, item, output) {
  const ports = output ? n.ports.outs : n.ports.ins;
  const i = Math.max(
    0,
    ports.findIndex(([id]) => id === item),
  );
  return { x: n.x + (output ? 380 : 0), y: n.y + (n.fold ? 76 : 148 + i * 42) };
}
function renderProductionMind() {
  const plan = graphPreview?.plan || current,
    s = graphPreview?.s || state,
    chosen = $("mindProduct").value;
  $("mindProduct").innerHTML =
    '<option value="">全部最终产物</option>' +
    s.products
      .filter((p) => p.q > EPS)
      .map(
        (p) => `<option value="${p.id}">${esc(productTitle(p.id, s))}</option>`,
      )
      .join("");
  if (s.products.some((p) => p.id === chosen && p.q > EPS))
    $("mindProduct").value = chosen;
  if (!plan) {
    boardFlow = null;
    $("productionMind").innerHTML =
      '<div class="empty">当前产线不可行，请补充供给或切换反推模式。</div>';
    $("boardDetail").innerHTML = "";
    return;
  }
  const raw = flowGraph(plan, s);
  let allowed = new Set(raw.nodes.map((n) => n.id));
  if ($("mindProduct").value)
    allowed = boardReach(raw, "p:" + $("mindProduct").value, "up");
  if (boardFocus && raw.nodes.some((n) => n.id === boardSelected)) {
    const focused = boardReach(raw, boardSelected, boardFocus);
    allowed = new Set([...allowed].filter((id) => focused.has(id)));
  }
  const flow = {
    nodes: raw.nodes.filter(
      (n) =>
        allowed.has(n.id) && ($("mindSurplus").checked || n.type !== "surplus"),
    ),
    edges: [],
  };
  const ids = new Set(flow.nodes.map((n) => n.id));
  flow.edges = raw.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const b = boardState();
  prepareBoardLayout(flow, s);
  for (const n of flow.nodes)
    if (b.positions[n.id]) {
      n.x = b.positions[n.id][0];
      n.y = b.positions[n.id][1];
    }
  boardFlow = flow;
  if (!ids.has(boardSelected)) boardSelected = "";
  paintBoard();
  renderBoardDetail();
  $("boardCount").textContent =
    `${flow.nodes.length} 张卡片 · ${flow.edges.length} 条连接 · ${fmt(plan.power)} MW 耗电 · ${fmt(plan.generation || 0)} MW 发电`;
}
function boardColor(n) {
  return (
    {
      external: "#3187b3",
      recipe: "#50865e",
      product: "#c98322",
      surplus: "#bb5960",
    }[n.type] || "#50865e"
  );
}
function boardText(text, x, y, size = 12, color = "#334155", max = 26) {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"><title>${esc(text)}</title>${esc(text.length > max ? text.slice(0, max - 1) + "…" : text)}</text>`;
}
function paintBoard() {
  const flow = boardFlow,
    host = $("productionMind");
  if (!flow?.nodes.length) {
    host.innerHTML =
      '<div class="empty">暂无可显示的产线。添加目标产物后，卡片与连线会自动生成。</div>';
    return;
  }
  const by = new Map(flow.nodes.map((n) => [n.id, n])),
    highlight = new Set([boardSelected]);
  for (const e of flow.edges)
    if (e.from === boardSelected || e.to === boardSelected) {
      highlight.add(e.from);
      highlight.add(e.to);
    }
  const width = Math.max(1000, ...flow.nodes.map((n) => n.x + 440)),
    height = Math.max(650, ...flow.nodes.map((n) => n.y + n.h + 60));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="机器卡片产线规划画布" style="font-family:system-ui,Microsoft YaHei,sans-serif"><defs><pattern id="boardDots" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#cbd5e1"/></pattern><marker id="boardArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="#7792a3"/></marker></defs><rect width="100%" height="100%" fill="#f4f7fa"/><rect width="100%" height="100%" fill="url(#boardDots)"/>`;
  const routed = flow.edges.filter(
      (e) => by.get(e.to).level !== by.get(e.from).level + 1,
    ),
    routedIndex = new Map(routed.map((e, i) => [e, i]));
  for (const e of flow.edges) {
    const a = by.get(e.from),
      b = by.get(e.to),
      p = boardPort(a, e.item, true),
      q = boardPort(b, e.item, false),
      outside = q.x <= p.x || b.level !== a.level + 1,
      back = q.x <= p.x,
      offset = Math.max(40, Math.abs(q.x - p.x) * 0.45),
      lane = 20 + ((routedIndex.get(e) || 0) % 30) * 16;
    const path = outside
      ? `M${p.x} ${p.y}L${p.x + 28} ${p.y}Q${p.x + 40} ${p.y} ${p.x + 40} ${p.y - 12}L${p.x + 40} ${lane + 12}Q${p.x + 40} ${lane} ${p.x + 28} ${lane}L${q.x - 28} ${lane}Q${q.x - 40} ${lane} ${q.x - 40} ${lane + 12}L${q.x - 40} ${q.y - 12}Q${q.x - 40} ${q.y} ${q.x - 28} ${q.y}L${q.x} ${q.y}`
      : `M${p.x} ${p.y}C${p.x + offset} ${p.y} ${q.x - offset} ${q.y} ${q.x} ${q.y}`;
    const strong = e.from === boardSelected || e.to === boardSelected,
      opacity = boardSelected && !strong ? 0.25 : 1,
      labelX = (p.x + q.x) / 2,
      labelY = outside ? lane : (p.y + q.y) / 2;
    svg += `<g opacity="${opacity}"><path d="${path}" fill="none" stroke="${strong ? "#dd8c26" : I[e.item]?.fluid ? "#52a9c0" : "#7792a3"}" stroke-width="${strong ? 3 : 1.6}" ${back ? 'stroke-dasharray="7 4"' : ""} marker-end="url(#boardArrow)"><title>${esc(I[e.item].name + " " + fmt(e.q) + " " + unit(e.item))}</title></path>${$("boardLabels").checked ? `<rect x="${labelX - 58}" y="${labelY - 10}" width="116" height="18" rx="5" fill="white"/>${boardText(fmt(e.q) + " " + unit(e.item), labelX - 52, labelY + 2, 10, "#546779", 20)}` : ""}</g>`;
  }
  for (const n of flow.nodes) {
    const color = boardColor(n),
      row = n.row,
      sub = row
        ? B[R[n.id].b]?.name
        : {
            external: "外部供给",
            product: "目标产物",
            surplus: "副产物 / 待处理",
          }[n.type],
      isBuilt = row && machineIsBuilt(row, graphPreview?.s || state);
    svg += `<g data-board-node="${esc(n.id)}" transform="translate(${n.x},${n.y})" opacity="${boardSelected && !highlight.has(n.id) ? 0.55 : 1}" role="button" tabindex="0" aria-label="${esc(n.label)}：查看产线明细" style="cursor:grab"><title>${esc(n.label)}</title><rect width="380" height="${n.h}" rx="12" fill="white" stroke="${boardSelected === n.id ? "#e5a23f" : color}" stroke-width="${boardSelected === n.id ? 3 : 1.4}"/><path d="M12 1H368" stroke="${color}" stroke-width="4"/>${ICONS[materialId(n.item)] ? `<image href="${ICONS[materialId(n.item)]}" x="14" y="16" width="32" height="32"/>` : ""}${boardText(n.label, 54, 31, 14, "#172534", 21)}${boardText(sub + (n.cycle ? " · 循环工序" : "") + (isBuilt ? " · ✓已建" : ""), 54, 50, 11, color, 31)}${boardText(row ? machineLabel(row) : fmt(n.q) + " " + unit(n.item), 14, 77, 12, "#334155", 43)}<g data-board-fold="${esc(n.id)}" role="button" tabindex="0" aria-label="${n.fold ? "展开" : "收起"}卡片" style="cursor:pointer"><rect x="344" y="12" width="24" height="24" rx="5" fill="#edf2f7"/>${boardText(n.fold ? "+" : "−", 351, 29, 16)}</g>`;
    if (!n.fold) {
      svg += boardText(
        row
          ? R[n.id].generation
            ? "发电 " + fmt(row.outs.Workbench_Electricity || 0) + " MW"
            : "耗电 " + fmt(row.power) + " MW · 峰值 " + fmt(row.peak) + " MW"
          : "物料流量 · 每分钟",
        14,
        100,
        11,
        "#637388",
        45,
      );
      svg += `<path d="M0 111H380" stroke="#e4eaf0"/>${boardText("输入", 14, 130, 10, "#8491a0")}${boardText("输出", 207, 130, 10, "#8491a0")}`;
      for (const [side, ports] of [
        [0, n.ports.ins],
        [1, n.ports.outs],
      ])
        for (const [[id, q], i] of ports.map((p, i) => [p, i])) {
          const x = side ? 207 : 14,
            y = 148 + i * 42;
          svg += `<circle cx="${side ? 380 : 0}" cy="${y}" r="4.5" fill="${I[id]?.fluid ? "#52a9c0" : color}"/>${ICONS[id] ? `<image href="${ICONS[id]}" x="${x}" y="${y - 10}" width="22" height="22"/>` : ""}${boardText(I[id].name, x + 27, y, 11, "#334155", 12)}${boardText(fmt(q) + " " + unit(id), x + 27, y + 16, 11, "#172534", 23)}`;
        }
      if (row)
        svg += `<path d="M14 ${n.h - 40}H366" stroke="#edf1f5"/>${boardText("末台" + (row.duty < 0.999999 ? "平均" : "") + "产出：" + lastMachineOutputText(row), 14, n.h - 18, 10, "#64748b", 48)}`;
    }
    svg += "</g>";
  }
  host.innerHTML = svg + "</svg>";
  zoomProductionMind();
}
function renderBoardDetail() {
  const n = boardFlow?.nodes.find((n) => n.id === boardSelected),
    el = $("boardDetail");
  if (!n) {
    el.innerHTML =
      '<h3>选择一张卡片</h3><p>左侧输入，右侧输出。点击卡片高亮直接连接，拖动卡片调整布局。</p>';
    return;
  }
  const row = n.row,
    preview = !!graphPreview;
  el.innerHTML = `<span class="eyebrow">${n.type === "recipe" ? "RECIPE / 配方" : "MATERIAL / 物料"}</span><h3>${esc(n.label)}</h3><div class="buttons"><button data-board-focus="up">只看上游</button><button data-board-focus="down">只看下游</button><button data-board-clear>取消聚焦</button></div>${
    row
      ? `<p><b>${esc(B[R[n.id].b]?.name)}</b></p><p>${esc(machineLabel(row))}</p><p>末台${row.duty < 0.999999 ? "平均" : ""}产出：${esc(lastMachineOutputText(row))}</p>${preview ? "" : machineClockControl(row) + sloopControl(row)}${
          !preview
            ? `<label>切换配方<select id="boardRecipe">${recipeOptions(
                state.products.find(
                  (p) =>
                    recipeFor(p.id) === recipeBase(n.id) &&
                    R[n.id].outs[materialId(p.id)] > 0,
                )?.id || Object.keys(row.outs)[0],
              )
                .map(
                  (k) =>
                    `<option value="${k}"${k === recipeBase(n.id) ? " selected" : ""}>${esc(R[k].name)}</option>`,
                )
                .join(
                  "",
                )}</select></label><div class="buttons" style="margin:12px 0"><button id="boardLocate">机器配置 ↗</button><button id="boardBuilt">${machineIsBuilt(row) ? "取消已建成" : "标记已建成"}</button></div>`
            : ""
        }`
      : ""
  }${["ins", "outs"].map((side) => `<h4>${side === "ins" ? "输入" : "输出"}</h4>${n.ports[side].map(([id, q]) => `<div class="board-material">${icon(id)}<span>${esc(I[id].name)}</span><b>${fmt(q)} ${unit(id)}</b>${side === "outs" && row && !preview ? machineSupplyButton(id, n.id) : ""}</div>`).join("") || '<p class="small">无</p>'}`).join("")}${!preview && n.type === "product" ? `<label>目标 / ${unit(n.item)}<input id="boardTarget" type="number" min="0" step="any" value="${displayNumber(cleanComputedQuantity(n.q))}" ${state.products.find((p) => p.id === n.item)?.lock ? "disabled" : ""}></label><button id="boardApplyTarget" ${state.products.find((p) => p.id === n.item)?.lock ? "disabled" : ""}>更新产线</button>` : ""}<label style="display:block;margin-top:18px">节点备注<textarea id="boardNote" rows="3" maxlength="500" ${preview ? "disabled" : ""}>${esc(boardState().notes[n.id] || "")}</textarea></label>${preview ? '<p class="small">当前为缺料预览，编辑请返回主产线。</p>' : ""}`;
}
function zoomProductionMind() {
  const svg = $("productionMind").querySelector("svg");
  if (!svg) return;
  const box = svg.viewBox.baseVal,
    scale = Number($("mindZoom").value) / 100;
  svg.style.width = box.width * scale + "px";
  svg.style.height = box.height * scale + "px";
  $("mindZoomLabel").textContent = fmt(scale * 100) + "%";
}
function fitProductionBoard() {
  const svg = $("productionMind").querySelector("svg"),
    host = $("productionMind");
  if (!svg) return;
  $("mindZoom").value = Math.max(
    10,
    Math.min(
      100,
      Math.floor(
        Math.min(
          host.clientWidth / svg.viewBox.baseVal.width,
          host.clientHeight / svg.viewBox.baseVal.height,
        ) * 95,
      ),
    ),
  );
  zoomProductionMind();
  host.scrollTo(0, 0);
}
function selectProductionGraph(mode) {
  graphMode = mode;
  for (const [m, button, container] of [
    ["network", "viewNetwork", "network"],
    ["tree", "viewTree", "tree"],
    ["mind", "viewMind", "boardWorkspace"],
  ]) {
    $(button).classList.toggle("selected", mode === m);
    $(container).hidden = mode !== m;
  }
  $("productionMind").hidden = mode !== "mind";
  $("graphControls").hidden = mode !== "network";
  $("mindControls").hidden = mode !== "mind";
  renderGraph();
}
function initProductionMind() {
  const host = $("productionMind"),
    wrap = document.createElement("div");
  wrap.id = "boardWorkspace";
  wrap.className = "board-workspace";
  wrap.hidden = true;
  host.before(wrap);
  wrap.append(host);
  const detail = document.createElement("aside");
  detail.id = "boardDetail";
  wrap.append(detail);
  const base = renderGraph;
  renderGraph = () => {
    if (graphMode === "mind") {
      renderGraphPreviewLabel();
      renderProductionMind();
    } else base();
  };
  $("viewMind").onclick = () => selectProductionGraph("mind");
  $("viewNetwork").onclick = () => selectProductionGraph("network");
  $("viewTree").onclick = () => selectProductionGraph("tree");
  $("openProductionMind").onclick = () => {
    selectProductionGraph("mind");
    switchTab("graph");
  };
  $("mindZoom").oninput = zoomProductionMind;
  for (const id of ["mindProduct", "mindSurplus", "boardLabels"])
    $(id).onchange = () => {
      boardFocus = "";
      renderProductionMind();
    };
  $("mindExpand").onclick = () => {
    boardState().collapsed = [];
    renderProductionMind();
    save();
  };
  $("mindCollapse").onclick = () => {
    boardState().collapsed = boardFlow?.nodes.map((n) => n.id) || [];
    renderProductionMind();
    save();
  };
  $("boardAuto").onclick = () => {
    boardState().positions = {};
    renderProductionMind();
    fitProductionBoard();
    save();
  };
  $("boardFit").onclick = fitProductionBoard;
  $("boardResetFocus").onclick = () => {
    boardFocus = "";
    boardSelected = "";
    renderProductionMind();
  };
  $("downloadGraph").onclick = () => {
    renderGraph();
    if (graphMode === "tree") {
      setStatus("请切换到卡片画布或网络图后导出 SVG。");
      return;
    }
    const svg = $(
      graphMode === "mind" ? "productionMind" : "network",
    ).querySelector("svg");
    if (svg) {
      const copy = svg.cloneNode(true);
      copy.style.width = "";
      copy.style.height = "";
      download(
        graphMode === "mind"
          ? "satisfactory-production-planner.svg"
          : "satisfactory-production-network.svg",
        copy.outerHTML,
        "image/svg+xml",
      );
    }
  };
  host.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("[data-board-fold]")) return;
    const node = e.target.closest("[data-board-node]"),
      n = node && boardFlow?.nodes.find((n) => n.id === node.dataset.boardNode);
    boardDrag = {
      id: n?.id,
      x: e.clientX,
      y: e.clientY,
      nx: n?.x,
      ny: n?.y,
      sx: host.scrollLeft,
      sy: host.scrollTop,
      moved: false,
    };
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener("pointermove", (e) => {
    if (!boardDrag) return;
    const d = boardDrag,
      dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    if (d.id) {
      const n = boardFlow.nodes.find((n) => n.id === d.id),
        scale = +$("mindZoom").value / 100;
      n.x = Math.max(20, d.nx + dx / scale);
      n.y = Math.max(20, d.ny + dy / scale);
      boardState().positions[n.id] = [n.x, n.y];
      paintBoard();
    } else {
      host.scrollLeft = d.sx - dx;
      host.scrollTop = d.sy - dy;
    }
  });
  const finish = (e) => {
    if (!boardDrag) return;
    const d = boardDrag;
    boardDrag = null;
    boardSuppressClick = d.moved;
    if (d.id && !d.moved) {
      boardSelected = d.id;
      paintBoard();
      renderBoardDetail();
    }
    if (d.moved) save();
    if (host.hasPointerCapture(e.pointerId))
      host.releasePointerCapture(e.pointerId);
  };
  host.addEventListener("pointerup", finish);
  host.addEventListener("pointercancel", finish);
  host.addEventListener("click", (e) => {
    if (boardSuppressClick) {
      boardSuppressClick = false;
      return;
    }
    const fold = e.target.closest("[data-board-fold]");
    if (fold) {
      const id = fold.dataset.boardFold,
        b = boardState();
      b.collapsed = b.collapsed.includes(id)
        ? b.collapsed.filter((k) => k !== id)
        : [...b.collapsed, id];
      renderProductionMind();
      save();
    }
  });
  host.addEventListener("keydown", (e) => {
    const fold = e.target.closest("[data-board-fold]"),
      node = e.target.closest("[data-board-node]");
    if ((e.key === "Enter" || e.key === " ") && node) {
      e.preventDefault();
      if (fold) fold.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      else {
        boardSelected = node.dataset.boardNode;
        paintBoard();
        renderBoardDetail();
      }
    }
    if (e.key === "Escape") {
      boardSelected = "";
      boardFocus = "";
      renderProductionMind();
    }
  });
  host.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const old = +$("mindZoom").value / 100,
        rect = host.getBoundingClientRect(),
        x = e.clientX - rect.left,
        y = e.clientY - rect.top;
      $("mindZoom").value = Math.max(
        10,
        Math.min(150, +$("mindZoom").value + (e.deltaY < 0 ? 5 : -5)),
      );
      const scale = +$("mindZoom").value / 100,
        left = ((host.scrollLeft + x) * scale) / old - x,
        top = ((host.scrollTop + y) * scale) / old - y;
      zoomProductionMind();
      host.scrollTo(left, top);
    },
    { passive: false },
  );
  detail.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const n = boardFlow?.nodes.find((n) => n.id === boardSelected);
    if (b.dataset.boardFocus) {
      boardFocus = b.dataset.boardFocus;
      renderProductionMind();
      fitProductionBoard();
    }
    if (b.hasAttribute("data-board-clear")) {
      boardFocus = "";
      renderProductionMind();
    }
    if (!n || graphPreview) return;
    if (b.id === "boardLocate") {
      switchTab("planner");
      revealPlannerTarget("machine-" + n.id);
    }
    if (b.id === "boardBuilt") {
      state.built["recipe:" + n.id] = machineIsBuilt(n.row) ? 0 : n.row.n;
      renderAll();
    }
    if (b.id === "boardApplyTarget") {
      const report = changeQuantity(n.item, $("boardTarget").value);
      renderAll();
      if (report) showDiagnostic(report);
    }
  });
  detail.addEventListener("change", (e) => {
    const n = boardFlow?.nodes.find((n) => n.id === boardSelected);
    if (!n || graphPreview) return;
    if (e.target.id === "boardRecipe")
      applyRecipe(
        state.products.find(
          (p) => recipeFor(p.id) === recipeBase(n.id) && R[n.id].outs[materialId(p.id)] > 0,
        )?.id || Object.keys(n.row.outs)[0],
        e.target.value,
      );
    if (e.target.id === "boardNote") {
      boardState().notes[n.id] = e.target.value.slice(0, 500);
      save();
    }
  });
}

const PLANNER_FOLDS_KEY = "factory-planner-folds-1";
function revealPlannerTarget(id) {
  const el = $(id);
  if (!el) return;
  for (let p = el.parentElement; p; p = p.parentElement)
    if (p.tagName === "DETAILS") p.open = true;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
}
function initPlannerFolds() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(PLANNER_FOLDS_KEY)) || {};
  } catch {}
  const folds = [];
  for (const h of [...document.querySelectorAll("#plannerTab h2")]) {
    const match = h.textContent.match(/^0([1-7])\s*\//);
    if (!match) continue;
    const number = match[1],
      panel = h.closest(".panel"),
      fold = document.createElement("details"),
      summary = document.createElement("summary"),
      body = document.createElement("div");
    fold.className = panel.className + " planner-fold";
    fold.id = "plannerFold" + number;
    fold.style.cssText = panel.style.cssText;
    fold.open = saved[number] !== false;
    summary.className = "planner-fold-title";
    summary.innerHTML =
      "<span>" +
      esc(h.textContent) +
      '</span><span class="fold-symbol" aria-hidden="true"></span>';
    body.className = "planner-fold-body";
    h.remove();
    while (panel.firstChild) body.append(panel.firstChild);
    for (const bar of body.querySelectorAll(".toolbar"))
      if (!bar.textContent.trim() && !bar.children.length) bar.remove();
    fold.append(summary, body);
    panel.replaceWith(fold);
    if (number === "3") body.append($("products"));
    if (number === "6") {
      body.append($("buildStats"), $("bill"));
    }
    folds.push(fold);
    fold.addEventListener("toggle", () => {
      try {
        const values = Object.fromEntries(
          folds.map((x) => [x.id.replace("plannerFold", ""), x.open]),
        );
        localStorage.setItem(PLANNER_FOLDS_KEY, JSON.stringify(values));
      } catch {}
    });
  }
  const tools = document.createElement("div");
  tools.className = "planner-fold-actions";
  tools.innerHTML =
    '<button id="plannerExpandAll">全部展开</button><button id="plannerCollapseAll">全部折叠</button>';
  document.querySelector(".planner-heading").after(tools);
  $("plannerExpandAll").onclick = () => folds.forEach((x) => (x.open = true));
  $("plannerCollapseAll").onclick = () =>
    folds.forEach((x) => (x.open = false));
}

function freshRail() {
  return {
    item: "Desc_OreIron_C",
    minutes: 10,
    wagons: 4,
    trains: 1,
    demand: 1200,
    stack: 100,
    fluidCapacity: 2400,
    loadRate: 2400,
    unloadRate: 2400,
    pause: 27.08,
    margin: 10,
  };
}
function normalizeRail(x) {
  const r = freshRail();
  if (!x || typeof x !== "object") return r;
  if (I[x.item]?.selectable) r.item = x.item;
  const bounds = {
    minutes: [0.01, 10000],
    wagons: [1, 1000],
    trains: [1, 1000],
    demand: [0, 1e8],
    stack: [1, 10000],
    fluidCapacity: [1, 1e6],
    loadRate: [0, 1e8],
    unloadRate: [0, 1e8],
    pause: [0, 600],
    margin: [0, 100],
  };
  for (const [k, [lo, hi]] of Object.entries(bounds))
    if (Number.isFinite(+x[k]) && x[k] !== null)
      r[k] = Math.max(lo, Math.min(hi, +x[k]));
  for (const k of ["wagons", "trains", "stack"]) r[k] = Math.floor(r[k]);
  return r;
}
function railMath(r, fluid = false) {
  const interval = (r.minutes * 60) / r.trains,
    valid = interval > r.pause && r.minutes * 60 >= 2 * r.pause,
    available = Math.max(0, 1 - r.pause / interval),
    capacity = fluid ? r.fluidCapacity : 32 * r.stack,
    car = (capacity * 60) / interval,
    loading = r.loadRate * available,
    unloading = r.unloadRate * available,
    perWagon = valid ? Math.min(car, loading, unloading) : 0,
    total = perWagon * r.wagons,
    target = r.demand * (1 + r.margin / 100);
  return {
    interval,
    valid,
    available,
    capacity,
    car,
    loading,
    unloading,
    perWagon,
    total,
    target,
    needed:
      target === 0
        ? 0
        : perWagon > 0
          ? Math.ceil(target / perWagon - 1e-10)
          : null,
  };
}
function railNumber(key, label, min = 0, step = "any") {
  return `<label>${label}<input data-rail="${key}" type="number" min="${min}" step="${step}" value="${displayNumber(state.rail[key])}"></label>`;
}
function railItemOptions(query = "") {
  const ids = ITEM_IDS.filter(
    (id) => id !== "Workbench_Electricity" && itemMatch(id, query),
  );
  $("railItem").innerHTML = [...new Set([state.rail.item, ...ids])]
    .map(
      (id) =>
        `<option value="${id}">${esc(I[id].name)} · ${esc(I[id].en)}</option>`,
    )
    .join("");
  $("railItem").value = state.rail.item;
}
function renderRail() {
  state.rail = normalizeRail(state.rail);
  const r = state.rail,
    fluid = I[r.item].fluid;
  $("railTab").innerHTML =
    `<div class="panel rail-heading"><div class="eyebrow">RAIL LOGISTICS / 铁路物流</div><h2>火车运力计算</h2><p>从产线需求出发，检查车厢、班次和站台是否够用。</p><div class="rail-route"><span>装货站</span><span>→ 满载运输 →</span><span>卸货站</span><span>→ 返回装货站</span></div></div>
 <div class="panel"><h3>01 / 运输物资</h3><div class="formgrid"><label>搜索物品<input id="railSearch" type="search" placeholder="中文 / 英文 / 拼音"></label><label>货物<select id="railItem"></select></label>${railNumber("demand", "需求 / " + unit(r.item))}${railNumber("margin", "预留运力 / %")}</div><div class="buttons" style="margin-top:14px"><button id="railImportSupply">带入当前物品的主产线外供需求</button><button id="railImportProduct">带入当前物品的目标产量</button><span id="railImportMessage" role="status"></span></div></div>
 <div class="panel"><h3>02 / 列车与站台</h3><div class="formgrid">${railNumber("minutes", "实测完整往返 / 分钟", 0.01)}${railNumber("wagons", "每列货运车厢 / 节", 1, 1)}${railNumber("trains", "共用本线路的列车 / 列", 1, 1)}${fluid ? railNumber("fluidCapacity", "单车厢容量 / m³", 1) : railNumber("stack", "物品堆叠上限 / 件", 1, 1)}${railNumber("pause", "每站装卸暂停 / 秒")}${railNumber("loadRate", "装货：每站台接口合计 / " + unit(r.item))}${railNumber("unloadRate", "卸货：每站台接口合计 / " + unit(r.item))}</div><div class="buttons rail-presets"><span>两端接口快捷设置：</span>${(fluid ? [300, 600] : [60, 120, 270, 480, 780, 1200]).map((v) => `<button data-rail-port="${v}">单${fluid ? "管" : "带"} ${v}</button><button data-rail-port="${v * 2}">双${fluid ? "管" : "带"} ${v}×2</button>`).join("")}</div></div>
 <div id="railResults" aria-live="polite"></div><details class="panel"><summary>计算规则与数据</summary><p>均匀发车，所有列车编组相同，每圈在装、卸站各停靠一次；没有其他线路争用站台。班次间隔 H = 往返秒数 ÷ 列车数；站台可输送比例 F = 1 − 暂停秒数 ÷ H。</p><p>单车厢每分钟有效运力 = min（容量 × 60 ÷ H，装货接口合计 × F，卸货接口合计 × F）。同一站台每次到站只扣一次暂停；往返时间已包含两端装卸，不重复扣除。</p><p>固体容量为 32 格 × 堆叠上限。流体默认 2400 m³；旧版可手动改为 1600。装卸暂停默认 27.08 秒。物品堆叠上限取本页内置游戏 Docs；<a href="https://satisfactory.wiki.gg/wiki/Train_throughput" target="_blank" rel="noopener">车厢与暂停时间参考</a> · <a href="https://satisfactory.wiki.gg/wiki/Freight_Platform" target="_blank" rel="noopener">站台接口参考</a>。</p><p>结果是稳定运行的理论上限。增开列车后应重新测量往返时间；不模拟铁路信号、坡度、牵引功率、混装、其他线路抢占或流体晃动。应配置外部缓冲，并确保上下游带／管能达到填写的接口速率。</p></details>`;
  railItemOptions();
  renderRailResults();
}
function renderRailResults() {
  const r = state.rail,
    fluid = I[r.item].fluid,
    m = railMath(r, fluid),
    u = unit(r.item),
    volume = fluid ? "m³" : "件",
    enough = m.total + 1e-8 >= m.target;
  let trains = null;
  for (let n = 1; n <= 1000; n++) {
    const t = railMath({ ...r, trains: n }, fluid);
    if (t.interval <= r.pause) break;
    if (t.valid && t.total + 1e-8 >= m.target) {
      trains = n;
      break;
    }
  }
  const bottleneck = !m.valid
    ? "班次时间不可行"
    : m.perWagon === m.car
      ? "车厢容量 / 班次"
      : m.perWagon === m.loading
        ? "装货接口"
        : "卸货接口";
  $("railResults").innerHTML =
    `<div class="stats"><div class="stat"><span>整条线路有效运力</span><strong>${fmt(m.total)}</strong><small>${u}</small></div><div class="stat"><span>含 ${fmt(r.margin)}% 余量的需求</span><strong>${fmt(m.target)}</strong><small>${u}</small></div><div class="stat"><span>到站间隔</span><strong>${fmt(m.interval / 60)}</strong><small>分钟 / 班</small></div><div class="stat"><span>站台可输送时间</span><strong>${fmt(m.available * 100)}%</strong><small>每次停靠暂停 ${fmt(r.pause)} 秒</small></div></div>
 <div class="panel"><h3>03 / 运力诊断</h3><div class="status${enough && m.valid ? "" : " error"}">${!m.valid ? "当前时刻表不可行：往返必须包含两端装卸，且同一站到站间隔必须大于装卸暂停。" : enough ? `运力充足 · 含余量后还剩 ${fmt(m.total - m.target)} ${u}` : `运力不足 · 含余量后缺少 ${fmt(m.target - m.total)} ${u}`}</div><p>当前限制：<b>${bottleneck}</b>。单车厢装载 ${fmt(m.capacity)} ${volume}；全列 ${fmt(m.capacity * r.wagons)} ${volume}。</p><div class="rail-limits">${[
   ["车厢周转", m.car],
   ["装货接口", m.loading],
   ["卸货接口", m.unloading],
 ]
   .map(
     ([name, value]) =>
       `<div><span>${name} / 全线路</span><b>${fmt(value * r.wagons)} ${u}</b></div>`,
   )
   .join("")}</div></div>
 <div class="panel"><h3>04 / 按需求反推</h3><div class="rail-limits"><div><span>保持 ${r.trains} 列火车，每列至少</span><b>${m.needed === null ? "当前时刻表或接口无解" : m.needed + " 节货运车厢"}</b></div><div><span>保持每列 ${r.wagons} 节，至少</span><b>${r.demand === 0 ? "0 列火车" : trains === null ? "1–1000 列内无可行解" : trains + " 列火车"}</b></div><div><span>当前配置每端需要</span><b>${r.wagons} 个货运站台</b></div></div><div class="buttons" style="margin-top:14px">${m.needed > 0 && m.needed <= 1000 ? `<button data-rail-apply="wagons" data-value="${m.needed}">应用建议车厢数</button>` : ""}${trains && r.demand > 0 ? `<button data-rail-apply="trains" data-value="${trains}">应用建议列车数</button>` : ""}</div><p>仅覆盖一次装卸暂停：装货端外部缓冲至少预留 <b>${fmt((r.demand * r.pause) / 60)} ${volume}</b> 空间，卸货端至少备有相同数量。此数仅为暂停期间的缓冲下限，连续供货还需覆盖班次间隔与延误。</p></div>`;
}
function initRail() {
  const el = $("railTab");
  el.addEventListener("input", (e) => {
    if (e.target.id === "railSearch") railItemOptions(e.target.value);
    if (e.target.dataset.rail) {
      const input = e.target;
      if (input.value === "" || !Number.isFinite(+input.value)) return;
      state.rail = normalizeRail({
        ...state.rail,
        [input.dataset.rail]: +input.value,
      });
      renderRailResults();
      save();
    }
  });
  el.addEventListener("change", (e) => {
    if (e.target.dataset.rail)
      e.target.value = state.rail[e.target.dataset.rail];
    if (e.target.id === "railItem") {
      const id = e.target.value,
        fluid = I[id].fluid,
        wasFluid = I[state.rail.item].fluid;
      state.rail.item = id;
      state.rail.stack = I[id].stack || 100;
      if (!!fluid !== !!wasFluid)
        state.rail.loadRate = state.rail.unloadRate = fluid ? 1200 : 2400;
      renderRail();
      save();
    }
  });
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.railPort) {
      state.rail.loadRate = state.rail.unloadRate = +d.railPort;
      renderRail();
      save();
    }
    if (d.railApply) {
      state.rail[d.railApply] = +d.value;
      renderRail();
      save();
    }
    if (b.id === "railImportSupply" || b.id === "railImportProduct") {
      const id = state.rail.item,
        q =
          b.id === "railImportSupply"
            ? current?.external?.[id]
            : state.products.find((p) => p.id === id)?.q;
      if (!Number.isFinite(q)) {
        $("railImportMessage").textContent =
          "当前方案没有该物品的对应需求，请先在主产线设置。";
        return;
      }
      state.rail.demand = q;
      renderRail();
      $("railImportMessage").textContent =
        "已带入 " + fmt(q) + " " + unit(id) + "；后续产线变更可再次带入。";
      save();
    }
  });
}

let machineSupplyUndo = null;
function machineSupplyButton(id, recipe) {
  if (state.mode === "forward" || !I[id]?.selectable || isPowerItem(id))
    return "";
  const final = hasProductMaterial(id);
  return `<button class="machine-supply-button" data-machine-supply="${esc(id)}" data-supply-recipe="${esc(recipe)}" title="${final ? "转为外部供给，并从最终产物移除" : "设为外部供给起点，不再自动制造此物品"}">${final ? "转为供给（移出产物）" : "加入供给"}</button>`;
}
function machineInputsCell(row) {
  return (
    Object.entries(row.ins || {})
      .filter(([, q]) => q > EPS)
      .map(
        ([id, q]) =>
          `<div class="machine-input-line"><span>${esc(I[id]?.name || id)} <b>${fmt(q)}</b> <small>${unit(id)}</small></span></div>`,
      )
      .join("") || '<span class="small">—</span>'
  );
}
function machineOutputsCell(row) {
  return Object.entries(row.outs)
    .map(
      ([id, q]) =>
        `<div class="machine-output-line"><span>${esc(I[id]?.name || id)} <b>${fmt(q)}</b> <small>${unit(id)}</small></span>${machineSupplyButton(id, row.k)}</div>`,
    )
    .join("");
}
function convertMachineOutputToSupply(id, k) {
  if (
    state.mode === "forward" ||
    !current ||
    !I[id]?.selectable ||
    isPowerItem(id)
  )
    return;
  const row = current.rows.find((r) => r.k === k),
    q = row?.outs[id];
  if (!(q > EPS)) return;
  const before = JSON.parse(JSON.stringify(state)),
    removed = hasProductMaterial(id);
  state.products = state.products.filter((p) => materialId(p.id) !== id);
  let entry = state.supplies.find((p) => p.id === id);
  const old = entry?.q || 0;
  if (!entry) {
    entry = { id, q: 0, stop: true };
    state.supplies.push(entry);
  }
  entry.stop = true;
  entry.q = Math.max(old, cleanComputedQuantity(q));
  const next = summarize(
    planSolve(demands(), state, { mode: state.mode }),
    state,
  );
  if (!next) {
    state = before;
    renderAll();
    setStatus("转为供给后产线不可行，已保留原方案。", true);
    return;
  }
  const extraction = state.nodes
      .filter((n) => n.item === id)
      .reduce((sum, n) => sum + nodeOutput(n).output, 0),
    needed = Math.max(0, (next.external[id] || 0) - extraction);
  entry.q = cleanComputedQuantity(Math.max(old, needed, q));
  renderAll();
  machineSupplyUndo = { before, after: JSON.stringify(state) };
  setStatus(
    "已将 " +
      I[id].name +
      " 设为外部供给起点：" +
      fmt(entry.q) +
      " " +
      unit(id) +
      (removed ? "；已从最终产物移除。" : "；上游产线已重新计算。"),
  );
  const undo = document.createElement("button");
  undo.id = "undoMachineSupply";
  undo.textContent = "撤销转为供给";
  undo.style.marginLeft = "12px";
  $("status").append(undo);
}
function initMachineSupply() {
  document.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (!button) return;
    if (button.dataset.machineSupply)
      convertMachineOutputToSupply(
        button.dataset.machineSupply,
        button.dataset.supplyRecipe,
      );
    if (button.id === "undoMachineSupply" && machineSupplyUndo) {
      if (machineSupplyUndo.after !== JSON.stringify(state)) {
        setStatus("方案已继续修改，撤销入口已关闭。");
        machineSupplyUndo = null;
        return;
      }
      state = machineSupplyUndo.before;
      machineSupplyUndo = null;
      renderAll();
      setStatus("已撤销转为外部供给。");
    }
  });
}

function sloopControl(row) {
  const parent = recipeBase(row.k), a = amplification(row.k);
  if (R[row.k].groupParent) return `<div class="sloop-control"><b>组 ${R[row.k].groupId} · 每台 ${a.count} 枚晶体</b><small>产出 ×${fmt(a.boost)} · 耗电 ×${fmt(a.boost ** 2)} · 本组安装 ${row.n * a.count} 枚</small><button data-machine-groups="${esc(parent)}">编辑同配方分组</button></div>`;
  const groupsButton = state.machineGroupsEnabled ? `<button data-machine-groups="${esc(parent)}">机器分组配置</button>` : "";
  if (!a.slots) return groupsButton;
  return groupsButton + `<div class="sloop-control"><label>每台索莫晶体 <input type="number" min="0" max="${a.slots}" step="1" value="${displayNumber(a.count)}" data-sloop="${esc(row.k)}" aria-label="${esc(R[row.k].name)}每台索莫晶体数量"> / ${a.slots}</label><small>产出 ×${fmt(a.boost)} · 耗电 ×${fmt(a.boost ** 2)} · 本组需 ${row.n * a.count} 枚</small></div>`;
}
function initAmplification() {
  document.addEventListener("change", (e) => {
    const k = e.target.dataset.sloop;
    if (!k || !R[k]) return;
    state.sloops ??= {};
    const slots = B[R[k].b]?.sloopSlots || 0;
    state.sloops[k] = Math.max(
      0,
      Math.min(slots, Math.floor(amount(e.target.value))),
    );
    fitSupplies();
    renderAll();
    setStatus(
      "晶体配置已更新。固定目标时会减少原料需求；点击发电量卡片的“剩余资源优先发电”可重算最大电量。",
    );
  });
}

function machineClockControl(row) {
  if (!state.over) return "";
  if (R[row.k].groupParent) return `<small class="machine-clock-control">本组频率 ${fmt(machineClock(row.k))}% · 在分组配置中修改</small>`;
  const b = R[row.k].b,
    custom = Object.hasOwn(state.machineClocks || {}, b);
  return `<div class="machine-clock-control"><label>本类频率 % <input type="number" min="1" max="250" step="any" value="${displayNumber(custom ? state.machineClocks[b] : "")}" placeholder="${fmt(machineClock(row.k))}" data-clocktype="${esc(b)}" aria-label="${esc(B[b].name)}本类频率" title="适用于全部同类机器，范围 1–250%；留空恢复全局频率。"></label><small>${custom ? "本类单独设置" : "跟随全局频率"} · ${esc(B[b].name)}</small>${custom ? `<button data-clockreset="${esc(b)}">恢复全局</button>` : ""}<small>按此频率配置整台机器，末台自动降频。</small></div>`;
}
function initMachineClocks() {
  document.addEventListener("change", (e) => {
    const b = e.target.dataset.clocktype;
    if (!b || !B[b]) return;
    state.machineClocks ??= {};
    const raw = e.target.value.trim(),
      v = Number(raw);
    if (!raw) delete state.machineClocks[b];
    else if (Number.isFinite(v) && v >= 1 && v <= 250)
      state.machineClocks[b] = v;
    else {
      renderAll();
      setStatus("频率请输入 1–250%，留空恢复全局。", true);
      return;
    }
    renderAll();
    setStatus("同类机器频率已更新，机器数量、耗电和能量碎片已重新计算。");
  });
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-clockreset]")?.dataset.clockreset;
    if (!b) return;
    delete state.machineClocks[b];
    renderAll();
    setStatus("本类机器已恢复全局频率。");
  });
}

function renderConstraintChoices(query = "") {
  const selected = state.inputConstraint.id,
    ids = ITEM_IDS.filter(
      (id) =>
        id !== "Workbench_Electricity" &&
        !hasProductMaterial(id) &&
        itemMatch(id, query),
    );
  $("constraintItem").innerHTML = [...new Set([selected, ...ids])]
    .map(
      (id) => `<option value="${esc(id)}">${esc(I[id]?.name || id)}</option>`,
    )
    .join("");
  $("constraintItem").value = selected;
}
function renderInputConstraint() {
  const panel = $("inputConstraintPanel");
  if (!panel) return;
  panel.hidden = state.mode !== "constrained";
  if (panel.hidden) return;
  renderConstraintChoices($("constraintSearch").value);
  $("constraintAmount").value = displayNumber(state.inputConstraint.q);
  $("constraintSummary").textContent =
    I[state.inputConstraint.id].name +
    " ≤ " +
    fmt(state.inputConstraint.q) +
    " " +
    unit(state.inputConstraint.id);
}
function initInputConstraint() {
  $("constraintSearch").oninput = (e) =>
    renderConstraintChoices(e.target.value);
  $("constraintItem").onchange = (e) => {
    state.inputConstraint.id = e.target.value;
    fitSupplies();
    renderAll();
  };
  $("constraintAmount").onchange = (e) => {
    state.inputConstraint.q = amount(e.target.value);
    fitSupplies();
    renderAll();
  };
  $("constraintUseSupply").onclick = () => {
    state.inputConstraint.q = supplyPool()[state.inputConstraint.id] || 0;
    fitSupplies();
    renderAll();
    setStatus("已使用该物料现有外供与资源点供给合计作为上限。");
  };
  $("constraintFitTargets").onclick = () => {
    fitSupplies();
    renderAll();
    setStatus("已按单输入上限适配未锁定产量；锁定项保持不变。");
  };
}

function allocatePowerFromInputs() {
  const id = "Workbench_Electricity";
  if (state.mode === "reverse") {
    setStatus("请先选择供给模式或单输入约束模式，再自动分配发电量。", true);
    return;
  }
  if (!Object.hasOwn(state.selected, id))
    state.selected[id] = defaultPowerRecipe(state);
  if (!state.products.some((p) => p.id === id))
    state.products.push({ id, q: 0, lock: false, pin: true });
  const product = state.products.find((p) => p.id === id);
  if (product.lock) {
    setStatus("发电量已锁定，请先解锁。", true);
    return;
  }
  const max = allocationMax(id);
  if (max.unbounded) {
    renderAll();
    setStatus(
      "所选发电燃料不受当前输入限制，请选择对应的约束物料或填写目标电量。",
      true,
    );
    return;
  }
  const report = changeQuantity(id, max.ok ? max.result.goal : 0);
  renderAll();
  if (report) showDiagnostic(report);
  else setStatus("已按所选发电燃料分配剩余资源，并反推其他原料需求。");
  revealPlannerTarget("product-" + id);
}
function initPowerAllocation() {
  const button = document.createElement("button");
  button.id = "allocatePower";
  button.textContent = "分配发电量";
  button.onclick = allocatePowerFromInputs;
  document.querySelector(".planner-heading .buttons").append(button);
}

const $ = (id) => document.getElementById(id),
  esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    ),
  fmt = (x) =>
    new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(
      Math.abs(x || 0) < 0.0005 ? 0 : x,
    ),
  unit = (id) => (isPowerItem(id) ? "MW" : I[id]?.fluid ? "m³/分" : "件/分");
let current = null,
  graph = null,
  diagnostic = null,
  pickerType = "supply",
  catalogLimit = 40,
  dragging = false,
  graphMode = "network",
  dirtyGraph = true;
function icon(id, large = false) {
  id = materialId(id);
  const src = ICONS[id] || ICONS[id?.replace("Build_", "Desc_")];
  return src
    ? `<img class="icon${large ? " large" : ""}" src="${src}" alt="${esc(I[id]?.name || B[id]?.name || id)}" loading="lazy">`
    : `<span class="icon placeholder${large ? " large" : ""}" title="未匹配游戏图标">无图标</span>`;
}
function material(id, q) {
  return `<span class="material">${icon(id)}${esc(I[id]?.name || id)} <b>${fmt(q)}</b></span>`;
}
function itemMatch(id, q) {
  const i = I[id];
  q = q.toLowerCase().replace(/[\s'’]/g, "");
  return (
    !q ||
    [
      i.name,
      i.en,
      i.py,
      i.initials,
      id,
      id === "Desc_IronPlateReinforced_C" ? "加强铁板 jqtb jiaqiangtieban" : "",
      id === "Desc_AluminumIngot_C" ? "lv lvding" : "",
    ]
      .join(" ")
      .toLowerCase()
      .replace(/[\s'’]/g, "")
      .includes(q)
  );
}
function recipeMatch(k, q) {
  if (R[k]?.groupParent) return false;
  const r = R[k],
    str = [r.name, r.en, r.py, r.initials, k]
      .join(" ")
      .toLowerCase()
      .replace(/\s/g, "");
  return (
    !q ||
    str.includes(q.toLowerCase().replace(/\s/g, "")) ||
    Object.keys(r.outs).some((id) => itemMatch(id, q))
  );
}
function save() {
  persistWorkspace();
}
function safeState(x) {
  if (!x || x.version !== 12)
    throw Error(
      "请导入新版工作台方案（version 12）。旧版方案请保留原文件查看。",
    );
  for (const product of x.products || []) ensureProductItem(product.id);
  const s = fresh();
  s.geothermal = normalizeGeothermal(x.geothermal);
  s.optimizationSettings = normalizeOptimizationSettings(x.optimizationSettings);
  s.optimizationReport = x.optimizationReport && Number.isFinite(x.optimizationReport.points) ? copy(x.optimizationReport) : null;
  s.machineGroups = normalizeMachineGroups(x.machineGroups);
  s.machineGroupsEnabled = typeof x.machineGroupsEnabled === "boolean" ? x.machineGroupsEnabled : Object.keys(s.machineGroups).length > 0;
  for (const key of Object.keys(s.machineGroups)) groupedRecipes(key, s);
  for (const k of ["over", "strict", "autoPin", "event"])
    s[k] = typeof x[k] === "boolean" ? x[k] : s[k];
  s.clock = Math.max(1, Math.min(s.over ? 250 : 100, amount(x.clock) || 100));
  for (const key of ["powerMult", "generationMult", "costMult"])
    s[key] = normalizeMultiplier(x[key]);
  s.mode = ["forward", "reverse", "constrained"].includes(x.mode)
    ? x.mode
    : "forward";
  s.inputConstraint = {
    id: I[x.inputConstraint?.id]?.selectable
      ? x.inputConstraint.id
      : "Desc_LiquidOil_C",
    q: amount(x.inputConstraint?.q ?? 300),
  };
  s.sort = ["desc", "asc", "default"].includes(x.sort) ? x.sort : "desc";
  const seen = new Set();
  s.products = (x.products || [])
    .filter((p) => I[p.id]?.selectable && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ id: p.id, q: amount(p.q), lock: !!p.lock, pin: !!p.pin }));
  const supplySeen = new Set();
  s.supplies = (x.supplies || [])
    .filter(
      (p) =>
        I[p.id]?.selectable &&
        !I[p.id]?.baseItem &&
        (!hasProductMaterial(p.id, s) || I[p.id]?.raw) &&
        !supplySeen.has(p.id) &&
        supplySeen.add(p.id),
    )
    .map((p) => ({ id: p.id, q: amount(p.q), stop: p.stop !== false }));
  s.selected = Object.fromEntries(
    Object.entries(x.selected || {}).filter(
      ([id, k]) =>
        I[id] &&
        (k === "" ||
          (R[k]?.kind === "machine" &&
            (R[k].outs[materialId(id)] > 0 ||
              (isPowerItem(id) && R[k].generation)))),
    ),
  );
  s.nodes = (x.nodes || [])
    .filter((n) => I[n.item]?.raw && !hasProductMaterial(n.item, s))
    .map((n, i) =>
      normalizeNode({
        ...n,
        id: Number.isInteger(n.id) && n.id > 0 ? n.id : i + 1,
      }),
    );
  s.generators = (x.generators || [])
    .filter((g) => GEN[g.fuel])
    .map((g, i) => ({
      id: Number.isInteger(g.id) && g.id > 0 ? g.id : i + 1,
      fuel: g.fuel,
      count: Math.floor(amount(g.count)),
      clock: Math.max(1, Math.min(250, amount(g.clock) || 100)),
      supply: amount(g.supply),
    }));
  s.built = Object.fromEntries(
    Object.entries(x.built || {})
      .filter(([k]) => /^(recipe|node|press|gen|geo):/.test(k))
      .map(([k, v]) => [k, Math.floor(amount(v))]),
  );
  s.transport = {
    belt: [60, 120, 270, 480, 780, 1200].includes(+x.transport?.belt)
      ? +x.transport.belt
      : 1200,
    pipe: +x.transport?.pipe === 300 ? 300 : 600,
  };
  s.board = normalizeBoard(x.board);
  s.rail = normalizeRail(x.rail);
  s.sloops = Object.fromEntries(
    Object.entries(x.sloops || {})
      .filter(
        ([k]) => R[k]?.kind === "machine" && (B[R[k].b]?.sloopSlots || 0) > 0,
      )
      .map(([k, n]) => [
        k,
        Math.max(0, Math.min(B[R[k].b].sloopSlots, Math.floor(amount(n)))),
      ]),
  );
  s.machineClocks = Object.fromEntries(
    Object.entries(x.machineClocks || {})
      .filter(([b, v]) => B[b] && Number.isFinite(v) && v >= 1)
      .map(([b, v]) => [b, Math.min(250, v)]),
  );
  s.genWater = amount(x.genWater);
  s.extraLoad = amount(x.extraLoad);
  s.progress = normalizeProgress(x.progress);
  s.map = normalizeMap(x.map);
  restoreOrphanRecipes(s);
  migrateMainPower(s, x);
  normalizeMappedGroups(s);
  return s;
}
function normalizeNode(n) {
  const machines = I[n.item]?.fluid
    ? n.item === "Desc_Water_C"
      ? ["water", "well"]
      : n.item === "Desc_NitrogenGas_C"
        ? ["well"]
        : ["oil", "well"]
    : ["mk1", "mk2", "mk3"];
  return bindMappedNode(
    {
      id: n.id,
      item: n.item,
      machine: machines.includes(n.machine) ? n.machine : machines[0],
      count: Math.floor(amount(n.count) || 1),
      purity: ["impure", "normal", "pure"].includes(n.purity)
        ? n.purity
        : "normal",
      clock: Math.max(1, Math.min(250, amount(n.clock) || 100)),
      belt: [60, 120, 270, 480, 780, 1200].includes(+n.belt) ? +n.belt : 1200,
      pipe: +n.pipe === 300 ? 300 : 600,
      pressurizers: Math.floor(amount(n.pressurizers ?? 1)),
    },
    n,
  );
}
function setStatus(text, error = false) {
  $("status").className = "status" + (error ? " error" : "");
  $("status").textContent = text;
}
function showDiagnostic(d) {
  diagnostic = d;
  if (!d) return;
  setStatus(
    d.reason,
    !!d.missing?.length || /无法|不足|超过|锁定/.test(d.reason),
  );
  if (d.missing?.length) {
    const div = document.createElement("div");
    div.className = "missing";
    div.innerHTML = d.missing
      .map(
        (x) =>
          `<button data-inspectmissing="${esc(x.id)}">缺 ${esc(I[x.id]?.name || x.id)} ${fmt(x.q)} ${unit(x.id)} · 查看与选择</button>`,
      )
      .join("");
    $("status").append(div);
  }
}
function openPicker(type) {
  pickerType = type;
  $("pickerTitle").textContent = {
    supply: "添加外部供给",
    product: "添加最终产物",
    node: "添加资源点 / 抽水站",
  }[type];
  $("pickerSearch").value = "";
  renderPicker();
  $("picker").showModal();
  $("pickerSearch").focus();
}
function renderPicker() {
  const q = $("pickerSearch").value;
  let list = ITEM_IDS.filter((id) => !I[id].handOnly && itemMatch(id, q));
  if (pickerType === "supply")
    list = list.filter(
      (id) =>
        !hasProductMaterial(id) && !state.supplies.some((p) => p.id === id),
    );
  if (pickerType === "product")
    list = list.filter(
      (id) =>
        !state.supplies.some((p) => p.id === id) &&
        !state.nodes.some((n) => n.item === id),
    );
  if (pickerType === "node")
    list = list.filter((id) => I[id].raw && !hasProductMaterial(id));
  list.sort((a, b) => I[a].name.localeCompare(I[b].name, "zh-CN"));
  $("pickerResults").innerHTML =
    list
      .slice(0, 100)
      .map(
        (id) =>
          `<button class="pickrow" data-pick="${esc(id)}">${icon(id)}<span class="grow">${esc(I[id].name)}<small>${esc(I[id].en)} · ${unit(id)}${!OPTIONS[id]?.length && !I[id].raw ? " · 手工 / 外供物品" : ""}</small></span><span>＋</span></button>`,
      )
      .join("") ||
    '<div class="empty">没有匹配项目。可以尝试英文名称或拼音。</div>';
}
function addPicked(id) {
  if (pickerType === "product") {
    const base = materialId(id),
      chosen = recipeFor(base);
    id = nextProductItem(base);
    if (!id) {
      setStatus("产物卡片数量已达上限。", true);
      return;
    }
    if (isPowerItem(id)) state.selected[id] = defaultPowerRecipe(state);
    else if (I[id]?.baseItem) state.selected[id] = chosen;
  }
  if (pickerType === "supply") state.supplies.push({ id, q: 0, stop: true });
  if (pickerType === "product")
    state.products.push({ id, q: 0, lock: false, pin: false });
  if (pickerType === "node")
    state.nodes.push(
      normalizeNode({
        id: Math.max(0, ...state.nodes.map((n) => n.id)) + 1,
        item: id,
        count: 1,
        clock: 100,
      }),
    );
  $("picker").close();
  renderAll();
  setStatus("已添加 " + I[id].name + "。");
}
function recipeSelect(id, cls = "") {
  const k = recipeFor(id);
  return `<select class="${cls}" data-recipe="${esc(id)}" aria-label="${esc(I[id]?.name)}生产配方"><option value=""${!k ? " selected" : ""}>外供 / 不自动生产</option>${recipeOptions(
    id,
  )
    .map(
      (r) =>
        `<option value="${esc(r)}"${r === k ? " selected" : ""}>${esc(R[r].name)}${R[r].alt ? " [替代]" : ""}${R[r].event ? " [FICSMAS]" : ""} · ${esc(B[R[r].b]?.name || "")}</option>`,
    )
    .join(
      "",
    )}</select>${recipeOptions(id).length > 1 ? `<button class="compare-button" data-compare="${esc(id)}">对比配方</button>` : ""}`;
}
function controls() {
  for (const k of ["over", "strict", "event", "autoPin"])
    $(k).checked = state[k];
  for (const k of ["mode", "sort", "clockNum", "powerMult"])
    $(k).value = displayNumber(state[k === "clockNum" ? "clock" : k]);
  $("clock").max = $("clockNum").max = state.over ? 250 : 100;
  $("clock").value = state.clock;
  $("applyReverse").hidden = state.mode === "forward";
  renderInputConstraint();
}
function renderSupplies() {
  $("supplies").innerHTML =
    state.supplies
      .map(
        (x) =>
          `<div class="card"><div class="top"><div class="itemhead">${icon(x.id)}<div><b>${esc(I[x.id].name)}</b><small style="display:block">${esc(I[x.id].en)}</small></div></div><button data-delsupply="${x.id}" aria-label="移除${esc(I[x.id].name)}">×</button></div><label class="rowfield">${unit(x.id)}<input data-supply="${x.id}" type="number" min="0" max="100000000" step="any" value="${displayNumber(cleanComputedQuantity(x.q))}"></label><label class="small"><input data-stop="${x.id}" type="checkbox" ${x.stop ? "checked" : ""}> 作为产线起点，不再制造此物品</label></div>`,
      )
      .join("") || '<div class="empty">尚未添加外部供给</div>';
}
function renderNodes() {
  $("nodes").innerHTML =
    state.nodes
      .map((n) => {
        const fluid = I[n.item].fluid,
          v = nodeOutput(n),
          options = fluid
            ? n.item === "Desc_Water_C"
              ? ["water", "well"]
              : n.item === "Desc_NitrogenGas_C"
                ? ["well"]
                : ["oil", "well"]
            : ["mk1", "mk2", "mk3"],
          names = {
            mk1: "1级采矿机",
            mk2: "2级采矿机",
            mk3: "3级采矿机",
            oil: "油井",
            water: "抽水站",
            well: "资源抽取器（资源井）",
          };
        return `<div class="card nodecard"><div class="top"><div class="itemhead">${icon(n.item)}<b>${esc(I[n.item].name)}</b></div><button data-delnode="${n.id}" aria-label="移除资源点">×</button></div><div class="formgrid"><label>设备<select data-node="${n.id}" data-field="machine">${options.map((k) => `<option value="${k}"${k === n.machine ? " selected" : ""}>${names[k]}</option>`).join("")}</select></label><label>纯度<select data-node="${n.id}" data-field="purity" ${n.machine === "water" || n.mapId ? "disabled" : ""}>${[
          ["impure", "贫瘠 ×0.5"],
          ["normal", "普通 ×1"],
          ["pure", "纯净 ×2"],
        ]
          .map(
            ([k, t]) =>
              `<option value="${k}"${k === n.purity ? " selected" : ""}>${t}</option>`,
          )
          .join(
            "",
          )}</select></label><label>资源点 / 设备数<input data-node="${n.id}" data-field="count" ${n.mapId ? "disabled" : ""} type="number" min="1" step="1" value="${displayNumber(n.count)}"></label><label>单台频率 %<input data-node="${n.id}" data-field="clock" type="number" min="1" max="250" step="any" value="${displayNumber(n.clock)}"></label><label>单机出口上限<select data-node="${n.id}" data-field="${fluid ? "pipe" : "belt"}">${(fluid ? [300, 600] : [60, 120, 270, 480, 780, 1200]).map((q) => `<option value="${q}"${q === (fluid ? n.pipe : n.belt) ? " selected" : ""}>${q} ${unit(n.item)}</option>`).join("")}</select></label>${n.machine === "well" ? `<label>增压站数<input data-node="${n.id}" data-field="pressurizers" ${n.mapCore ? "disabled" : ""} type="number" min="0" step="1" value="${displayNumber(n.pressurizers)}"></label>` : ""}</div><p><b>${fmt(v.output)} ${unit(n.item)}</b> · ${fmt(v.power * state.powerMult)} MW</p>${v.limited ? '<small class="over">受出口带速 / 管速限制；理论 ' + fmt(v.theoretical) + "</small>" : ""}${n.mapId ? `<button data-map-focus="${esc(n.mapId)}">在地图定位</button>` : ""}${n.machine === "well" ? '' : ""}</div>`;
      })
      .join("") || '<div class="empty">尚未添加资源点</div>';
}
function productOrder() {
  return [...state.products].sort(
    (a, b) =>
      Number(b.pin) - Number(a.pin) ||
      (state.autoPin ? Number(b.q > EPS) - Number(a.q > EPS) : 0) ||
      (state.sort === "default"
        ? 0
        : state.sort === "asc"
          ? a.q - b.q
          : b.q - a.q),
  );
}
function renderProducts() {
  for (const p of state.products)
    if (isPowerItem(p.id) && !Object.hasOwn(state.selected, p.id))
      state.selected[p.id] = defaultPowerRecipe(state);
  $("products").innerHTML =
    productOrder()
      .map(
        (p) =>
          `<div class="card${p.q > EPS ? " active" : ""}${p.lock ? " locked" : ""}" id="product-${p.id}"><div class="top"><div class="itemhead">${icon(p.id)}<div><h3>${esc(productTitle(p.id))}</h3><small>${esc(I[p.id].en)}</small></div></div><div class="actions"><button data-pin="${p.id}" class="${p.pin ? "pinon" : ""}" aria-pressed="${p.pin}">${p.pin ? "已置顶" : "置顶"}</button><button data-lock="${p.id}" aria-pressed="${p.lock}">${p.lock ? "已锁定" : "锁定"}</button><button data-duplicate-product="${p.id}" title="添加同物品的独立产物卡片">＋</button><button data-delproduct="${p.id}" aria-label="删除产物">×</button></div></div>${isPowerItem(p.id) ? '' : ""}${recipeSelect(p.id)}<div class="amountline"><input type="number" min="0" max="100000000" step="any" data-quantity="${p.id}" value="${displayNumber(+p.q.toFixed(3))}" ${p.lock ? "disabled" : ""} aria-label="${esc(I[p.id].name)}产量"><small>${unit(p.id)}</small><button data-maxproduct="${p.id}" ${p.lock ? "disabled" : ""}>${state.mode === "reverse" ? "反推此产量" : isPowerItem(p.id) ? "剩余资源优先发电" : "优先分配"}</button></div><input type="range" min="0" max="${Math.max(100, Math.ceil(p.q * 1.5))}" step="1" value="${Math.round(p.q)}" data-slider="${p.id}" ${p.lock ? "disabled" : ""} aria-label="${esc(I[p.id].name)}整数产量滑条"><div id="single-${p.id}" class="small"></div><div id="cap-${p.id}" class="small"></div></div>`,
      )
      .join("") ||
    '<div class="empty">尚未添加产物。搜索添加你想生产的物品。</div>';
  refreshCaps();
  refreshSingleOutput();
}
function refreshCaps() {
  for (const p of state.products) {
    const el = document.querySelector(`[data-slider="${p.id}"]`);
    if (!el) continue;
    const m = state.mode !== "reverse" ? allocationMax(p.id) : null,
      cap = m?.ok ? m.result.goal || 0 : 0;
    el.max = Math.max(
      100,
      Math.ceil(p.q * 1.5),
      state.mode !== "reverse" ? Math.min(1e8, Math.ceil(cap * 1.2)) : 0,
    );
    el.value = Math.round(p.q);
    $(`cap-${p.id}`).textContent =
      state.mode === "constrained"
        ? m?.unbounded
          ? "该产物不受所选输入限制；直接填写目标产量。"
          : `单输入约束下，保留锁定项后的最大值 ${fmt(cap)} ${unit(p.id)}`
        : state.mode === "forward"
          ? `保留锁定项后的最大值 ${fmt(cap)} ${unit(p.id)} · 超过时显示缺料`
          : "目标反推：不限于当前供给，按目标产量计算原料";
  }
}
function lastMachineOutputs(row) {
  if (!(row.eq > 0) || !row.n) return [];
  const share = (row.tail ? row.tail * (row.duty ?? 1) : row.cap) / row.eq;
  return Object.entries(row.outs || {}).map(([id, q]) => ({
    id,
    q: cleanComputedQuantity(q * share),
  }));
}
function lastMachineOutputText(row) {
  return lastMachineOutputs(row)
    .map(({ id, q }) => (I[id]?.name || id) + " " + fmt(q) + " " + unit(id))
    .join("；");
}
function machineLabel(row) {
  if (R[row.k]?.groupParent) {
    const active = row.activeN || 0;
    const tail = row.tail ? ' · 末台 ' + fmt(row.tail * 100) + '%' : '';
    return `配置 ${fmt(row.n)} 台 × ${fmt(row.cap * 100)}% · 运行 ${fmt(active)} 台${tail}`;
  }
  const a = [];
  if (row.full) a.push(`${fmt(row.full)}台 × ${fmt(row.cap * 100)}%`);
  if (row.tail)
    a.push(
      `末台 × ${fmt(row.tail * 100)}%${row.duty < 0.999999 ? "（运行占比 " + fmt(row.duty * 100) + "%）" : ""}`,
    );
  return a.join(" ＋ ") || "0台";
}
function renderResults() {
  const solution = planSolve(demands(), state, { mode: state.mode });
  current = summarize(solution);
  dirtyGraph = true;
  graphPreview = null;
  refreshSingleOutput();
  const p = current;
  renderMachineGroupProfiles();
  $("stats").innerHTML = [
    ["生产机器 / 台", p ? fmt(p.machines) : "—"],
    ["平均耗电 / MW", p ? fmt(p.power) : "—"],
    ["峰值耗电 / MW", p ? fmt(p.peak) : "—"],
    ["能量碎片", p ? fmt(p.shards) : "—"],
    ["使用索莫晶体", p ? fmt(p.sloopTotal) : "—"],
    ["总平均发电 / MW", p ? fmt(p.generation) : "—"],
    ["地热平均 / MW", fmt(geothermalPower().average)],
    ["外部电力 / MW", p ? fmt(p.importedPower || 0) : "—"],
    ["净余电 / MW", p ? fmt(p.generation + (p.importedPower || 0) - p.power - state.extraLoad) : "—"],
  ]
    .map(
      ([k, v]) =>
        `<div class="stat"><span>${k}</span><strong>${v}</strong></div>`,
    )
    .join("");
  if (!p) {
    $("balance").innerHTML =
      '<p class="over">' +
      (solution.constraintConflict
        ? "单输入约束物料不能同时作为最终产物，请更换约束物料。"
        : "当前目标不可行。供给、锁定项、手工物品或流体副产物约束可能冲突。") +
      "</p>";
    $("machines").innerHTML = "";
    $("surplus").innerHTML = "";
    $("processBalance").innerHTML = $("balance").innerHTML;
    renderBill();
    if (!$("graphTab").hidden) renderGraph();
    return;
  }
  const pool = supplyPool();
  if (state.mode === "constrained")
    pool[state.inputConstraint.id] = state.inputConstraint.q;
  const ids = [
    ...new Set([
      ...Object.keys(pool),
      ...Object.keys(p.external).filter((id) => p.external[id] > EPS),
    ]),
  ];
  $("balance").innerHTML = ids.length
    ? `<div class="tablewrap"><table><thead><tr><th>外部物料</th><th>当前供给 / 分</th><th>产线需求 / 分</th><th>差额</th></tr></thead><tbody>${ids.map((id) => `<tr><td>${material(id, 0).replace(" <b>0</b>", "")}<small> ${unit(id)}</small></td><td>${state.mode === "constrained" && id !== state.inputConstraint.id ? "自动反推" : fmt(pool[id] || 0)}</td><td>${fmt(p.external[id] || 0)}</td><td class="${(state.mode !== "constrained" || id === state.inputConstraint.id) && (p.external[id] || 0) > (pool[id] || 0) + EPS ? "over" : ""}">${state.mode === "constrained" && id !== state.inputConstraint.id ? "—" : fmt((pool[id] || 0) - (p.external[id] || 0))}</td></tr>`).join("")}</tbody></table></div>`
    : '<p class="small">设定产量后显示供给需求。</p>';
  $("machines").innerHTML =
    machineDisplayOrder(p.rows, state, p)
      .map((row) => {
        const main =
          state.products.find(
            (p) =>
              recipeFor(p.id) === recipeBase(row.k) && R[row.k].outs[materialId(p.id)] > 0,
          )?.id || Object.keys(R[row.k].outs)[0];
        return `<tr id="machine-${row.k}" class="${machineIsBuilt(row) ? "machine-built" : ""}"><td class="wrap"><div class="itemhead">${icon(R[row.k].b)}<div>${esc(B[R[row.k].b]?.name)}<br><small>${esc(R[row.k].name)}</small>${row.flowCycle ? '<div class="badge">循环回流</div>' : ""}${machineIsBuilt(row) ? '<div class="badge" style="margin-top:6px">✓ 已建成</div>' : ""}</div></div>${recipeSelect(main, "recipe-choice")}</td><td class="wrap machine-materials"><div class="machine-material-label">输入材料 · 本组总需求</div>${machineInputsCell(row)}<div class="machine-material-label machine-output-label">输出产物</div>${machineOutputsCell(row)}</td><td class="wrap">${machineLabel(row)}<div class="small" style="margin-top:8px"><b>末台${row.duty < 0.999999 ? "平均" : ""}产出：</b>${esc(lastMachineOutputText(row))}</div>${machineClockControl(row)}${sloopControl(row)}</td><td>${row.shards}</td><td>${R[row.k].generation ? "发电 " + fmt(row.outs.Workbench_Electricity || 0) + " MW" : fmt(row.power) + " / " + fmt(row.peak)}</td>${machineBuildCells(row)}</tr>`;
      })
      .join("") || '<tr><td colspan="7">暂无生产机器。</td></tr>';
  const surplus = Object.entries(p.surplus).filter(([id, q]) => q > 1e-5);
  $("surplus").innerHTML =
    '<div class="chipline">' +
    surplus
      .map(
        ([id, q]) =>
          `<span class="chip">${esc(I[id]?.name || id)} <b>${fmt(q)} ${unit(id)}</b></span>`,
      )
      .join("") +
    "</div>" +
    (surplus.length ? "" : "<p>没有多余副产物。</p>");
  renderReuseAndStartup(p);
  renderBill();
  if (!$("graphTab").hidden) renderGraph();
  save();
}
function renderProcess() {
  const oil = [
    "Desc_Plastic_C",
    "Desc_Rubber_C",
    "Desc_HeavyOilResidue_C",
    "Desc_PolymerResin_C",
    "Desc_LiquidFuel_C",
    "Desc_LiquidTurboFuel_C",
    "Desc_RocketFuel_C",
    "Desc_IonizedFuel_C",
  ];
  const aluminum = [
    "Desc_AluminaSolution_C",
    "Desc_AluminumScrap_C",
    "Desc_AluminumIngot_C",
    "Desc_AluminumPlate_C",
    "Desc_AluminumCasing_C",
    "Desc_Silica_C",
  ];
  for (const [el, list] of [
    ["oilChoices", oil],
    ["alChoices", aluminum],
  ])
    $(el).innerHTML = list
      .filter((id) => I[id])
      .map(
        (id) =>
          `<div><div class="itemhead">${icon(id)}<b>${esc(I[id].name)}</b></div>${recipeSelect(id)}</div>`,
      )
      .join("");
}
function renderAll() {
  renderOptimizationPlanSummary();
  restoreOrphanRecipes();
  if ($("settingsTab")) renderMultiplierSettings();
  normalizeMappedGroups();
  controls();
  renderSupplies();
  renderNodes();
  renderGeothermal();
  renderProducts();
  renderProcess();
  renderResults();
  syncMapUI();
  if (!$("progressTab").hidden) renderProgress();
  save();
}
function switchTab(tab) {
  if (tab === "process" || tab === "power") tab = "planner";
  for (const t of [
    "planner",
    "graph",
    "catalog",
    "construction",
    "workspace",
    "worldmap",
    "progress",
    "home",
    "journal",
    "rail",
    "settings",
  ])
    $(t + "Tab").hidden = t !== tab;
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("selected", b.dataset.tab === tab));
  if (typeof interfaceNavigate === "function") interfaceNavigate(tab);
  if (tab === "settings") renderMultiplierSettings();
  if (tab === "rail") renderRail();
  if (tab === "graph") renderGraph();
  if (tab === "progress") renderProgress();
  if (tab === "catalog") renderCatalog();
  if (tab === "construction") renderProjectViews();
  if (tab === "workspace") renderWorkspace();
  if (tab === "worldmap") {
    syncMapUI();
    requestMapDraw();
  }
}
function renderCatalog() {
  const q = $("catalogSearch").value,
    kind = $("catalogKind").value,
    items = $("catalogDisplay").value === "items";
  let list = items
    ? ITEM_IDS.filter((k) => itemMatch(k, q))
    : Object.keys(R).filter(
        (k) =>
          recipeMatch(k, q) &&
          (kind === "all" ||
            (kind === "alt" && R[k].alt) ||
            (kind === "event" && R[k].event) ||
            R[k].kind === kind),
      );
  $("catalogCount").textContent =
    `匹配 ${list.length} 项 · 显示前 ${Math.min(catalogLimit, list.length)} 项`;
  $("catalogMore").hidden = catalogLimit >= list.length;
  $("catalog").innerHTML =
    list
      .slice(0, catalogLimit)
      .map((k) => {
        if (items) {
          const i = I[k];
          return `<article class="card"><div class="itemhead">${icon(k, true)}<div><h3>${esc(i.name)}</h3><p>${esc(i.en)}</p><small>${esc(i.py)} · ${esc(i.initials)}</small></div></div><p class="small">${OPTIONS[k]?.length || 0}个机器生产配方 · ${i.fluid ? "流体" : "固体"}</p><button data-showitem="${k}">查看相关配方</button></article>`;
        }
        const r = R[k],
          id = Object.keys(r.outs)[0],
          t = {
            machine: "机器生产",
            hand: "手工制作",
            build: "建筑配方",
            custom: "涂装 / 自定义",
          }[r.kind];
        return `<article class="card"><div class="itemhead">${icon(id)}<div><h3>${esc(r.name)}</h3><small>${esc(r.en)}</small></div></div><p><span class="badge">${t}</span> ${r.alt ? '<span class="badge">替代</span>' : ""} ${r.event ? '<span class="badge">FICSMAS</span>' : ""} ${r.b ? esc(B[r.b]?.name) : ""}</p><div class="recipeDetail">${Object.entries(
          r.ins,
        )
          .map(([i, v]) => material(i, v))
          .join(" + ")} → ${Object.entries(r.outs)
          .map(([i, v]) => material(i, v))
          .join(
            " + ",
          )}</div><p class="small">每批 ${fmt(r.time)} 秒${r.kind === "machine" ? " · 100% " + fmt(r.p) + " MW（峰值 " + fmt(r.peak) + "）" : ""}</p>${r.kind === "machine" ? `<button data-useRecipe="${k}">用于主方案</button>` : "<small>仅供查阅，不计作自动化机器产线。</small>"}</article>`;
      })
      .join("") || '<div class="empty">没有匹配结果。</div>';
}
function applyRecipe(id, k) {
  const prev = state.selected[id];
  state.selected[id] = k;
  if (
    !planSolve(lockedDemands(), state, { mode: state.mode }).ok &&
    state.products.some((p) => p.lock)
  ) {
    if (prev === undefined) delete state.selected[id];
    else state.selected[id] = prev;
    setStatus(
      "该配方无法满足已锁定的产量，已保留原配方。请补充供给或解锁。",
      true,
    );
  } else {
    fitSupplies();
    setStatus("配方已更新：" + (k ? R[k].name : "外供 / 不自动生产"));
  }
  renderAll();
}
const GEN = (() => {
  const out = {};
  for (const [type, b, mw, water, fuels] of [
    [
      "煤炭发电机",
      "Desc_GeneratorCoal_C",
      75,
      45,
      ["Desc_Coal_C", "Desc_CompactedCoal_C", "Desc_PetroleumCoke_C"],
    ],
    [
      "燃油发电机",
      "Desc_GeneratorFuel_C",
      250,
      0,
      [
        "Desc_LiquidFuel_C",
        "Desc_LiquidTurboFuel_C",
        "Desc_LiquidBiofuel_C",
        "Desc_RocketFuel_C",
        "Desc_IonizedFuel_C",
      ],
    ],
    [
      "核电站",
      "Desc_GeneratorNuclear_C",
      2500,
      240,
      [
        "Desc_NuclearFuelRod_C",
        "Desc_PlutoniumFuelRod_C",
        "Desc_FicsoniumFuelRod_C",
      ],
    ],
    [
      "生物质燃烧器",
      "Desc_GeneratorBiomass_Automated_C",
      30,
      0,
      [
        "Desc_Leaves_C",
        "Desc_Wood_C",
        "Desc_Mycelia_C",
        "Desc_GenericBiomass_C",
        "Desc_Biofuel_C",
        "Desc_PackagedBiofuel_C",
      ],
    ],
  ])
    for (const id of fuels)
      out[id] = {
        type: I[b]?.name || type,
        b,
        mw,
        water,
        rate: (mw * 60) / I[id].energy,
      };
  return out;
})();
function generatorCalculation(s = state) {
  const demand = {},
    pool = {};
  let water = 0;
  const rows = s.generators.map((g) => {
    const f = GEN[g.fuel],
      eq = (g.count * g.clock) / 100;
    demand[g.fuel] = (demand[g.fuel] || 0) + eq * f.rate;
    pool[g.fuel] = g.supply;
    return { ...g, eq, f };
  });
  for (const r of rows) {
    r.factor = Math.min(1, (pool[r.fuel] || 0) / (demand[r.fuel] || 1));
    water += r.eq * r.f.water * r.factor;
  }
  const w = Math.min(1, s.genWater / (water || 1));
  for (const r of rows) {
    if (r.f.water) r.factor *= w;
    r.gross = r.eq * r.f.mw * r.factor;
    r.usedFuel = r.eq * r.f.rate * r.factor;
    r.usedWater = r.eq * r.f.water * r.factor;
  }
  return {
    rows,
    gross: rows.reduce((s, r) => s + r.gross, 0),
    water: rows.reduce((s, r) => s + r.usedWater, 0),
  };
}
function renderGraph() {
  renderGraphPreviewLabel();
  const shown = graphPreview?.plan || current;
  if (!shown) {
    $("network").innerHTML =
      '<p class="empty">先设置可行产量，再查看连接图。</p>';
    $("tree").innerHTML = "";
    return;
  }
  if (!dirtyGraph) {
    return;
  }
  graph = flowGraph(shown, graphPreview?.s || state);
  const highlight = graphHighlight(graph);
  const { nodes, edges } = graph;
  if (!nodes.length) {
    $("network").innerHTML =
      '<div class="empty">添加产物并设置产量后显示网络图。</div>';
    $("tree").innerHTML = "";
    return;
  }
  const map = new Map(nodes.map((n) => [n.id, n])),
    adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) adj.get(e.from)?.push(e.to);
  let idx = 0,
    stack = [],
    indices = {},
    low = {},
    on = new Set(),
    components = [],
    comp = {};
  function visit(v) {
    indices[v] = low[v] = idx++;
    stack.push(v);
    on.add(v);
    for (const w of adj.get(v) || []) {
      if (indices[w] === undefined) {
        visit(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (on.has(w)) low[v] = Math.min(low[v], indices[w]);
    }
    if (low[v] === indices[v]) {
      const group = [];
      let w;
      do {
        w = stack.pop();
        on.delete(w);
        comp[w] = components.length;
        group.push(w);
      } while (w !== v);
      components.push(group);
    }
  }
  for (const n of nodes) if (indices[n.id] === undefined) visit(n.id);
  const parents = components.map(() => new Set());
  for (const e of edges)
    if (comp[e.from] !== comp[e.to]) parents[comp[e.to]].add(comp[e.from]);
  const ranks = {};
  function rank(c) {
    if (ranks[c] !== undefined) return ranks[c];
    return (ranks[c] = parents[c].size
      ? 1 + Math.max(...[...parents[c]].map(rank))
      : 0);
  }
  const columns = {};
  for (const n of nodes) {
    const r = rank(comp[n.id]);
    (columns[r] ??= []).push(n);
  }
  let maxRows = 0;
  for (const [col, ns] of Object.entries(columns)) {
    maxRows = Math.max(maxRows, ns.length);
    ns.forEach((n, i) => {
      n.x = 35 + +col * 370;
      n.y = 35 + i * 150;
    });
  }
  const width = 330 + Math.max(...Object.keys(columns).map(Number)) * 370,
    height = 70 + maxRows * 150;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="当前产线物料网络"><defs><marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#68808a"/></marker></defs><rect width="100%" height="100%" fill="#f6f8fa"/>`;
  for (const [i, e] of edges.entries()) {
    const a = map.get(e.from),
      b = map.get(e.to),
      x1 = a.x + 270,
      y1 = a.y + 45,
      x2 = b.x,
      y2 = b.y + 45,
      cycle = comp[e.from] === comp[e.to],
      transportCap = I[e.item].fluid
        ? state.transport.pipe
        : state.transport.belt,
      lanes = lineLanes(e.q, transportCap);
    let path = cycle
      ? `M${x1},${y1} C${x1 + 60},${y1} ${x1 + 60},${y2} ${x2 + 270},${y2}`
      : `M${x1},${y1} C${x1 + 55},${y1} ${x2 - 55},${y2} ${x2},${y2}`;
    svg += `<path d="${path}" fill="none" stroke="${highlight.edges.has(e) ? "#c52d20" : lanes > 1 ? "#bb7400" : cycle ? "#c66b4d" : "#91a7af"}" stroke-width="${highlight.edges.has(e) ? 3 : 1.6}" marker-end="url(#arr)"${cycle ? ' stroke-dasharray="5 3"' : ""}/><text x="${cycle ? x1 + 12 : (x1 + x2) / 2}" y="${(y1 + y2) / 2 - 7 + (i % 3) * 12}" font-size="10" fill="#42565c" text-anchor="middle" paint-order="stroke" stroke="#f6f8fa" stroke-width="3">${esc(I[e.item].name)} ${fmt(e.q)}${lanes > 1 ? " · " + lanes + "条并行" : ""}</text>`;
  }
  const colors = {
    external: ["#e8f4fc", "#77a5c0"],
    recipe: ["#eef6ee", "#85a589"],
    product: ["#fff1db", "#dca052"],
    surplus: ["#fff0ed", "#d69990"],
  };
  for (const n of nodes) {
    const [fill, stroke] = colors[n.type],
      label = n.label.length > 23 ? n.label.slice(0, 22) + "…" : n.label,
      sub =
        n.type === "recipe"
          ? B[R[n.id].b]?.name
          : n.type === "external"
            ? "外部供给"
            : n.type === "product"
              ? "最终产物"
              : "副产物 / 待外送",
      info = n.row ? machineLabel(n.row) : fmt(n.q) + " " + unit(n.item);
    svg += `<g ${graphPreview && n.id === "e:" + graphPreview.item ? `data-missing-node="${graphPreview.item}" role="button" tabindex="0" style="cursor:pointer"` : ""}><title>${esc(n.label + " · " + sub + " · " + info)}</title><rect x="${n.x}" y="${n.y}" width="270" height="105" rx="10" fill="${highlight.nodes.has(n.id) ? "#fff0e9" : fill}" stroke="${highlight.nodes.has(n.id) ? "#c52d20" : stroke}" stroke-width="${highlight.nodes.has(n.id) ? 3 : 1}"/>${ICONS[materialId(n.item)] ? `<image href="${ICONS[materialId(n.item)]}" x="${n.x + 10}" y="${n.y + 14}" width="35" height="35"/>` : ""}<text x="${n.x + 52}" y="${n.y + 28}" font-size="13" fill="#18262b">${esc(label)}</text><text x="${n.x + 52}" y="${n.y + 47}" font-size="11" fill="#50666e">${esc(sub)}</text><text x="${n.x + 12}" y="${n.y + 78}" font-size="11" fill="#20353e">${esc(info)}</text></g>`;
  }
  svg += "</svg>";
  $("network").innerHTML = svg;
  zoomGraph();
  const expanded = new Set();
  function branch(id, path = new Set(), edge = null) {
    const n = map.get(id);
    if (!n) return "";
    const label = `${esc(n.label)} ${edge ? "<small> · " + esc(I[edge.item].name) + " " + fmt(edge.q) + " " + unit(edge.item) + "</small>" : ""}`;
    if (path.has(id)) return `<div class="leaf">↻ 循环回路：${label}</div>`;
    if (expanded.has(id))
      return `<div class="leaf">↗ 共享工序：${label}（见已展开节点）</div>`;
    expanded.add(id);
    const incoming = edges.filter((e) => e.to === id);
    if (!incoming.length)
      return `<div class="leaf">${icon(n.item)} ${label} · 外供 ${fmt(n.q)} ${unit(n.item)}</div>`;
    const next = new Set(path);
    next.add(id);
    return `<details open><summary>${label}${n.row ? " · " + esc(machineLabel(n.row)) : ""}</summary>${incoming.map((e) => branch(e.from, next, e)).join("")}</details>`;
  }
  $("tree").innerHTML = nodes
    .filter((n) => n.type === "product" || n.type === "surplus")
    .map((n) => branch(n.id))
    .join("");
  dirtyGraph = false;
}
function zoomGraph() {
  const svg = $("network").querySelector("svg");
  if (!svg) return;
  const scale = +$("graphZoom").value / 100,
    v = svg.viewBox.baseVal;
  svg.style.width = v.width * scale + "px";
  svg.style.height = v.height * scale + "px";
}
function download(name, body, type = "application/json") {
  const url = URL.createObjectURL(new Blob([body], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function init() {
  loadWorkspace();
  $("dataMeta").textContent =
    `配方基于游戏 ${DATA.version} / Build ${DATA.build} 的原始Docs导出。${DATA.counts.machine}个机器配方（含${MACHINE.filter((k) => R[k].alt).length}个替代配方）、${DATA.counts.hand}个手工配方、${DATA.counts.build}个建筑配方、${DATA.counts.custom}个涂装配方，合计${Object.keys(R).length}项。`;
  $("catalogMeta").textContent = $("dataMeta").textContent;
  document.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const d = b.dataset;
    if (d.tab) switchTab(d.tab);
    if (d.open) openPicker(d.open);
    if (d.pick) addPicked(d.pick);
    if (d.delsupply) {
      state.supplies = state.supplies.filter((x) => x.id !== d.delsupply);
      if (state.selected[d.delsupply] === "")
        delete state.selected[d.delsupply];
      fitSupplies();
      renderAll();
    }
    if (d.delnode) {
      state.nodes = state.nodes.filter((x) => x.id !== +d.delnode);
      fitSupplies();
      renderAll();
    }
    if (d.delproduct) {
      state.products = state.products.filter((x) => x.id !== d.delproduct);
      renderAll();
    }
    if (d.pin) {
      const p = state.products.find((x) => x.id === d.pin);
      p.pin = !p.pin;
      renderProducts();
      save();
    }
    if (d.lock) {
      const p = state.products.find((x) => x.id === d.lock);
      p.lock = !p.lock;
      renderProducts();
      save();
    }
    if (d.maxproduct) {
      const p = state.products.find((x) => x.id === d.maxproduct);
      if (state.mode !== "reverse") {
        const m = allocationMax(p.id);
        if (m.unbounded) {
          setStatus("该产物不受所选输入限制，请直接填写目标产量。");
          return;
        }
        const report = changeQuantity(p.id, m.ok ? m.result.goal : 0);
        renderAll();
        showDiagnostic(
          report ||
            (!m.ok || m.result.goal < EPS
              ? diagnose(p.id, Math.max(1, p.q))
              : null),
        );
      } else renderResults();
    }
    if (d.showitem) {
      $("catalogDisplay").value = "recipes";
      $("catalogKind").value = "all";
      $("catalogSearch").value = I[d.showitem].name;
      catalogLimit = 40;
      renderCatalog();
    }
    if (d.userecipe) {
      const r = R[d.userecipe],
        id = Object.keys(r.outs)[0];
      if (!I[id]?.selectable) return;
      if (state.supplies.some((s) => s.id === id && s.stop)) {
        setStatus(
          "该物品已设为外供起点，请先取消“产线起点”再使用生产配方。",
          true,
        );
        return;
      }
      applyRecipe(id, d.userecipe);
      if (
        !state.products.some((p) => p.id === id) &&
        !state.supplies.some((s) => s.id === id) &&
        !state.nodes.some((n) => n.item === id)
      )
        state.products.push({ id, q: 0, lock: false, pin: false });
      renderAll();
      switchTab("planner");
    }
    if (d.delgen) {
      state.generators = state.generators.filter((g) => g.id !== +d.delgen);
      renderAll();
    }
  });
  document.addEventListener("change", (e) => {
    const d = e.target.dataset,
      value = e.target.value;
    if (d.supply) {
      state.supplies.find((x) => x.id === d.supply).q = amount(value);
      fitSupplies();
      renderAll();
    }
    if (d.stop) {
      state.supplies.find((x) => x.id === d.stop).stop = e.target.checked;
      fitSupplies();
      renderAll();
    }
    if (d.recipe !== undefined) {
      e.target.value = recipeFor(d.recipe) || "";
      openComparison(d.recipe, value);
    }
    if (d.quantity) {
      const report = changeQuantity(d.quantity, value);
      renderAll();
      if (report) showDiagnostic(report);
      else setStatus("产量已更新。");
    }
    if (d.node) {
      const i = state.nodes.findIndex((n) => n.id === +d.node);
      state.nodes[i] = normalizeNode({
        ...state.nodes[i],
        [d.field]: ["machine", "purity"].includes(d.field) ? value : +value,
      });
      const changed = state.nodes[i];
      if (changed.mapCore && d.field === "clock")
        for (const node of state.nodes)
          if (node.mapCore === changed.mapCore) node.clock = changed.clock;
      normalizeMappedGroups();
      fitSupplies();
      renderAll();
    }
    if (d.gen) {
      const g = state.generators.find((g) => g.id === +d.gen);
      g[d.field] =
        d.field === "clock"
          ? Math.max(1, Math.min(250, amount(value)))
          : d.field === "count"
            ? Math.floor(amount(value))
            : amount(value);
      if (d.field === "supply")
        for (const other of state.generators)
          if (other.fuel === g.fuel) other.supply = g.supply;
      renderAll();
    }
    if (d.slider) {
      dragging = false;
      renderProducts();
    }
  });
  document.addEventListener("input", (e) => {
    const id = e.target.dataset.slider;
    if (!id) return;
    dragging = true;
    const report = changeQuantity(id, e.target.value, true);
    for (const p of state.products) {
      const input = document.querySelector(`[data-quantity="${p.id}"]`);
      if (input) input.value = +p.q.toFixed(3);
      const slider = document.querySelector(`[data-slider="${p.id}"]`);
      if (slider && p.id !== id) slider.value = Math.round(p.q);
    }
    renderResults();
    if (report) showDiagnostic(report);
    else setStatus("已按整数产量调整。");
  });
  $("closePicker").onclick = () => $("picker").close();
  $("pickerSearch").oninput = renderPicker;
  $("picker").addEventListener("click", (e) => {
    if (e.target === $("picker")) {
      const r = $("picker").getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        $("picker").close();
    }
  });
  for (const id of ["catalogSearch", "catalogKind", "catalogDisplay"])
    $(id).addEventListener(id === "catalogSearch" ? "input" : "change", () => {
      catalogLimit = 40;
      renderCatalog();
    });
  $("catalogMore").onclick = () => {
    catalogLimit += 40;
    renderCatalog();
  };
  $("mode").onchange = (e) => {
    state.mode = e.target.value;
    if (state.mode === "constrained") fitSupplies();
    renderAll();
    setStatus(
      state.mode === "constrained"
        ? "单输入约束模式：仅限制所选物料，其他原料自动反推。"
        : state.mode === "reverse"
          ? "反推模式：直接填写产量，计算所需供给与全部上游机器。"
          : "供给模式：滑条受资源约束；不足时列出缺料。",
    );
  };
  for (const id of ["over", "strict", "event", "autoPin"])
    $(id).onchange = (e) => {
      state[id] = e.target.checked;
      if (id === "over")
        state.clock = Math.min(state.clock, state.over ? 250 : 100);
      fitSupplies();
      renderAll();
    };
  const clock = (e) => {
    state.clock = Math.max(
      1,
      Math.min(state.over ? 250 : 100, amount(e.target.value)),
    );
    controls();
    renderResults();
  };
  $("clock").oninput = clock;
  $("clockNum").onchange = clock;
  $("powerMult").onchange = (e) => {
    state.powerMult = normalizeMultiplier(e.target.value);
    renderAll();
  };
  $("sort").onchange = (e) => {
    state.sort = e.target.value;
    renderProducts();
    save();
  };
  $("applyReverse").onclick = () => {
    if (!current) return;
    state.supplies = reverseSupplyBudget(current);
    state.mode = "forward";
    renderAll();
    setStatus("已将反推需求设为供给预算；资源点供给已扣除，未重复计入。");
  };
  $("viewNetwork").onclick = () => {
    graphMode = "network";
    $("network").hidden = false;
    $("tree").hidden = true;
    $("graphControls").hidden = false;
    $("viewNetwork").classList.add("selected");
    $("viewTree").classList.remove("selected");
    renderGraph();
  };
  $("viewTree").onclick = () => {
    graphMode = "tree";
    $("network").hidden = true;
    $("tree").hidden = false;
    $("graphControls").hidden = true;
    $("viewTree").classList.add("selected");
    $("viewNetwork").classList.remove("selected");
    renderGraph();
  };
  $("graphZoom").oninput = zoomGraph;
  $("downloadGraph").onclick = () => {
    renderGraph();
    const svg = $("network").querySelector("svg");
    if (svg)
      download(
        "satisfactory-production-network.svg",
        svg.outerHTML,
        "image/svg+xml",
      );
  };
  $("export").onclick = () => exportSinglePlan();
  $("import").onclick = () => $("importFile").click();
  $("importFile").onchange = importWorkspaceFile;
  $("reset").onclick = () => {
    if (!confirm("清空当前供给、产物、资源点和机组？")) return;
    workshop.active = { name: "未命名方案", kind: "new", id: null };
    state = fresh();
    renderAll();
    setStatus("当前方案已清空，已保存方案和已有产线基准保留。");
  };
  $("exportBill").onclick = () => {
    const bill = constructionPlan();
    if (bill)
      download(
        "satisfactory-machine-materials.json",
        JSON.stringify(bill, null, 2),
      );
  };
  renderAll();
}

// Geothermal power is configured as a finite, supplemental grid source.
function normalizeGeothermal(value) {
  const out = {};
  for (const purity of ["impure", "normal", "pure"]) {
    const n = Number(value?.[purity]);
    out[purity] = Number.isFinite(n)
      ? Math.max(0, Math.min(10000, Math.floor(n)))
      : 0;
  }
  return out;
}
function geothermalPower(s = state) {
  const counts = normalizeGeothermal(s.geothermal);
  const multiplier = s.generationMult ?? 1;
  const average =
    (counts.impure * 100 + counts.normal * 200 + counts.pure * 400) *
    multiplier;
  return {
    average,
    minimum: average / 2,
    maximum: average * 1.5,
    count: Object.values(counts).reduce((a, b) => a + b, 0),
  };
}
function renderGeothermal() {
  const panel = $("geothermalPanel");
  if (!panel) return;
  state.geothermal = normalizeGeothermal(state.geothermal);
  for (const purity of ["impure", "normal", "pure"])
    $("geo-" + purity).value = state.geothermal[purity];
  const g = geothermalPower();
  $("geothermalStats").innerHTML =
    `<span class="chip">平均功率 <b>${fmt(g.average)} MW</b></span><span class="chip">最低功率 <b>${fmt(g.minimum)} MW</b></span><span class="chip">最高功率 <b>${fmt(g.maximum)} MW</b></span>`;
}
function initGeothermal() {
  const panel = document.createElement("details");
  panel.id = "geothermalPanel";
  panel.className = "stage";
  panel.innerHTML = `<summary>地热发电</summary><div class="formgrid">${[
    ["impure", "不纯", "50–150", 100],
    ["normal", "普通", "100–300", 200],
    ["pure", "高纯", "200–600", 400],
  ]
    .map(
      ([key, label, range, average]) =>
        `<label>${label} · 台<input id="geo-${key}" data-geothermal="${key}" type="number" min="0" max="10000" step="1" value="0"><small>标准平均 ${average} MW · 波动 ${range} MW</small></label>`,
    )
    .join(
      "",
    )}</div><div id="geothermalStats" class="chipline"></div>`;
  $("nodes").after(panel);
  panel.addEventListener("change", (event) => {
    const key = event.target.dataset.geothermal;
    if (!["impure", "normal", "pure"].includes(key)) return;
    state.geothermal = normalizeGeothermal({
      ...state.geothermal,
      [key]: event.target.value,
    });
    renderAll();
  });
}

function normalizeMultiplier(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(0.01, Math.min(100, n)) : 1;
}
const MULTIPLIER_FIELDS = [
  [
    "powerMult",
    "机器耗电倍率",
    "作用于生产机器、采矿机和抽水设备的平均与峰值耗电，不改变发电量。",
  ],
  [
    "generationMult",
    "发电量倍率",
    "只放大发电配方的 MW 输出；燃料、水和核废料仍按工序数量计算。",
  ],
  [
    "elevator",
    "太空电梯需求倍率",
    "作用于全部 5 个阶段的提交需求，向上取整；已提交量和库存保持原数值。",
  ],
  [
    "hub",
    "HUB 里程碑需求倍率",
    "作用于各层级里程碑的提交需求，与太空电梯独立。",
  ],
  [
    "costMult",
    "配方物品消耗倍率",
    "作用于全部生产及发电配方的输入，包括燃料、水和回流物料；不改变配方输出、建材或提交需求。",
  ],
];
function renderMultiplierSettings() {
  renderOptimizationSettings();
  renderMachineGroupProfiles();
  if ($("enableMachineGroups")) $("enableMachineGroups").checked = !!state.machineGroupsEnabled;
  for (const [key] of MULTIPLIER_FIELDS) {
    const el = $("setting-" + key);
    if (el)
      el.value = displayNumber(
        key === "elevator"
          ? state.progress.multiplier
          : key === "hub"
            ? state.progress.hubMultiplier
            : state[key]);
  }
  if ($("powerMult")) $("powerMult").value = displayNumber(state.powerMult);
}
function initMultiplierSettings() {
  const page = document.createElement("section");
  page.id = "settingsTab";
  page.hidden = true;
  page.innerHTML = `<div class="planner-heading"><div><h1>设置</h1></div><button id="resetMultipliers">全部恢复 1×</button></div><div class="panel"><h2>计算倍率</h2>${MULTIPLIER_FIELDS.map(([key, label, help]) => `<div class="multiplier-setting"><div><label for="setting-${key}"><b>${label}</b></label></div><div class="multiplier-value"><input id="setting-${key}" data-multiplier="${key}" type="number" min="0.01" max="100" step="any" value="1" aria-label="${label}"><span>×</span><button data-reset-multiplier="${key}">恢复 1×</button></div></div>`).join("")}</div>`;
  document.querySelector("main").append(page);
  const legacy = $("powerMult")?.closest("label");
  if (legacy) legacy.hidden = true;
  const apply = (key, value) => {
    const n = normalizeMultiplier(value);
    if (key === "elevator") state.progress.multiplier = n;
    else if (key === "hub") state.progress.hubMultiplier = n;
    else state[key] = n;
  };
  page.addEventListener("change", (e) => {
    const key = e.target.dataset.multiplier;
    if (!key) return;
    if (
      !e.target.value.trim() ||
      !Number.isFinite(+e.target.value) ||
      +e.target.value <= 0
    ) {
      renderMultiplierSettings();
      setStatus("请输入大于 0 的倍率，范围为 0.01–100×。", true);
      return;
    }
    apply(key, e.target.value);
    renderAll();
    setStatus("倍率已更新，计算结果与方案已保存。");
  });
  page.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "resetMultipliers")
      for (const [key] of MULTIPLIER_FIELDS) apply(key, 1);
    else if (b.dataset.resetMultiplier) apply(b.dataset.resetMultiplier, 1);
    else return;
    renderAll();
    setStatus("倍率已恢复。");
  });
  renderMultiplierSettings();
}

document.addEventListener("click", (event) => {
  const id = event.target.closest("[data-duplicate-product]")?.dataset
    .duplicateProduct;
  if (!id) return;
  const next = nextProductItem(id);
  if (!next) return;
  state.selected[next] = recipeFor(id);
  state.products.push({ id: next, q: 0, lock: false, pin: false });
  renderAll();
});
initGeothermal();
initMultiplierSettings();
init();
initEnhancements();
initProjects();
initWorldMap();
initProgress();
initInterface();
initProductionMind();
initPlannerFolds();

function refreshSingleOutput() {
  for (const p of state.products) {
    const el = $(`single-${p.id}`);
    if (!el) continue;
    const k = recipeFor(p.id),
      r = R[k];
    if (!r || r.kind !== "machine") {
      el.textContent = "单台机器产出：未选择机器配方";
      continue;
    }
    if (state.machineGroupsEnabled && state.machineGroups?.[k]) {
      const ids = groupedRecipes(k), total = ids.reduce((sum, key) => sum + (rates(key).outs[materialId(p.id)] || 0) * machineGroup(key).count * machineClock(key) / 100, 0);
      el.textContent = '已配置 ' + ids.length + ' 组机器 · 满负荷产出 ' + fmt(total) + ' ' + unit(p.id) + ' · 请在机器明细查看各组';
      continue;
    }
    const base = rates(k).outs[materialId(p.id)] || 0,
      cap = machineClock(k) / 100,
      row = current?.rows.find((x) => x.k === k);
    let text = `单台${B[r.b]?.name || "机器"}产出：100% 时 ${fmt(base)} ${unit(p.id)}`;
    if (Math.abs(cap - 1) > EPS)
      text += ` · 设定 ${fmt(cap * 100)}% 时 ${fmt(base * cap)} ${unit(p.id)}`;
    if (row?.tail)
      text += ` · 末台 ${fmt(row.tail * 100)}% 时 ${fmt(base * row.tail)} ${unit(p.id)}${row.duty < 1 - EPS ? "（间歇运行，平均 " + fmt(base * row.tail * row.duty) + " " + unit(p.id) + "）" : ""}`;
    el.textContent = text;
  }
}

initRail();

function migrateMainPower(s, x) {
  s.legacyGenerators = x.legacyGenerators || [];
  if (!s.generators.length) return;
  s.legacyGenerators = s.generators.map((g) => ({ ...g }));
  const calc = generatorCalculation(s),
    waste = {};
  for (const r of calc.rows) {
    const w = generatorWasteRow(r);
    if (w) waste[w.id] = (waste[w.id] || 0) + w.q;
  }
  if (calc.gross > 0) {
    const id = "Workbench_Electricity";
    if (!s.products.some((p) => p.id === id))
      s.products.push({ id, q: calc.gross, lock: false, pin: false });
    const first = s.generators.find((g) => R["Power_" + g.fuel]);
    if (first) s.selected[id] = "Power_" + first.fuel;
    for (const [id, q] of Object.entries(waste))
      if (
        q > 0 &&
        !hasProductMaterial(id, s) &&
        !s.supplies.some((p) => p.id === id)
      )
        s.products.push({ id, q, lock: false, pin: false });
  }
  s.generators = [];
}

initInputConstraint();

initPowerAllocation();

initAmplification();
initMachineClocks();

initMachineSupply();

// Offline Chinese/English UI. Plans retain item/recipe IDs and user-entered text.
const EN_UI = globalThis.__factoryBundle.translations;
Object.assign(EN_UI, {
  "机器分组": "Machine groups", "机器分组配置": "Machine group configuration", "启用机器分组配置": "Enable machine group configuration", "编辑分组": "Edit groups", "编辑同配方分组": "Edit groups for this recipe", "运行方式": "Operating mode", "按需求运行：台数作为上限": "On demand: counts are capacity limits", "固定全开：严格按各组配置运行": "Fixed: run all configured machines", "分组": "Group", "台数": "Machines", "频率 %": "Clock %", "每台晶体数": "Somersloops per machine", "＋ 添加一组": "+ Add group", "应用分组配置": "Apply groups", "恢复统一配置": "Restore uniform configuration", "分组计算规则": "Group calculation rules",
  "允许同一配方按不同台数、频率和晶体数分组。关闭后保留分组数据，计算恢复统一配置；重新开启后继续使用。固定全开模式可能产生额外产物或供给不足，切换后请检查配平。": "Group one recipe by machine count, clock and Somersloops. Disabling preserves groups and uses uniform settings. Fixed groups may cause surplus or shortages; check the balance after switching.",
  "开启后，在机器清单点击“机器分组配置”添加。分组配置可在此集中管理。": "Enable groups, then use Machine group configuration in the machine list. Manage existing groups here.",
  "各组分别计算：输入随运行台数和频率线性变化；产出再乘以该组晶体倍率；耗电按该组频率指数与晶体倍率平方计算，然后逐组求和。": "Calculate each group separately: inputs scale with active machine count and clock; outputs also scale with its amplification. Power uses the clock exponent and squared amplification, then sums across groups.",
  "按需求运行允许停机和末台降频，台数是各组容量上限；安装的机器和晶体仍按完整配置统计。固定全开会将当前启用配方的全部分组按设定运行，可能产生余量，供给不足时不会悄悄改变分组。": "On-demand mode may idle machines or downclock the last machine within each group's capacity. Installed machines and Somersloops remain counted. Fixed mode runs all configured groups, may create surplus and does not silently change groups when supplies are insufficient.",
  "同配方分组共享产物和原料池，可共同供应最终产物及其他上游需求。分组设置优先于统一晶体数和本类频率；关闭超频时实际频率不超过 100%，原值保留。发电机的晶体槽位为 0。": "Groups share material pools and can serve final targets and other processes. Group settings override uniform Somersloops and type clocks. Disabling overclocking caps effective clocks at 100% without erasing settings. Generators have no Somersloop slots."
});
Object.assign(EN_UI, {
  "外部电力 / MW": "Imported power / MW",
  "从其他方案导入供给": "Import supplies from another plan", "产物 → 当前供给": "Outputs → Current supplies", "产物接入当前供给": "Use another plan's outputs as supplies", "源方案": "Source plan", "已有供给处理": "Existing supplies", "替换同物品供给，避免重复计入": "Replace matching supplies to avoid double counting", "叠加到现有供给": "Add to existing supplies", "读取其他方案 JSON": "Read another plan's JSON", "接入当前供给": "Import as supplies", "选择": "Select", "产物 / 单位": "Product / Unit", "源方案可外供 / 分": "Source export capacity / min", "当前外供 / 分": "Current supply / min", "本次接入 / 分": "Amount to import / min", "导入后外供 / 分": "Supply after import / min", "与当前最终产物冲突": "Conflicts with a current target", "没有其他已保存方案，可读取 JSON": "No other saved plans; load a JSON file", "请先保存另一份方案，或读取导出的 JSON 配置。": "Save another plan first, or read an exported JSON configuration.", "源方案不可行，无法确认可外供产量。请先修正源方案。": "The source plan is infeasible. Fix it before importing its export capacity.", "以下为源方案的规划外供量，尚不代表已建成或已接通运输；电力按平均净余电计算。": "These are planned exports, not proof of completed construction or transport. Electricity uses average net surplus.", "源方案没有可接入的最终产物或净余电。": "The source plan has no final outputs or net power surplus to import.", "接入量需在 0 与源方案可外供量之间。": "Import an amount between zero and the source's export capacity.", "导入为当前方案的外供起点，截断对应上游生产。当前最终产物不会自动删除。同物品的多张产物卡片合并为总量。": "Imported items become external supply boundaries. Existing targets are not deleted. Multiple target cards for the same material are combined.", "这是独立快照，不会从源方案扣减，也不会自动跟随源方案更新。若供给多个接收方案，请自行分配总量，避免重复分配。不会导入供货工厂的机器、原矿或耗电。": "This is an independent snapshot: it neither deducts from nor follows changes to the source plan. Allocate capacity across recipients to avoid double allocation. Source machines, raw inputs and power consumption are not imported."
});
Object.assign(EN_UI, {
  "↶ 撤销": "↶ Undo", "↷ 重做": "↷ Redo", "撤销（Ctrl+Z / ⌘Z）": "Undo (Ctrl+Z / ⌘Z)", "重做（Ctrl+Y / Ctrl+Shift+Z / ⌘Shift+Z）": "Redo (Ctrl+Y / Ctrl+Shift+Z / ⌘Shift+Z)",
  "已重做，产线已重新计算。": "Redone. The production plan has been recalculated.", "已撤销，产线已重新计算。": "Undone. The production plan has been recalculated."
});
Object.assign(EN_UI, {
  添加同物品的独立产物卡片: "Add another independent target for this item",
  "支持中文、英文、全拼和首字母。同一物品可重复添加为独立产物卡片，分别选择配方。":
    "Search in Chinese, English or pinyin. Add the same item repeatedly as independent targets with separate recipes.",
});
Object.assign(EN_UI, {
  当前配方详情: "Current recipe details",
  候选配方详情: "Candidate recipe details",
  "单台机器 · 100% 频率": "One machine · 100% clock",
  输入材料: "Inputs",
  输出产物: "Outputs",
  "该物料从外部供给取得，不配置生产机器。":
    "This item is supplied externally; no production machine is configured.",
  "配方详情按单台 100% 频率显示，计入当前消耗／发电倍率及该配方的索莫晶体设置；下方为固定目标产量的整条产线对比。":
    "Recipe details show one machine at 100% clock, including current consumption/generation multipliers and Somersloops for that recipe. The tables below compare the full production chain at fixed target rates.",
});
Object.assign(EN_UI, {
  副产物: "Byproduct",
  "产生 / 分": "Produced / min",
  "内部回用 / 分": "Reused internally / min",
  "最终产物 / 分": "Final targets / min",
  "待处理 / 分": "Unhandled / min",
  "启动供给能力 / 分": "Startup input capacity / min",
  "稳态外供 / 分": "Steady external input / min",
  "回用后可减少 / 分": "Reduction after reuse / min",
  需预充或临时外供: "Preload or temporary supply needed",
  "按当前已选配方自动配平并优先分配副产物；连接图显示回用去向，剩余量仍需外送或处理。":
    "The plan balances the selected recipes and allocates byproducts first. Follow reuse paths in the graph; remaining output needs export or disposal.",
  "当前方案没有产生需要回用的副产物。":
    "This plan produces no byproducts requiring reuse.",
  "启动供给能力是假设按当前目标负荷运行、但副产物尚未回到用料端时的保守输入速率，不是一次性预充库存。若该物料没有外部来源，需先预充、临时接入供给或分段启动。回流持续到达、用料机器不停机且缓冲库存不再下降后，再降至稳态外供量。":
    "Startup capacity is a conservative input rate at the target load before byproducts reach consumers, not a one-time preload quantity. Without an external source, preload, temporary supply or staged startup is needed. Reduce to the steady input rate once recycling is continuous, consumers run without interruption and buffer stock stops falling.",
  "无法仅凭稳态配方确定几分钟后降频；还取决于首轮生产、运输时间、管道和储罐填充，以及实际回流接法。这里不会自动改写你的外部供给上限。":
    "Steady-state recipes alone cannot determine when to reduce the clock. Startup cycles, transport, pipe and tank filling, and actual routing also matter. External supply limits are not changed automatically.",
});
Object.assign(EN_UI, {
  地热发电: "Geothermal power",
  "总平均发电 / MW": "Total average generation / MW",
  "地热平均 / MW": "Geothermal average / MW",
  平均功率: "Average power",
  最低功率: "Minimum power",
  最高功率: "Maximum power",
  "不纯 · 台": "Impure · Generators",
  "普通 · 台": "Normal · Generators",
  "高纯 · 台": "Pure · Generators",
  地热发电数据来源: "Geothermal data source",
  "填写已接入电网的地热机组数量。无需燃料和水，不参与超频或索莫晶体配置；受发电量倍率影响。":
    "Enter the number of geothermal generators connected to your grid. They use no fuel or water, have no clock or Somersloop settings, and follow the generation multiplier.",
  "平均值不保证任意时刻都可用。储电设备可缓冲波动；保守供电预算请参考最低功率。此处为额外并网电源，不替代产物卡片指定的燃料发电量，勿重复作为外部电力供给录入。":
    "Average output is not guaranteed at every instant. Power Storage can buffer fluctuations; use minimum output for a conservative budget. This is supplemental generation and does not replace fuel-specific electricity targets. Do not enter it again as an external electricity supply.",
  "标准平均 100 MW · 波动 50–150 MW": "Base average 100 MW · Range 50–150 MW",
  "标准平均 200 MW · 波动 100–300 MW": "Base average 200 MW · Range 100–300 MW",
  "标准平均 400 MW · 波动 200–600 MW": "Base average 400 MW · Range 200–600 MW",
});
Object.assign(EN_UI, {
  "物料需求与产出 / 分": "Material inputs and outputs / min",
  "输入材料 · 本组总需求": "Inputs · Total for this group",
  输出产物: "Outputs",
});
Object.assign(EN_UI, {
  设置: "Settings",
  计算倍率: "Calculation multipliers",
  机器耗电倍率: "Power consumption multiplier",
  发电量倍率: "Power generation multiplier",
  太空电梯需求倍率: "Space Elevator requirement multiplier",
  "HUB 里程碑需求倍率": "HUB milestone requirement multiplier",
  配方物品消耗倍率: "Recipe input consumption multiplier",
  "全部恢复 1×": "Reset all to 1×",
  "恢复 1×": "Reset to 1×",
  "当前方案的计算倍率 · 自动保存并随配置导出":
    "Multipliers for this plan · Saved automatically and included in exports",
  "作用于生产机器、采矿机和抽水设备的平均与峰值耗电，不改变发电量。":
    "Scales average and peak consumption of production and extraction machines.",
  "只放大发电配方的 MW 输出；燃料、水和核废料仍按工序数量计算。":
    "Scales generator MW output. Fuel, water and nuclear waste follow the number of recipe cycles.",
  "作用于全部 5 个阶段的提交需求，向上取整；已提交量和库存保持原数值。":
    "Scales requirements for all five phases, rounded up. Delivered amounts and stock are preserved.",
  "作用于各层级里程碑的提交需求，与太空电梯独立。":
    "Scales HUB milestone requirements independently of the Space Elevator.",
  "作用于全部生产及发电配方的输入，包括燃料、水和回流物料；不改变配方输出、建材或提交需求。":
    "Scales all production and generator inputs, including fuel, water and recycled materials. Outputs, construction costs and milestone requirements are unchanged.",
  "支持 0.01–100×。1× 为标准规则，2× 为两倍，0.5× 为一半。修改后重新计算，目标产量保持不变；供给不足会显示缺口。":
    "Range: 0.01–100×. 1× is standard, 2× doubles, 0.5× halves. Targets stay fixed; supply shortages are reported.",
  "更改阶段倍率后，已有产物目标不会自动覆盖；请在阶段物资页面重新加入规划。消耗倍率低于 1× 时，循环配方可能产生额外余量，请核对回流平衡。":
    "After changing milestone multipliers, add targets again from the progress page. Input multipliers below 1× may produce extra surplus in recycling loops.",
});
const languageKey = "factory-workbench-language-1";
let appLanguage = "zh",
  languageObserver = null;
const originalNames = new Map(
  [
    ...Object.values(I),
    ...Object.values(R),
    ...Object.values(B),
    ...PROGRESSION.milestones,
    ...PROGRESSION.phases,
  ].map((o) => [o, o.name]),
);
const languageTextMemory = new WeakMap(),
  languageAttributeMemory = new WeakMap();
for (const [o, zh] of originalNames)
  if (o.en && /[\u3400-\u9fff]/.test(zh) && !EN_UI[zh]) EN_UI[zh] = o.en;
const languagePattern = new RegExp(
  Object.keys(EN_UI)
    .filter((k) => k.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|"),
  "g",
);
function englishText(value) {
  const source = String(value);
  if (!/[\u3400-\u9fff]/.test(source)) return source;
  const trimmed = source.trim();
  const stage = trimmed.match(/^第 (\d+) 级 · 上游 → 下游$/);
  if (stage)
    return source.replace(
      trimmed,
      "Stage " + stage[1] + " · Upstream → downstream",
    );
  if (trimmed === "循环回流") return source.replace(trimmed, "Recycling loop");
  const meta = source.match(
    /^配方基于游戏 (.+?) \/ Build (.+?) 的原始Docs导出。(\d+)个机器配方（含(\d+)个替代配方）、(\d+)个手工配方、(\d+)个建筑配方、(\d+)个涂装配方，合计(\d+)项。$/,
  );
  if (meta)
    return `Game ${meta[1]} / Build ${meta[2]} Docs: ${meta[3]} machine recipes (${meta[4]} alternate), ${meta[5]} handcrafting, ${meta[6]} building and ${meta[7]} customization recipes; ${meta[8]} total.`;
  if (Object.hasOwn(EN_UI, trimmed))
    return source.replace(trimmed, EN_UI[trimmed]);
  return source
    .replace(languagePattern, (m) => EN_UI[m])
    .replace(/([\d,.]+)\s*台/g, "$1 machines")
    .replace(/([\d,.]+)\s*件/g, "$1 items")
    .replace(/([\d,.]+)\s*秒/g, "$1 sec")
    .replace(/([\d,.]+)\s*项/g, "$1 entries")
    .replace(/([\d,.]+)\s*个/g, "$1")
    .replace(/([\d,.]+)\s*条/g, "$1 ")
    .replace(/([\d,.]+)\s*处/g, "$1 ")
    .replace(/(\d)层/g, "$1 levels")
    .replace(/(\d)级/g, "Mk.$1")
    .replace(/\/分/g, "/min")
    .replace(/：/g, ": ")
    .replace(/，/g, ", ")
    .replace(/；/g, "; ")
    .replace(/。/g, ". ")
    .replace(/（/g, " (")
    .replace(/）/g, ")");
}
function localizeTree(root = document.body) {
  if (!root) return;
  const blocked = (node) =>
    node.parentElement?.closest("script,style,textarea,[data-no-translate]");
  const texts = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = texts.nextNode())) {
    if (blocked(n)) continue;
    const old = languageTextMemory.get(n);
    let source = old && n.data === old.output ? old.source : n.data;
    const output = appLanguage === "en" ? englishText(source) : source;
    if (n.data !== output) n.data = output;
    languageTextMemory.set(n, { source, output });
  }
  const elements =
    root.nodeType === Node.ELEMENT_NODE
      ? [root, ...root.querySelectorAll("[placeholder],[title],[aria-label]")]
      : [...root.querySelectorAll("[placeholder],[title],[aria-label]")];
  for (const el of elements) {
    if (el.closest("[data-no-translate]")) continue;
    let map = languageAttributeMemory.get(el);
    if (!map) {
      map = {};
      languageAttributeMemory.set(el, map);
    }
    for (const attr of ["placeholder", "title", "aria-label"])
      if (el.hasAttribute(attr)) {
        const value = el.getAttribute(attr),
          old = map[attr],
          source = old && value === old.output ? old.source : value,
          output = appLanguage === "en" ? englishText(source) : source;
        if (value !== output) el.setAttribute(attr, output);
        map[attr] = { source, output };
      }
  }
}
function setAppLanguage(lang, persist = true) {
  appLanguage = lang === "en" ? "en" : "zh";
  languageObserver?.disconnect();
  for (const [o, zh] of originalNames)
    o.name = appLanguage === "en" ? o.en || englishText(zh) : zh;
  document.documentElement.lang = appLanguage === "en" ? "en" : "zh-CN";
  document.title =
    appLanguage === "en"
      ? "Satisfactory 1.2 · Factory Workbench"
      : "幸福工厂 1.2 · 产线工作台";
  $("languageToggle").textContent = appLanguage === "en" ? "中文" : "English";
  $("languageToggle").setAttribute(
    "aria-label",
    appLanguage === "en" ? "切换到中文" : "Switch to English",
  );
  try {
    if (persist) localStorage.setItem(languageKey, appLanguage);
  } catch {}
  renderAll();
  if (interfaceState.active === "home") renderHome();
  if (interfaceState.active === "catalog") renderCatalog();
  if (interfaceState.active === "rail") renderRail();
  if (interfaceState.active === "workspace") renderWorkspace();
  if (interfaceState.active === "progress") renderProgress();
  if (interfaceState.active === "worldmap") requestMapDraw();
  localizeTree();
  languageObserver?.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label"],
  });
}
function initLanguage() {
  let pending = false;
  languageObserver = new MutationObserver((records) => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      languageObserver.disconnect();
      localizeTree();
      languageObserver.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["placeholder", "title", "aria-label"],
      });
    });
  });
  const button = document.createElement("button");
  button.id = "languageToggle";
  button.dataset.noTranslate = "";
  button.onclick = () => setAppLanguage(appLanguage === "zh" ? "en" : "zh");
  $("fullscreenToggle").before(button);
  for (const name of ["confirm", "alert"]) {
    const original = window[name].bind(window);
    window[name] = (message) =>
      original(appLanguage === "en" ? englishText(message) : message);
  }
  const nativeFill = CanvasRenderingContext2D.prototype.fillText,
    nativeMeasure = CanvasRenderingContext2D.prototype.measureText;
  CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
    return nativeFill.call(
      this,
      appLanguage === "en" ? englishText(text) : text,
      ...args,
    );
  };
  CanvasRenderingContext2D.prototype.measureText = function (text) {
    return nativeMeasure.call(
      this,
      appLanguage === "en" ? englishText(text) : text,
    );
  };
  const originalDownload = download;
  download = (name, body, type) => {
    if (appLanguage === "en" && type === "image/svg+xml") {
      const svg = new DOMParser().parseFromString(body, "image/svg+xml");
      localizeTree(svg.documentElement);
      body = new XMLSerializer().serializeToString(svg.documentElement);
    }
    originalDownload(name, body, type);
  };
  let saved = "zh";
  try {
    saved = localStorage.getItem(languageKey) || "zh";
  } catch {}
  setAppLanguage(saved, false);
}
initLanguage();

let graphExpanded = false,
  graphExpandSnapshot = null;
function fitExpandedGraph() {
  if (graphMode === "mind") {
    fitProductionBoard();
    return;
  }
  if (graphMode === "network") {
    const svg = $("network").querySelector("svg");
    if (!svg) return;
    const box = $("network"),
      vb = svg.viewBox.baseVal;
    $("graphZoom").value = Math.max(
      30,
      Math.min(
        150,
        Math.floor(
          Math.min(box.clientWidth / vb.width, box.clientHeight / vb.height) *
            95,
        ),
      ),
    );
    zoomGraph();
    box.scrollTo(0, 0);
  }
}
function updateGraphExpanded() {
  const panel = $("graphTab");
  panel.classList.toggle("graph-expanded", graphExpanded);
  document.body.classList.toggle("graph-expanded-open", graphExpanded);
  $("graphFullscreen").textContent = graphExpanded ? "退出全屏" : "全屏画布";
  $("graphFullscreen").setAttribute("aria-pressed", String(graphExpanded));
  $("graphFullscreen").setAttribute(
    "aria-label",
    graphExpanded ? "退出产线图全屏" : "全屏查看产线连接图",
  );
  if (typeof localizeTree === "function") localizeTree(panel);
}
function exitGraphFullscreen() {
  if (!graphExpanded) return;
  graphExpanded = false;
  const snapshot = graphExpandSnapshot;
  graphExpandSnapshot = null;
  $("graphTab").classList.remove("graph-detail-open");
  $("graphDetails").textContent = "显示节点明细";
  $("graphDetails").setAttribute("aria-pressed", "false");
  updateGraphExpanded();
  if (document.fullscreenElement === $("graphTab"))
    document.exitFullscreen().catch(() => {});
  if (snapshot) {
    $("mindZoom").value = snapshot.mind;
    $("graphZoom").value = snapshot.network;
    zoomProductionMind();
    zoomGraph();
    requestAnimationFrame(() => {
      window.scrollTo(snapshot.x, snapshot.y);
      $("graphFullscreen").focus({ preventScroll: true });
    });
  }
}
async function toggleGraphFullscreen() {
  if (graphExpanded) {
    exitGraphFullscreen();
    return;
  }
  graphExpandSnapshot = {
    mind: $("mindZoom").value,
    network: $("graphZoom").value,
    x: scrollX,
    y: scrollY,
  };
  graphExpanded = true;
  updateGraphExpanded();
  requestAnimationFrame(() => requestAnimationFrame(fitExpandedGraph));
  try {
    if (!document.fullscreenElement && $("graphTab").requestFullscreen)
      await $("graphTab").requestFullscreen();
  } catch {}
  if (graphExpanded) requestAnimationFrame(fitExpandedGraph);
}
function initGraphFullscreen() {
  $("graphFullscreen").onclick = toggleGraphFullscreen;
  $("graphFit").onclick = fitExpandedGraph;
  $("graphDetails").onclick = () => {
    const panel = $("graphTab"),
      shown = panel.classList.toggle("graph-detail-open");
    $("graphDetails").setAttribute("aria-pressed", String(shown));
    $("graphDetails").textContent = shown ? "隐藏节点明细" : "显示节点明细";
    if (typeof localizeTree === "function") localizeTree(panel);
  };
  document.addEventListener("fullscreenchange", () => {
    if (graphExpanded && !document.fullscreenElement) exitGraphFullscreen();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && graphExpanded) {
      e.preventDefault();
      exitGraphFullscreen();
    }
  });
  const originalSwitch = switchTab;
  switchTab = (tab) => {
    if (graphExpanded && tab !== "graph") exitGraphFullscreen();
    originalSwitch(tab);
  };
}

initGraphFullscreen();

function trimUndoStack(stack) {
  while (stack.length > 50) stack.shift();
  let size = stack.reduce((total, snapshot) => total + snapshot.length, 0);
  while (stack.length > 1 && size > 6 * 1024 * 1024) size -= stack.shift().length;
}
function updateUndoButtons() {
  const undo = $("undoAction"), redo = $("redoAction");
  if (undo) { undo.disabled = !undoStack.length; undo.setAttribute("aria-disabled", String(undo.disabled)); }
  if (redo) { redo.disabled = !redoStack.length; redo.setAttribute("aria-disabled", String(redo.disabled)); }
}
function recordUndoHistory() {
  if (!undoReady || undoApplying) return;
  const next = JSON.stringify(workspacePayload());
  if (next === undoCurrent) return;
  const now = Date.now();
  const merge = undoEventGroup && undoEventGroup === undoPreviousGroup && now - undoPreviousTime < 1200;
  if (!merge) undoStack.push(undoCurrent);
  trimUndoStack(undoStack);
  redoStack = [];
  undoCurrent = next;
  undoPreviousGroup = undoEventGroup;
  undoPreviousTime = now;
  updateUndoButtons();
}
function restoreUndoHistory(direction) {
  if (!undoReady || undoApplying) return;
  recordUndoHistory();
  const source = direction === "redo" ? redoStack : undoStack;
  const destination = direction === "redo" ? undoStack : redoStack;
  if (!source.length) return;
  const snapshot = source[source.length - 1];
  // Validate before changing either history stack or the active workspace.
  let restored;
  try { restored = normalizeWorkspace(JSON.parse(snapshot)); }
  catch (error) { setStatus("无法恢复该历史记录：" + error.message, true); return; }
  source.pop();
  destination.push(undoCurrent);
  trimUndoStack(destination);
  undoApplying = true;
  try {
    workshop = restored.w;
    state = restored.s;
    workspaceReady = true;
    graphPreview = null;
    diagnostic = null;
    comparison = null;
    machineSupplyUndo = null;
    for (const id of ["picker", "compareDialog", "missingDialog", "progressDialog", "mapPinDialog", "supplyTransferDialog", "machineGroupsDialog"]) {
      const dialog = $(id); if (dialog?.open) dialog.close();
    }
    renderAll();
    undoCurrent = JSON.stringify(workspacePayload());
    undoPreviousGroup = '';
    undoEventGroup = '';
    setStatus(direction === "redo" ? "已重做，产线已重新计算。" : "已撤销，产线已重新计算。");
  } finally { undoApplying = false; updateUndoButtons(); }
}
function isNativeUndoField(target) {
  if (!(target instanceof Element)) return false;
  if (target.isContentEditable || target.closest('textarea,[contenteditable="true"],[contenteditable=""]')) return true;
  const input = target.closest('input');
  return !!input && !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'hidden', 'file', 'color'].includes(input.type);
}
function initUndoRedo() {
  const undo = document.createElement('button');
  undo.id = 'undoAction'; undo.textContent = '↶ 撤销'; undo.title = '撤销（Ctrl+Z / ⌘Z）';
  undo.setAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
  const redo = document.createElement('button');
  redo.id = 'redoAction'; redo.textContent = '↷ 重做'; redo.title = '重做（Ctrl+Y / Ctrl+Shift+Z / ⌘Shift+Z）';
  redo.setAttribute('aria-keyshortcuts', 'Control+Y Control+Shift+Z Meta+Shift+Z');
  $('export').before(undo, redo);
  undo.onclick = () => restoreUndoHistory('undo');
  redo.onclick = () => restoreUndoHistory('redo');
  document.addEventListener('input', event => {
    const target = event.target;
    undoEventGroup = target.dataset.slider ? 'slider:' + target.dataset.slider : 'input:' + (target.id || JSON.stringify(target.dataset));
    queueMicrotask(() => { undoEventGroup = ''; });
  }, true);
  document.addEventListener('change', event => {
    const target = event.target;
    undoEventGroup = target.dataset.slider ? 'slider:' + target.dataset.slider : 'input:' + (target.id || JSON.stringify(target.dataset));
    queueMicrotask(() => { undoEventGroup = ''; undoPreviousGroup = ''; });
  }, true);
  document.addEventListener('pointerdown', () => { undoPreviousGroup = ''; }, true);
  document.addEventListener('focusout', () => { undoPreviousGroup = ''; }, true);
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey) || isNativeUndoField(event.target)) return;
    const key = event.key.toLowerCase();
    const direction = key === 'z' ? (event.shiftKey ? 'redo' : 'undo') : key === 'y' && !event.shiftKey ? 'redo' : null;
    if (!direction) return;
    event.preventDefault();
    restoreUndoHistory(direction);
  });
  undoCurrent = JSON.stringify(workspacePayload());
  undoReady = true;
  updateUndoButtons();
}
initUndoRedo();

let importedSupplySources = [], supplyTransferSources = [], supplyTransferRows = [];
function supplySourceProducts(sourceState) {
  const amounts = canonicalDemands(demands(sourceState));
  delete amounts.Workbench_Electricity;
  const plan = summarize(planSolve(demands(sourceState), sourceState, { mode: sourceState.mode }), sourceState);
  // Electricity can be exported only after this plan's own average demand.
  if (plan) {
    const net = Math.max(0, plan.generation + (plan.importedPower || 0) - plan.power - (sourceState.extraLoad || 0));
    if (net > EPS) amounts.Workbench_Electricity = net;
  }
  return { plan, rows: Object.entries(amounts).filter(([id, q]) => I[id]?.selectable && q > EPS).map(([id, q]) => ({ id, q })) };
}
function renderSupplyTransferSources(preferred) {
  supplyTransferSources = workshop.plans.filter(p => p.id !== workshop.active.id).map(p => ({ key: 'plan:' + p.id, name: p.name, state: p.state }));
  if (workshop.existing) supplyTransferSources.push({ key: 'baseline', name: workshop.existing.name + ' · 基准', state: workshop.existing.state });
  supplyTransferSources.push(...importedSupplySources);
  const select = $('supplyTransferSource');
  select.innerHTML = supplyTransferSources.length ? supplyTransferSources.map(p => `<option value="${esc(p.key)}">${esc(p.name)}</option>`).join('') : '<option value="">没有其他已保存方案，可读取 JSON</option>';
  if (supplyTransferSources.some(p => p.key === preferred)) select.value = preferred;
  renderSupplyTransferRows();
}
function renderSupplyTransferRows() {
  const source = supplyTransferSources.find(p => p.key === $('supplyTransferSource').value);
  supplyTransferRows = [];
  $('applySupplyTransfer').disabled = true;
  if (!source) { $('supplyTransferRows').innerHTML = '<p>请先保存另一份方案，或读取导出的 JSON 配置。</p>'; return; }
  const evaluated = supplySourceProducts(source.state);
  if (!evaluated.plan) { $('supplyTransferRows').innerHTML = '<p class="over">源方案不可行，无法确认可外供产量。请先修正源方案。</p>'; return; }
  supplyTransferRows = evaluated.rows;
  $('supplyTransferRows').innerHTML = `<div class="tablewrap"><table><thead><tr><th>选择</th><th>产物 / 单位</th><th>源方案可外供 / 分</th><th>当前外供 / 分</th><th>本次接入 / 分</th><th>导入后外供 / 分</th></tr></thead><tbody>${supplyTransferRows.map(row => {
    const conflict = hasProductMaterial(row.id), old = state.supplies.find(x => x.id === row.id)?.q || 0;
    return `<tr><td><input type="checkbox" data-transfer-check="${esc(row.id)}" ${conflict ? 'disabled' : 'checked'}></td><td>${esc(I[row.id].name)} <small>${unit(row.id)}</small>${conflict ? '<div class="over small">与当前最终产物冲突</div>' : ''}</td><td>${fmt(row.q)}</td><td>${fmt(old)}</td><td><input data-transfer-quantity="${esc(row.id)}" type="number" min="0" max="${row.q}" step="any" value="${displayNumber(cleanComputedQuantity(row.q))}" ${conflict ? 'disabled' : ''} style="width:120px"></td><td data-transfer-preview="${esc(row.id)}">—</td></tr>`;
  }).join('')}</tbody></table></div>${supplyTransferRows.length ? '' : '<p>源方案没有可接入的最终产物或净余电。</p>'}`;
  updateSupplyTransferPreview();
}
function updateSupplyTransferPreview() {
  const add = $('supplyTransferMode').value === 'add';
  let selected = false;
  for (const row of supplyTransferRows) {
    const check = document.querySelector(`[data-transfer-check="${row.id}"]`), input = document.querySelector(`[data-transfer-quantity="${row.id}"]`), preview = document.querySelector(`[data-transfer-preview="${row.id}"]`);
    if (!check || !input || !preview) continue;
    const q = Math.max(0, Math.min(row.q, Number(input.value) || 0)), old = state.supplies.find(x => x.id === row.id)?.q || 0;
    const chosen = check.checked && !check.disabled;
    preview.textContent = fmt(chosen ? (add ? old : 0) + q : old);
    selected ||= chosen && q > EPS;
  }
  $('applySupplyTransfer').disabled = !selected;
}
function openSupplyTransfer(key) {
  $('supplyTransferMode').value = 'replace';
  $('supplyTransferMessage').textContent = '';
  renderSupplyTransferSources(key);
  $('supplyTransferDialog').showModal();
}
function applySupplyTransfer() {
  const source = supplyTransferSources.find(p => p.key === $('supplyTransferSource').value);
  if (!source) return;
  const additions = [];
  for (const row of supplyTransferRows) {
    const check = document.querySelector(`[data-transfer-check="${row.id}"]`);
    if (!check?.checked || check.disabled || hasProductMaterial(row.id)) continue;
    const input = document.querySelector(`[data-transfer-quantity="${row.id}"]`), value = Number(input?.value);
    if (!input?.value.trim() || !Number.isFinite(value) || value < 0 || value > row.q + EPS) {
      $('supplyTransferMessage').textContent = '接入量需在 0 与源方案可外供量之间。';
      return;
    }
    if (value > EPS) additions.push({ id: row.id, q: cleanComputedQuantity(value) });
  }
  if (!additions.length) return;
  const add = $('supplyTransferMode').value === 'add';
  for (const row of additions) {
    let supply = state.supplies.find(x => x.id === row.id);
    if (!supply) { supply = { id: row.id, q: 0, stop: true }; state.supplies.push(supply); }
    supply.q = cleanComputedQuantity((add ? supply.q : 0) + row.q);
    supply.stop = true;
  }
  $('supplyTransferDialog').close();
  fitSupplies();
  renderAll();
  setStatus('已从 ' + source.name + ' 接入 ' + additions.length + ' 项供给；源方案保持不变。');
}
function initSupplyTransfer() {
  const button = document.createElement('button');
  button.id = 'openSupplyTransfer'; button.className = 'wide side-actions'; button.textContent = '从其他方案导入供给';
  $('supplies').before(button);
  const dialog = document.createElement('dialog'); dialog.id = 'supplyTransferDialog'; dialog.className = 'wide-dialog';
  dialog.innerHTML = `<div class="top"><h2>产物接入当前供给</h2><button id="closeSupplyTransfer">关闭</button></div><div class="formgrid"><label>源方案<select id="supplyTransferSource"></select></label><label>已有供给处理<select id="supplyTransferMode"><option value="replace">替换同物品供给，避免重复计入</option><option value="add">叠加到现有供给</option></select></label></div><div class="buttons" style="margin:12px 0"><button id="readSupplyTransferFile">读取其他方案 JSON</button><input id="supplyTransferFile" type="file" accept=".json" hidden></div><div id="supplyTransferRows"></div><p id="supplyTransferMessage" class="over" role="status"></p><button id="applySupplyTransfer" class="primary">接入当前供给</button>`;
  document.body.append(dialog);
  button.onclick = () => openSupplyTransfer();
  $('closeSupplyTransfer').onclick = () => dialog.close();
  $('supplyTransferSource').onchange = renderSupplyTransferRows;
  $('supplyTransferMode').onchange = updateSupplyTransferPreview;
  dialog.addEventListener('input', event => { if (event.target.matches('[data-transfer-quantity],[data-transfer-check]')) updateSupplyTransferPreview(); });
  dialog.addEventListener('change', event => { if (event.target.matches('[data-transfer-check]')) updateSupplyTransferPreview(); });
  $('applySupplyTransfer').onclick = applySupplyTransfer;
  $('readSupplyTransferFile').onclick = () => $('supplyTransferFile').click();
  $('supplyTransferFile').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const incoming = PlanFiles.read(json, file.name.replace(/\.json$/i, ''), validSnapshot);
      const start = importedSupplySources.length;
      importedSupplySources.push(...incoming.map((x, i) => ({ key: 'file:' + (start + i), name: file.name + ' · ' + x.name, state: x.state })));
      renderSupplyTransferSources('file:' + start);
      $('supplyTransferMessage').textContent = '';
    } catch (error) { $('supplyTransferMessage').textContent = '无法读取该方案：' + error.message; }
    event.target.value = '';
  };
  document.addEventListener('click', event => {
    const id = event.target.closest('[data-export-supply]')?.dataset.exportSupply;
    if (id) openSupplyTransfer('plan:' + id);
  });
}
initSupplyTransfer();
let machineGroupsRecipe = '', machineGroupsDraft = null;
function renderMachineGroupProfiles() {
  const el = $('machineGroupProfiles'); if (!el) return;
  const profiles = Object.entries(state.machineGroups || {});
  const budget = MAP_DATA.nodes.filter(n => n.kind === 'somersloop').length;
  const installed = state.machineGroupsEnabled ? profiles.reduce((sum, [,p]) => sum + p.groups.reduce((n,g) => n + g.count * g.sloops, 0), 0) : 0;
  const total = current?.sloopTotal ?? installed;
  el.innerHTML = profiles.length ? profiles.map(([key, profile]) => `<div class="stage"><b>${esc(R[key].name)}</b> · ${profile.groups.length} 组 · ${profile.groups.reduce((sum,g) => sum + g.count,0)} 台 <button data-machine-groups="${esc(key)}" ${state.machineGroupsEnabled ? '' : 'disabled'}>编辑分组</button></div>`).join('') : '';
  if (profiles.length) el.innerHTML += `<p class="${budget && total > budget ? 'over' : 'small'}">晶体统计：${fmt(total)} / 地图 ${fmt(budget)}${!current ? '（产线不可行，仅计已配置分组）' : ''}${budget && total > budget ? ' · 超出地图数量，请调整配置；不会自动删改分组。' : ''}</p>`;
}
function machineGroupsPreview() {
  if (!machineGroupsRecipe || !machineGroupsDraft) return;
  const profile = normalizeMachineGroups({ [machineGroupsRecipe]: machineGroupsDraft })[machineGroupsRecipe];
  if (!profile) { $('machineGroupsSummary').textContent = '请添加至少一组机器。'; return; }
  const s = { ...state, machineGroupsEnabled: true, machineGroups: { ...state.machineGroups, [machineGroupsRecipe]: profile } };
  let machines = 0, crystals = 0, power = 0;
  const output = {};
  for (const key of groupedRecipes(machineGroupsRecipe, s)) {
    const g = machineGroup(key, s), eq = g.count * machineClock(key, s) / 100, rr = rates(key, s);
    machines += g.count; crystals += g.count * g.sloops; power += configure(key, eq, s).power;
    for (const [id, q] of Object.entries(rr.outs)) output[id] = (output[id] || 0) + q * eq;
  }
  $('machineGroupsSummary').innerHTML = `<b>配置 ${fmt(machines)} 台 · 晶体 ${fmt(crystals)} 枚 · 满负荷耗电 ${fmt(power)} MW</b><p>${Object.entries(output).map(([id,q]) => esc(I[id].name) + ' ' + fmt(q) + ' ' + unit(id)).join('；')}</p>`;
}
function renderMachineGroupsEditor() {
  const r = R[machineGroupsRecipe], slots = B[r.b]?.sloopSlots || 0;
  $('machineGroupsMode').value = machineGroupsDraft.mode;
  $('machineGroupsRows').innerHTML = machineGroupsDraft.groups.map(g => `<tr><td>组 ${g.id}</td><td><input data-machine-group-field="count" data-machine-group-id="${g.id}" type="number" min="0" max="1000000" step="1" value="${displayNumber(g.count)}" aria-label="组 ${g.id} 台数" style="width:85px"></td><td><input data-machine-group-field="clock" data-machine-group-id="${g.id}" type="number" min="1" max="250" step="any" value="${displayNumber(g.clock)}" aria-label="组 ${g.id} 频率" style="width:85px"></td><td><input data-machine-group-field="sloops" data-machine-group-id="${g.id}" type="number" min="0" max="${slots}" step="1" value="${displayNumber(g.sloops)}" aria-label="组 ${g.id} 每台晶体" ${slots ? '' : 'disabled'} style="width:85px"> / ${slots}</td><td><button data-remove-machine-group="${g.id}">删除</button></td></tr>`).join('');
  $('disableMachineGroups').disabled = !state.machineGroups?.[machineGroupsRecipe];
  machineGroupsPreview();
}
function openMachineGroups(key) {
  if (!state.machineGroupsEnabled) { setStatus("请先在设置中启用机器分组配置。"); return; }
  const parent = recipeBase(key), r = R[parent];
  if (!r || r.kind !== 'machine') return;
  machineGroupsRecipe = parent;
  const rows = current?.rows.filter(row => recipeBase(row.k) === parent) || [];
  machineGroupsDraft = state.machineGroups?.[parent] ? copy(state.machineGroups[parent]) : { mode: 'capacity', groups: [{ id: 1, count: Math.max(1, rows.reduce((n,row) => n + row.n,0)), clock: machineClock(parent), sloops: amplification(parent).count }] };
  $('machineGroupsTitle').textContent = R[parent].name + ' · 机器分组配置';
  $('machineGroupsBuilding').textContent = B[r.b]?.name || r.b;
  $('machineGroupsMessage').textContent = '';
  renderMachineGroupsEditor();
  $('machineGroupsDialog').showModal();
}
function applyMachineGroups() {
  const parent = machineGroupsRecipe, slots = B[R[parent].b]?.sloopSlots || 0;
  if (!machineGroupsDraft.groups.length) { $('machineGroupsMessage').textContent = '至少保留一组；如需停用，请恢复统一配置。'; return; }
  for (const g of machineGroupsDraft.groups) {
    const count = Number(g.count), clock = Number(g.clock), sloops = Number(g.sloops);
    if (String(g.count).trim() === '' || String(g.clock).trim() === '' || String(g.sloops).trim() === '' || !Number.isInteger(count) || count < 0 || count > 1000000 || !Number.isFinite(clock) || clock < 1 || clock > 250 || !Number.isInteger(sloops) || sloops < 0 || sloops > slots) {
      $('machineGroupsMessage').textContent = '台数须为非负整数，频率为 1–250%，晶体数须为槽位范围内的整数。'; return;
    }
  }
  const profile = normalizeMachineGroups({ [parent]: machineGroupsDraft })[parent];
  const previous = state.machineGroups?.[parent];
  state.machineGroups ??= {};
  state.machineGroups[parent] = profile;
  const keys = groupedRecipes(parent);
  if (!previous) {
    let built = Math.floor(amount(state.built?.['recipe:' + parent]));
    for (const key of keys) { const count = machineGroup(key).count; state.built['recipe:' + key] = Math.min(built, count); built = Math.max(0, built - count); }
  }
  $('machineGroupsDialog').close();
  renderAll();
  setStatus('分组配置已保存，各组独立计算产量、原料和耗电。若供给不足，保留配置并显示不可行提示。');
}
function initMachineGroups() {
  const dialog = document.createElement('dialog'); dialog.id = 'machineGroupsDialog'; dialog.className = 'wide-dialog';
  dialog.innerHTML = `<div class="top"><h2 id="machineGroupsTitle">机器分组配置</h2><button id="closeMachineGroups">关闭</button></div><p id="machineGroupsBuilding"></p><label>运行方式<select id="machineGroupsMode"><option value="capacity">按需求运行：台数作为上限</option><option value="fixed">固定全开：严格按各组配置运行</option></select></label><div class="tablewrap" style="margin:14px 0"><table><thead><tr><th>分组</th><th>台数</th><th>频率 %</th><th>每台晶体数</th><th>操作</th></tr></thead><tbody id="machineGroupsRows"></tbody></table></div><button id="addMachineGroup">＋ 添加一组</button><div id="machineGroupsSummary" class="stage"></div><details class="stage"><summary>分组计算规则</summary><p>各组分别计算：输入随运行台数和频率线性变化；产出再乘以该组晶体倍率；耗电按该组频率指数与晶体倍率平方计算，然后逐组求和。</p><p>按需求运行允许停机和末台降频，台数是各组容量上限；安装的机器和晶体仍按完整配置统计。固定全开会将当前启用配方的全部分组按设定运行，可能产生余量，供给不足时不会悄悄改变分组。</p><p>同配方分组共享产物和原料池，可共同供应最终产物及其他上游需求。分组设置优先于统一晶体数和本类频率；关闭超频时实际频率不超过 100%，原值保留。发电机的晶体槽位为 0。</p></details><p id="machineGroupsMessage" class="over" role="status"></p><div class="buttons"><button id="applyMachineGroups" class="primary">应用分组配置</button><button id="disableMachineGroups">恢复统一配置</button></div>`;
  document.body.append(dialog);
  const setting = document.createElement('div'); setting.className = 'panel';
  setting.innerHTML = '<h2>机器分组</h2><label class="buildcheck"><input id="enableMachineGroups" type="checkbox"> 启用机器分组配置</label><div id="machineGroupProfiles"></div>';
  $('settingsTab').append(setting);
  $('enableMachineGroups').checked = !!state.machineGroupsEnabled;
  renderMachineGroupProfiles();
  $('enableMachineGroups').onchange = event => { state.machineGroupsEnabled = event.target.checked; renderAll(); };
  $('closeMachineGroups').onclick = () => dialog.close();
  $('addMachineGroup').onclick = () => {
    if (machineGroupsDraft.groups.length >= 100) { $('machineGroupsMessage').textContent = '每个配方最多支持 100 组。'; return; }
    const id = Math.max(0, ...machineGroupsDraft.groups.map(g => g.id)) + 1;
    machineGroupsDraft.groups.push({ id, count: 1, clock: 100, sloops: 0 }); renderMachineGroupsEditor();
  };
  $('machineGroupsMode').onchange = event => { machineGroupsDraft.mode = event.target.value; machineGroupsPreview(); };
  dialog.addEventListener('input', event => {
    const field = event.target.dataset.machineGroupField, id = +event.target.dataset.machineGroupId;
    if (!field) return;
    const group = machineGroupsDraft.groups.find(g => g.id === id); if (!group) return;
    group[field] = event.target.value; machineGroupsPreview();
  });
  dialog.addEventListener('click', event => {
    const id = event.target.closest('[data-remove-machine-group]')?.dataset.removeMachineGroup;
    if (id) { machineGroupsDraft.groups = machineGroupsDraft.groups.filter(g => g.id !== +id); renderMachineGroupsEditor(); }
  });
  $('applyMachineGroups').onclick = applyMachineGroups;
  $('disableMachineGroups').onclick = () => {
    const parent = machineGroupsRecipe;
    const keys = groupedRecipes(parent), count = keys.reduce((sum,key) => sum + Math.min(machineGroup(key)?.count || 0, amount(state.built?.['recipe:' + key])), 0);
    state.built['recipe:' + parent] = count;
    delete state.machineGroups[parent];
    dialog.close(); renderAll(); setStatus('已恢复统一晶体和频率配置。');
  };
  document.addEventListener('click', event => {
    const key = event.target.closest('[data-machine-groups]')?.dataset.machineGroups;
    if (key) openMachineGroups(key);
  });
}
initMachineGroups();
