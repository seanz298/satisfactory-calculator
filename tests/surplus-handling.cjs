const assert = require('node:assert/strict');
const vm = require('node:vm');
const {environment} = require('./integration.cjs');
const c = environment();
const r = JSON.parse(JSON.stringify(vm.runInContext(`(()=>{
 // Plastic from crude oil leaves Heavy Oil Residue (fluid); Petroleum Coke surplus is solid.
 const s=fresh(); s.mode='reverse'; s.products=[{id:'Desc_Plastic_C',q:120,lock:true}];
 const base=summarize(planSolve(demands(s),s),s);
 const residue=base.surplus.Desc_HeavyOilResidue_C||0;
 const fluidSink=sinkStatus('Desc_HeavyOilResidue_C').ok, waste=sinkStatus('Desc_NuclearWaste_C').ok, plate=sinkStatus('Desc_IronPlate_C');
 // Sinking 1500 plates/min needs two sinks (30 MW each); fluids are never sunk.
 const u=fresh(); u.mode='reverse'; u.products=[{id:'Desc_IronPlate_C',q:10,lock:true}]; u.selected={};
 const plan0=summarize(planSolve(demands(u),u),u);
 const fake={...plan0.surplus, Desc_IronPlate_C:1500, Desc_HeavyOilResidue_C:40};
 u.surplusHandling={Desc_IronPlate_C:'sink', Desc_HeavyOilResidue_C:'sink'};
 const sp=surplusSinkPlan(fake,u);
 // Consumers for residue include a recipe and quantities scale with the surplus.
 const ideas=surplusConsumers('Desc_HeavyOilResidue_C',residue,s);
 // Adding a consumer creates a recipe-specific product and keeps the plan feasible in reverse mode.
 current=base; const added=addSurplusConsumer('Desc_HeavyOilResidue_C',ideas[0].k,s);
 const after=summarize(planSolve(demands(s),s),s);
 // Round trip through safeState keeps sink choices and drops invalid ones.
 const round=safeState(JSON.parse(JSON.stringify({...u,surplusHandling:{Desc_IronPlate_C:'sink',Bogus_C:'sink',Desc_Coal_C:'x'}})));
 return {residue,fluidSink,waste,platePoints:plate.points,sp:{count:sp.count,power:sp.power,points:sp.points,items:sp.items.length},
   ideas:ideas.map(i=>[i.k,i.main,i.out]),added:added&&{pid:added.pid,sel:s.selected[added.pid]},afterOk:!!after,afterResidue:after&&(after.surplus.Desc_HeavyOilResidue_C||0),
   round:round.surplusHandling};
})()`, c)));
assert.ok(r.residue > 1, 'plastic chain leaves heavy oil residue');
assert.equal(r.fluidSink, false); assert.equal(r.waste, false); assert.equal(r.platePoints, 6);
assert.deepEqual(r.sp, {count:2, power:60, points:9000, items:1});
assert.ok(r.ideas.length > 0 && r.ideas.every(([,,q]) => q > 0));
assert.equal(r.added.pid, 'Desc_PetroleumCoke_C');
assert.ok(r.afterOk, 'plan stays feasible after adding the consumer');
assert.ok(r.afterResidue < r.residue - 1e-6, 'residue surplus decreases');
assert.deepEqual(r.round, {Desc_IronPlate_C:'sink'});
console.log('Surplus sink planning, downstream consumers and persistence PASS');
