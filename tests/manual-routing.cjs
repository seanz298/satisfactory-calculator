const assert=require('node:assert/strict'),vm=require('node:vm'),{environment}=require('./integration.cjs');
const c=environment(); const r=vm.runInContext(`(()=>{
 const s=fresh();s.mode='forward';s.supplies=[{id:'Desc_OreIron_C',q:30,stop:true}];s.products=[{id:'Desc_IronPlate_C',q:20,lock:true}];
 const initial=planSolve(demands(s),s);const auto=flowGraph(summarize(initial,s),s);s.routing={enabled:true,edges:auto.edges.filter(e=>!e.to.startsWith('w:')).map(({from,to,item})=>({from,to,item,limit:null}))};
 const full=planSolve(demands(s),s), round=safeState(JSON.parse(JSON.stringify(s))),roundSolved=planSolve(demands(round),round);
 const cut=structuredClone(s);cut.routing.edges.shift(); const broken=planSolve(demands(cut),cut);
 const capped=structuredClone(s);capped.routing.edges.find(e=>e.item==='Desc_OreIron_C').limit=15;const tooSmall=planSolve(demands(capped),capped);
 const unrestricted=structuredClone(cut);unrestricted.routing.enabled=false;const fallback=planSolve(demands(unrestricted),unrestricted);
 return {initial:initial.ok,full:full.ok,edges:full.routedEdges?.length,round:roundSolved.ok,broken:broken.ok,capped:tooSmall.ok,fallback:fallback.ok};})()`,c);
assert(r.initial&&r.full&&r.round&&r.fallback);assert.equal(r.edges,3);assert.equal(r.broken,false);assert.equal(r.capped,false);console.log('Manual routing constrains supply, line capacity, and persists in plans PASS');
