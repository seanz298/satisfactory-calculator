const assert=require('node:assert/strict'),vm=require('node:vm');
const files=require('../src/plan-files.js'),{environment}=require('./integration.cjs');
const env=environment();
const state=vm.runInContext('fresh()',env);
const validate=x=>{env.input=x;return vm.runInContext('validSnapshot(input)',env)};
const plan={name:'全图富矿',kind:'new',state};
const output=files.payload({...plan,plans:[{secret:true}],existing:{secret:true}},'1.2');
assert.equal(output.format,'satisfactory-plan');
assert(!('plans' in output));assert(!('existing' in output));assert(!('previous' in output));
assert.equal(files.filename(plan.name),'全图富矿.json');
assert.equal(files.filename('钢铁 / 北:厂?'),'钢铁 _ 北_厂_.json');
assert.equal(files.filename('CON'),'_CON.json');
assert.equal(files.filename('已有.json'),'已有.json');
assert.equal(files.filename('...'),'未命名方案.json');
assert.equal(files.read(output,'file',validate)[0].name,plan.name);
const original={active:{id:1,name:'正在编辑'},plans:[{id:1,...plan}],nextId:2,existing:{name:'基准'},previous:{name:'旧草稿'}};
const before=JSON.stringify(original);
const merged=files.merge(original,[plan,plan]);
assert.equal(JSON.stringify(original),before);
assert.equal(merged.plans.length,3);assert.equal(merged.nextId,4);
assert.equal(new Set(merged.plans.map(x=>x.id)).size,3);
assert.equal(new Set(merged.plans.map(x=>x.name)).size,3);
assert.deepEqual(merged.active,original.active);assert.deepEqual(merged.existing,original.existing);assert.deepEqual(merged.previous,original.previous);
// Identical saved/current legacy snapshots appear only once. Unsaved edits survive separately.
const legacy={format:'satisfactory-workspace',configVersion:1,plans:[{id:1,...plan}],active:{id:1,...plan}};
assert.equal(files.read(legacy,'legacy',validate).length,1);
legacy.active.state={...state,extraLoad:500};
assert.equal(files.read(legacy,'legacy',validate).length,2);
assert.equal(files.read(state,'原始方案',validate)[0].name,'原始方案');
assert.throws(()=>files.read({...output,configVersion:2},'invalid',validate));
assert.throws(()=>files.read({...legacy,plans:[{name:'bad',state:{}}]},'invalid',validate));
assert.throws(()=>files.read({format:'other'},'invalid',validate));
// Exercise the real async import handler: mixed good/bad batches commit nothing.
env.workshop=original;env.workspaceReady=true;
vm.runInContext('save=()=>{};renderWorkspace=()=>{};setStatus=(message)=>{globalThis.lastStatus=message};',env);
env.event={target:{files:[{name:'valid.json',text:async()=>JSON.stringify(output)},{name:'invalid.json',text:async()=>'{'}],value:'chosen'}};
(async()=>{
  await vm.runInContext('importWorkspaceFile(event)',env);
  assert.equal(JSON.stringify(env.workshop),before);assert.equal(env.event.target.value,'');
  assert.match(env.lastStatus,/导入失败/);
  env.event.target.files=[{name:'valid.json',text:async()=>JSON.stringify(output)}];
  await vm.runInContext('importWorkspaceFile(event)',env);
  assert.equal(env.workshop.plans.length,2);assert.equal(JSON.stringify(env.workshop.active),JSON.stringify(original.active));
  assert.match(env.lastStatus,/已合并 1/);
  console.log('Single-plan export, safe filenames, legacy merge, collisions and atomic import PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
{
 // Export all: saved plans + current draft + baseline round-trip through read().
 const draft=vm.runInContext('(()=>{const s=fresh();s.products=[{id:"Desc_IronPlate_C",q:5,lock:true}];return s})()',env);
 const ws={active:{id:1,name:'全图富矿',kind:'new'},plans:[{id:1,name:'全图富矿',kind:'new',savedAt:'2026-11-08T00:00:00Z',state},{id:2,name:'改装',kind:'retrofit',savedAt:'',state}],existing:{name:'基准',state,inventory:{}}};
 const all=files.workspacePayload(ws,draft,'1.2');
 assert.equal(all.format,'satisfactory-workspace'); assert.equal(all.plans.length,2); assert.ok(all.active && all.existing);
 const back=files.read(JSON.parse(JSON.stringify(all)),'全部方案',validate);
 assert.deepEqual(back.map(p=>p.name),['全图富矿','改装','全图富矿','基准']);
 assert.equal(back[1].kind,'retrofit'); assert.equal(back[3].kind,'retrofit');
 // Unchanged draft is not duplicated.
 const same=files.read(JSON.parse(JSON.stringify(files.workspacePayload(ws,state,'1.2'))),'x',validate);
 assert.equal(same.length,3);
 assert.throws(()=>files.workspacePayload({plans:[{name:'坏',state:{version:1}}]},null,'1.2'));
 console.log('Export all plans round-trips through import PASS');
}
