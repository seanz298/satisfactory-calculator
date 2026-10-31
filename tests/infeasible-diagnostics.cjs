const assert = require('node:assert/strict');
const vm = require('node:vm');
const {environment} = require('./integration.cjs');
const c = environment();
const result = vm.runInContext(`(()=>{
 const s=fresh(); s.mode='forward';
 s.products=[{id:'Desc_IronPlate_C',q:20,lock:true,pin:false}];
 const solution=planSolve(demands(s),s);
 const report=diagnosePlanFailure(s,solution);
 return {ok:solution.ok,missing:report.missing};
})()`,c);
assert.equal(result.ok,false);
const iron=result.missing.find(x=>x.id==='Desc_OreIron_C');
assert(iron); assert(Math.abs(iron.q-30)<1e-5);
console.log('Infeasible locked targets report missing iron ore PASS');
