const assert=require('node:assert/strict'),fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..');const core=require('../src/optimizer-core.js'),{checkState}=require('./integration.cjs');
const tables=JSON.parse(fs.readFileSync(root+'/data/optimization.json')),data=JSON.parse(fs.readFileSync(root+'/data/data.json'));const all=Object.keys(data.recipes).filter(k=>data.recipes[k].alt);
(async()=>{const h=await require('../vendor/highs/highs.js')();const base={map:'normal',clock:250,sloops:103,reserve:0,augmenter:'none',alternates:all,seconds:90};let normal;
for(const [name,patch]of [['normal',{}],['reserve',{reserve:10000}],['no-alternates',{alternates:[]}],['no-crystals',{sloops:0}],['low-clock',{clock:100}],['pure-auto',{map:'pure',augmenter:'auto'}]]) {
 const o={...base,...patch};const r=await core.optimize(h,tables,data,o);const s=core.makeState(r,data,{});const checked=checkState(s);assert(checked.forward,name+' forward');assert(checked.reverse,name+' reverse');assert.equal(checked.missing.length,0,name+' omitted groups');assert(s.optimizationReport.installedSloops<=o.sloops);assert(s.optimizationReport.modelReserveMW>=o.reserve-.01);
 for(const c of r.columns)if(c.type_==='manufacturer'&&data.recipes[c.name]?.alt)assert(o.alternates.includes(c.name));
 if(name==='normal')normal=r.points;if(name==='reserve')assert(r.points<normal);
 if(name==='pure-auto'){assert.equal(r.n,1);assert.equal(r.fueled,1);assert(Math.abs(r.points-670505157)<30000);}
 assert.equal(checked.settings.alternates.length,o.alternates.length);
 console.log(name,Math.round(r.points),r.n,r.fueled,r.allOptimal,'PASS');
}
const capped={...base,resourceLimits:{Desc_OreUranium_C:0}};const r=await core.optimize(h,tables,data,capped);const s=core.makeState(r,data,{});assert(!s.supplies.some(p=>p.id==='Desc_OreUranium_C'&&p.q>1e-6));assert(checkState(s).forward);console.log('uranium-cap PASS');
})().catch(e=>{console.error(e);process.exitCode=1});
