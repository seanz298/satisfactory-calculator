const assert = require('node:assert/strict');
const vm = require('node:vm');
const {environment} = require('./integration.cjs');
const c = environment();
const r = JSON.parse(JSON.stringify(vm.runInContext(`(()=>{
 const solve=s=>summarize(planSolve(demands(s),s),s);
 // Fluid surplus: plastic leaves heavy oil residue.
 const s=fresh(); s.mode='reverse'; s.products=[{id:'Desc_Plastic_C',q:120,lock:true}];
 current=solve(s); const residue=current.surplus.Desc_HeavyOilResidue_C;
 const pack=surplusPackaging('Desc_HeavyOilResidue_C',residue,s), gens=surplusGenerators('Desc_HeavyOilResidue_C',residue,s);
 const added=addSurplusPackaging('Desc_HeavyOilResidue_C',s); const after=solve(s);
 // Petroleum coke can be burned.
 const coke=surplusGenerators('Desc_PetroleumCoke_C',75,s).map(g=>[g.k,g.mw]);
 const water=surplusGenerators('Desc_Water_C',100,s).length;
 const g=fresh(); g.mode='reverse'; g.products=[{id:'Desc_LiquidFuel_C',q:1,lock:true}]; current={surplus:{Desc_LiquidFuel_C:40}};
 const gen=addSurplusGenerator('Desc_LiquidFuel_C','Power_Desc_LiquidFuel_C',g); const genPlan=solve(g);
 // Fill last machines in reverse mode: from downstream up, extra output becomes products.
 const f=fresh(); f.mode='reverse'; f.products=[{id:'Desc_Rotor_C',q:7,lock:true}];
 const before=solve(f); const res=fillLastMachines(f); const filled=solve(f);
 const partial=filled.rows.filter(row=>!R[row.k].generation&&row.tail>0&&row.duty<0.999999);
 const fw=fresh(); fw.mode='forward'; const blocked=fillLastMachines(fw).ok;
 const round=safeState(JSON.parse(JSON.stringify(s))).products.filter(p=>p.sink).map(p=>p.id);
 return {residue,pack:pack&&[pack.k,pack.main,pack.out,pack.container,pack.containerQ],gens:gens.length,added:added&&added.pid,
  afterOk:!!after,afterResidue:after?.surplus.Desc_HeavyOilResidue_C||0,sink:after?.sink&&{count:after.sink.count,points:after.sink.points},
  coke,water,gen:gen&&{pid:gen.pid,mw:gen.mw},genOk:!!genPlan,
  rotorBefore:before.rows.find(r=>r.k==='Recipe_Rotor_C').n, res:{ok:res.ok,added:res.added.map(a=>a.id)}, filledOk:!!filled, partial:partial.map(r=>r.k),
  products:f.products.map(p=>[p.id,p.q]), blocked, round};
})()`, c)));
console.log(JSON.stringify(r));
assert.ok(r.residue > 0);
assert.deepEqual(r.pack.slice(0,2), ['Recipe_PackagedOilResidue_C','Desc_PackagedOilResidue_C']);
assert.ok(Math.abs(r.pack[2] - r.residue) < 1e-6 && r.pack[3] === 'Desc_FluidCanister_C');
assert.equal(r.gens, 0, 'heavy oil residue is not a generator fuel');
assert.ok(r.afterOk && r.afterResidue < 1e-3, 'packaging consumes the fluid surplus');
assert.equal(r.sink.count, 1); assert.ok(r.sink.points > 0);
assert.deepEqual(r.coke, [['Power_Desc_PetroleumCoke_C', 225]]); assert.equal(r.water, 0);
assert.ok(r.genOk && Math.abs(r.gen.mw - 500) < 1e-6);
assert.equal(r.res.ok, true); assert.ok(r.res.added.length > 0 && r.filledOk);
assert.deepEqual(r.partial, [], 'no partially loaded last machine remains');
assert.ok(r.products.find(([id]) => id === 'Desc_Rotor_C')[1] === 8, 'rotor rounded up to two full assemblers');
assert.equal(r.blocked, false);
assert.deepEqual(r.round, ['Desc_PackagedOilResidue_C']);
console.log('Fluid packaging/generators and reverse last-machine fill PASS');
{
 const r2 = JSON.parse(JSON.stringify(vm.runInContext(`(()=>{
  // Fluids are never added as products: packageable ones become their packaged item,
  // Excited Photonic Matter / Dark Matter Residue rows keep their last machine underclocked.
  const s=fresh(); s.mode='reverse'; s.products=[{id:'Desc_SpaceElevatorPart_12_C',q:1.5,lock:true},{id:'Desc_Plastic_C',q:50,lock:true}];
  const r=fillLastMachines(s); const p=summarize(planSolve(demands(s),s),s);
  const fluidProducts=s.products.filter(x=>I[materialId(x.id)].fluid).map(x=>x.id);
  // "Set as product" on a fluid surplus packages it.
  const t=fresh(); t.mode='reverse'; t.products=[{id:'Desc_Plastic_C',q:120,lock:true}];
  current=summarize(planSolve(demands(t),t),t); const pid=addSurplusAsProduct('Desc_HeavyOilResidue_C',t);
  current={surplus:{Desc_DarkEnergy_C:50}}; const none=addSurplusAsProduct('Desc_DarkEnergy_C',t);
  return {ok:r.ok,feasible:!!p,fluidProducts,skipped:r.skipped.map(x=>x.item),pid,sink:!!t.products.find(x=>x.id===pid)?.sink,none,
    advice:[!!fluidAdvice('Desc_QuantumEnergy_C'),!!fluidAdvice('Desc_DarkEnergy_C')],dmrConsumers:surplusConsumers('Desc_DarkEnergy_C',50,{...fresh(),optimizationSettings:{alternates:['Recipe_Alternate_DarkMatter_Crystallization_C']}}).map(c=>c.main)};
 })()`, c)));
 assert.ok(r2.ok && r2.feasible);
 assert.deepEqual(r2.fluidProducts, []);
 assert.ok(r2.skipped.includes('Desc_QuantumEnergy_C'));
 assert.equal(r2.pid, 'Desc_PackagedOilResidue_C'); assert.equal(r2.sink, false); assert.equal(r2.none, null);
 assert.deepEqual(r2.advice, [true, true]);
 assert.ok(r2.dmrConsumers.includes('Desc_DarkMatter_C'));
 console.log('Fluids are packaged or kept underclocked, never added as fluid products PASS');
}
