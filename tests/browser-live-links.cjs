/* Requires Playwright and its Chromium browser: node tests/browser-live-links.cjs */
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'../index.html')))});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 let browser;
 try {
  browser=await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {})});const page=await browser.newPage({viewport:{width:1400,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>typeof initLivePlanLinks==='function'&&!!document.getElementById('livePlanCanvas').querySelector('svg'));
  await page.evaluate(()=>{
   const a=fresh();a.planUid='browser-a';a.supplies=[{id:'Desc_OreIron_C',q:100,stop:true}];a.products=[{id:'Desc_IronIngot_C',q:100,lock:true}];
   const b=fresh();b.planUid='browser-b';b.supplies=[{id:'Desc_IronIngot_C',q:80,stop:true}];b.products=[{id:'Desc_IronPlate_C',q:40,lock:true}];
   workshop=emptyWorkspace();workshop.plans=[{id:1,name:'Browser source',kind:'new',state:a},{id:2,name:'Browser receiver',kind:'new',state:b}];workshop.nextId=3;workshop.active={id:2,name:'Browser receiver',kind:'new'};state=copy(b);workspaceReady=true;renderAll();switchTab('graph');
  });
  const source=page.locator('[data-live-output="browser-a"][data-live-item="Desc_IronIngot_C"]'),target=page.locator('[data-live-target="browser-b"] > rect');
  await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await target.boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+80,b.y+35,{steps:12});await page.mouse.up();
  assert.equal(await page.evaluate(()=>state.liveLinks.length),1);assert(await page.evaluate(()=>planSolve(demands(),state).ok));
  assert.match(await page.evaluate(()=>{try{addLivePlanLink('browser-b','browser-a','Desc_IronPlate_C',1);return ''}catch(e){return e.message}}),/循环依赖/);
  await page.evaluate(()=>{loadNamedPlan(workshop.plans[0]);state.products[0].q=50;renderAll()});
  assert.equal(await page.evaluate(()=>evaluateLivePlans().allocations.get('browser-b:'+workshop.liveDrafts['browser-b'].liveLinks[0].id).actual),50);
  assert.equal(await page.evaluate(()=>evaluateLivePlans().results.get('browser-b').ok),false);
  await page.reload();await page.waitForFunction(()=>typeof evaluateLivePlans==='function'&&!!document.getElementById('livePlanCanvas').querySelector('svg'));
  assert.equal(await page.evaluate(()=>evaluateLivePlans().results.get('browser-a').exports.Desc_IronIngot_C),50);
  await page.evaluate(()=>switchTab('graph'));await page.locator('[data-live-delete]').click();
  assert(await page.evaluate(()=>evaluateLivePlans().results.get('browser-b').ok));
  assert.deepEqual(errors,[]);console.log('Chromium real pointer drag, finite supply, cycle rejection, live source edit, reload and disconnect PASS');
 } finally { if(browser)await browser.close();await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{console.error(e);process.exitCode=1});
