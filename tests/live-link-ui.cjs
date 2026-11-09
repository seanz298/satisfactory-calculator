// DOM-event harness, not a replacement for a browser layout test.
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),{environment}=require('./integration.cjs');
const c=environment();
const app=fs.readFileSync(require('node:path').join(__dirname,'../src/app.js'),'utf8');
vm.runInContext(app.slice(app.indexOf('const $ ='),app.indexOf('let current =')),c);
const result=vm.runInContext(`(()=>{
 const elements=new Map(),svg={setAttribute(){},append(){},createSVGPoint(){return {x:0,y:0,matrixTransform(){return {x:this.x,y:this.y}}}},getScreenCTM(){return {inverse(){return {}}}}};
 const element=()=>({value:'',dataset:{},textContent:'',addEventListener(type,fn){this['on'+type]=fn},querySelector(){return svg},setPointerCapture(){},hasPointerCapture(){return true},releasePointerCapture(){},set innerHTML(x){this.html=x;if(x.includes('<option')&&!x.includes('value="'+this.value+'"'))this.value=x.match(/value="([^"]*)"/)?.[1]||''},get innerHTML(){return this.html||''}});
 document.getElementById=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id)};
 document.addEventListener=()=>{};document.createElementNS=()=>({setAttribute(){},remove(){}});
 const a=fresh();a.planUid='a';a.supplies=[{id:'Desc_OreIron_C',q:100,stop:true}];a.products=[{id:'Desc_IronIngot_C',q:100,lock:true}];
 const b=fresh();b.planUid='b';b.products=[{id:'Desc_IronPlate_C',q:40,lock:true}];
 globalThis.renders=0;renderAll=()=>{globalThis.renders++;};
 globalThis.workshopForUi={plans:[{id:1,name:'A',state:a},{id:2,name:'B',state:b}],active:{id:2,name:'B'},liveDrafts:{}};
 return {a,b};
})()`,c);
c.seed=result;
vm.runInContext('let workshop=workshopForUi;state=seed.b;initLivePlanLinks();',c);
const r=vm.runInContext(`(()=>{
 const host=$('livePlanCanvas'),port={dataset:{liveOutput:'a',liveItem:'Desc_IronIngot_C'},setAttribute(){}};
 document.elementFromPoint=()=>({closest(){return {dataset:{liveTarget:'b'}}}});
 host.onpointerdown({target:{closest(){return port}},button:0,pointerId:1,clientX:30,clientY:40,preventDefault(){}});
 host.onpointermove({pointerId:1,clientX:300,clientY:40,preventDefault(){}});
 host.onpointerup({pointerId:1,clientX:300,clientY:40});
 const link=state.liveLinks[0];
 renderLivePlanLinks();
 return {renders:globalThis.renders,rate:link?.rate,from:link?.from,html:$('livePlanRows').innerHTML,canvas:$('livePlanCanvas').innerHTML};
})()`,c);
assert.equal(r.renders,1);assert.equal(r.rate,100);assert.equal(r.from,'a');assert(r.html.includes('data-live-rate'));assert(r.canvas.includes('data-live-target="b"'));
console.log('Live canvas drag event handlers create persisted links and request recalculation PASS');
