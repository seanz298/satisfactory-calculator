const assert = require('node:assert/strict');
const vm = require('node:vm');
const {environment} = require('./integration.cjs');
const c = environment();
const result = vm.runInContext(`(()=>{
 const solve=s=>{const r=planSolve(demands(s),s);return r.ok?summarize(r,s):null;};
 // A raw resource requested as a final product is extracted in reverse mode.
 const a=fresh(); a.mode='reverse'; a.products=[{id:'Desc_OreIron_C',q:600,lock:true}];
 const rawOnly=solve(a);
 const b=fresh(); b.mode='reverse'; b.products=[{id:'Desc_OreIron_C',q:60,lock:true},{id:'Desc_IronPlate_C',q:20,lock:true}];
 const mixed=solve(b);
 // A raw supply without the boundary flag is not a hard cap in reverse mode.
 const d=fresh(); d.mode='reverse'; d.supplies=[{id:'Desc_OreIron_C',q:10,stop:false}]; d.products=[{id:'Desc_IronPlate_C',q:100,lock:true}];
 const partialRaw=solve(d);
 // Forward mode still caps raw extraction at the supply.
 const f=fresh(); f.mode='forward'; f.supplies=[{id:'Desc_OreIron_C',q:10,stop:true}]; f.products=[{id:'Desc_OreIron_C',q:20,lock:true}];
 const forwardOver=planSolve(demands(f),f).ok;
 f.products[0].q=10; const forwardOk=planSolve(demands(f),f).ok;
 return {rawOnly:rawOnly?.external.Desc_OreIron_C, mixed:mixed?.external.Desc_OreIron_C, partialRaw:partialRaw?.external.Desc_OreIron_C, forwardOver, forwardOk};
})()`, c);
assert.ok(Math.abs(result.rawOnly - 600) < 1e-5, 'raw product alone');
assert.ok(Math.abs(result.mixed - 90) < 1e-5, 'raw product plus manufactured product');
assert.ok(Math.abs(result.partialRaw - 150) < 1e-5, 'partial raw supply in reverse mode');
assert.equal(result.forwardOver, false); assert.equal(result.forwardOk, true);
console.log('Raw resources as reverse products and uncapped partial raw supplies PASS');
