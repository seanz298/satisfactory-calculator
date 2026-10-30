const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),core=require('../src/optimizer-core.js');
const data=JSON.parse(fs.readFileSync(root+'/data/data.json')),tables=JSON.parse(fs.readFileSync(root+'/data/optimization.json'));
(async()=>{const highs=await require('../vendor/highs/highs.js')();const input={map:'normal',clock:250,sloops:103,reserve:0,augmenter:'none',alternates:Object.keys(data.recipes).filter(k=>data.recipes[k].alt),seconds:30};
const model=core.build(tables,data,input);const res=highs.solve(model.lp,{output_flag:false,mip_rel_gap:1e-9});const r=core.decode(model,res);console.log(res.Status,r?.points);assert(r);assert(Math.abs(r.points-461900006.306)<20000);const s=core.makeState(r,data,{});console.log(s.optimizationReport);})();
