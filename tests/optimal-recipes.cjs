const assert = require('node:assert/strict');
const vm = require('node:vm');
const {environment} = require('./integration.cjs');
const c = environment();
const r = JSON.parse(JSON.stringify(vm.runInContext(`(()=>{
 const make=(prods,alts=[],mode='reverse')=>{const s=fresh();s.mode=mode;s.products=prods.map(([id,q])=>({id,q,lock:true}));s.optimizationSettings={...s.optimizationSettings,alternates:alts};return s;};
 const run=(target,prods,alts,raws)=>{const s=make(prods,alts);const b=summarize(planSolve(demands(s),s),s);const res=optimizeRecipes(s,{target,raws});const a=summarize(planSolve(demands(s),s),s);
   return {ok:res.ok,applied:res.applied,reason:res.reason,feasible:!!a,before:targetCost(b,target,raws||[]),after:targetCost(a,target,raws||[]),changes:(res.changes||[]).map(x=>x.to),
     out:a?Object.fromEntries(Object.entries(demands(s)).map(([id])=>[id,a.rows.reduce((t,row)=>t+(row.outs[id]||0),0)])):{}};};
 const heavy=[['Desc_ModularFrameHeavy_C',2]];
 const supply=make([['Desc_Rotor_C',10]]);
 return {
  raw:run('raw',heavy), machines:run('machines',heavy), power:run('power',heavy),
  iron:run('raws',[['Desc_Rotor_C',10],['Desc_ModularFrame_C',4]],[],['Desc_OreIron_C']),
  noRaws:run('raws',heavy,[],[]),
  limited:run('machines',heavy,['Recipe_Alternate_ModularFrameHeavy_C']),
  forward:(()=>{const s=make(heavy,[],'forward');return optimizeRecipes(s,{target:'raw'}).ok;})(),
  list:(()=>{const l=supplyListRows(supply);return {l,csv:supplyListCsv(l)};})(),
 };
})()`, c)));
for (const k of ['raw', 'machines', 'power', 'iron']) {
  assert.ok(r[k].ok && r[k].applied && r[k].feasible, k);
  assert.ok(r[k].after < r[k].before * 0.8, k + ' target drops: ' + r[k].before + ' -> ' + r[k].after);
  for (const [id, q] of Object.entries(r[k].out)) assert.ok(q >= ({Desc_ModularFrameHeavy_C: 2, Desc_Rotor_C: 10, Desc_ModularFrame_C: 4})[id] - 1e-6, k + ' still makes ' + id);
}
assert.equal(r.noRaws.ok, false);
assert.equal(r.forward, false);
assert.ok(r.limited.feasible);
assert.ok(r.limited.changes.every((k) => !/Alternate/.test(k) || k === 'Recipe_Alternate_ModularFrameHeavy_C'), 'only unlocked alternates');
// Supply checklist
const iron = r.list.l.inputs.find((x) => x.id === 'Desc_OreIron_C');
assert.ok(iron && iron.raw && iron.need > 0 && iron.diff === iron.supply - iron.need);
assert.deepEqual(r.list.l.products, [{id: 'Desc_Rotor_C', name: r.list.l.products[0].name, q: 10}]);
const lines = r.list.csv.replace(/^﻿/, '').trim().split('\r\n');
assert.equal(lines[0].split(',').length, 7);
assert.ok(lines.some((l) => l.includes('Desc_OreIron_C')) && lines.at(-1).includes('Desc_Rotor_C'));
console.log('All-recipe optimizer (4 targets, unlocked alternates) and supply checklist PASS');
