const assert = require('node:assert/strict');
const vm = require('node:vm');
const {environment} = require('./integration.cjs');
const c = environment();
const result = vm.runInContext(`(()=>{
 const s=fresh(); s.mode='reverse';
 s.supplies=[{id:'Desc_CopperDust_C',q:200,stop:false},{id:'Desc_CopperIngot_C',q:5000,stop:true}];
 s.products=[{id:'Desc_SpaceElevatorPart_9_C',q:5,lock:true,pin:false}];
 const solution=planSolve(demands(s),s); if(!solution.ok) return {ok:false};
 const p=summarize(solution,s);
 return {ok:true,external:p.external.Desc_CopperDust_C||0,copper:p.external.Desc_CopperIngot_C||0,produced:p.rows.reduce((a,r)=>a+(r.outs.Desc_CopperDust_C||0),0)};
})()`,c);
assert(result.ok); assert(Math.abs(result.external-200)<1e-5); assert(result.produced>0); assert(result.copper>0);
console.log('Partial copper powder supply reverses the remaining demand to copper ingots PASS');
