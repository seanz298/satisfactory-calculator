const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
function environment(){
 const app=fs.readFileSync(root+'/src/app.js','utf8'),ui=fs.readFileSync(root+'/src/optimizer-ui.js','utf8');
 const context={__factoryBundle:Object.fromEntries(['data','icons','map','terrain','translations','optimization'].map(k=>[k,JSON.parse(fs.readFileSync(root+'/data/'+k+'.json'))])),document:{documentElement:{lang:'zh'},getElementById:()=>null},console,structuredClone};
 vm.createContext(context);
 const functions=[...(app+'\n'+ui).matchAll(/^(?:async )?function [\s\S]*?^}/gm)].map(m=>m[0]).join('\n');
 const header=app.slice(0,app.indexOf('function fresh()'));
 const progression=app.slice(app.indexOf('const PROGRESSION ='),app.indexOf('function freshProgress()'));
 const genStart=app.indexOf('const GEN ='),gen=app.slice(genStart,app.indexOf('})();',genStart)+5);
 const maps=app.slice(app.indexOf('const MAP_BY_ID ='),app.indexOf('function freshMap()'));
 vm.runInContext(fs.readFileSync(root+'/src/plan-files.js','utf8')+'\n'+header+'\n'+fs.readFileSync(root+'/src/solver.js','utf8')+'\n'+functions+'\n'+progression+'\n'+gen+'\n'+maps+'\nconst amount=x=>Math.max(0,Math.min(1e8,Number(x)||0));let state=fresh();',context);
 return context;
}
function checkState(s){const c=environment();c.input=s;return vm.runInContext(`(()=>{const s=safeState(input);const forward=planSolve(demands(s),s);const reverse=planSolve(demands(s),s,{mode:'reverse'});const expected=Object.keys(s.machineGroups).flatMap(k=>groupedRecipes(k,s));const missing=expected.filter(k=>!forward.rs?.includes(k));return {forward:forward.ok,reverse:reverse.ok,missing,settings:s.optimizationSettings,report:s.optimizationReport};})()`,c);}
module.exports={environment,checkState};
if(require.main===module){
 (async()=>{
  const core=require('../src/optimizer-core.js'),highs=await require('../vendor/highs/highs.js')();
  const data=JSON.parse(fs.readFileSync(root+'/data/data.json')),tables=JSON.parse(fs.readFileSync(root+'/data/optimization.json'));
  const input={map:'normal',clock:250,sloops:103,reserve:0,augmenter:'none',alternates:Object.keys(data.recipes).filter(k=>data.recipes[k].alt),seconds:30};
  const result=await core.optimize(highs,tables,data,input),s=core.makeState(result,data,{}),checked=checkState(s);
  assert(checked.forward);assert(checked.reverse);assert.equal(checked.missing.length,0);
  console.log('Generated plan: forward/reverse and fixed groups PASS');
 })().catch(error=>{console.error(error);process.exitCode=1});
}
