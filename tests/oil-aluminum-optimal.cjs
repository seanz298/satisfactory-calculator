const assert = require('node:assert/strict');
const vm = require('node:vm');
const {environment} = require('./integration.cjs');
const c = environment();
const r = JSON.parse(JSON.stringify(vm.runInContext(`(()=>{
 const run=(prods,alts=[],mode='reverse')=>{const s=fresh();s.mode=mode;s.products=prods.map(([id,q])=>({id,q,lock:true}));s.optimizationSettings={...s.optimizationSettings,alternates:alts};
  const b0=summarize(planSolve(demands(s),s),s),before=primaryRawCost(b0),oil0=b0?.external.Desc_LiquidOil_C||0,bx0=b0?.external.Desc_OreBauxite_C||0;const res=optimizeOilAluminum(s);const after=summarize(planSolve(demands(s),s),s);
  return {ok:res.ok,applied:res.applied,changes:(res.changes||[]).map(x=>[x.id,x.to]),before,after:primaryRawCost(after),oil:[oil0,after?.external.Desc_LiquidOil_C||0],bx:[bx0,after?.external.Desc_OreBauxite_C||0],feasible:!!after,selected:s.selected};};
 return {
  plastic:run([['Desc_Plastic_C',300]]),
  aluminum:run([['Desc_AluminumIngot_C',60]]),
  limited:run([['Desc_Plastic_C',300]],['Recipe_Alternate_DilutedFuel_C']),
  none:run([['Desc_Rotor_C',10]]),
  forward:run([['Desc_Plastic_C',300]],[],'forward'),
  weights:[resourceWeight('Desc_OreIron_C'),resourceWeight('Desc_Water_C'),resourceWeight('Desc_LiquidOil_C')>5,resourceWeight('Desc_OreUranium_C')>resourceWeight('Desc_OreBauxite_C')],
 };
})()`, c)));
for (const k of ['plastic', 'aluminum']) {
  assert.ok(r[k].ok && r[k].applied && r[k].feasible, k);
  assert.ok(r[k].after < r[k].before * 0.9, k + ' crude oil / bauxite use drops');
}
assert.ok(Math.abs(r.plastic.oil[1] - 112.5) < 1e-6, 'plastic 300/min needs 112.5 crude oil');
assert.ok(Math.abs(r.aluminum.bx[1] - 45) < 1e-6, 'aluminum ingot 60/min needs 45 bauxite');
assert.ok(r.plastic.changes.some(([id, k]) => id === 'Desc_Plastic_C' && k === 'Recipe_Alternate_Plastic_1_C'));
// Only unlocked alternates are considered once the list is set.
assert.ok(r.limited.changes.every(([, k]) => !R_ALT(k) || k === 'Recipe_Alternate_DilutedFuel_C'));
function R_ALT(k) { return /Alternate/.test(k); }
assert.ok(r.limited.feasible);
assert.equal(r.none.ok, true); assert.equal(r.none.applied, false);
assert.equal(r.forward.ok, false);
assert.deepEqual(r.weights, [1, 0, true, true]);
console.log('Oil / aluminum optimal recipes minimise crude oil and bauxite and respect unlocked alternates PASS');
