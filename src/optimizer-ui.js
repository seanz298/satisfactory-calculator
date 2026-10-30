// Optimization runs in an isolated worker; existing planning remains responsive.
const OPT_TABLES=globalThis.__factoryBundle.optimization;
const OPT_RUNTIME=globalThis.__factoryBundle.optimizerRuntime;
let optimizationWorker=null,optimizationCandidate=null,optimizationInput=null,optimizationSession=0;
function normalizeOptimizationSettings(value) {
  const x=value&&typeof value==='object'?value:{};
  const num=(key,defaultValue,min,max)=>Number.isFinite(+x[key])?Math.max(min,Math.min(max,+x[key])):defaultValue;
  return {map:x.map==='pure'?'pure':'normal',clock:num('clock',250,1,250),sloops:Math.floor(num('sloops',103,0,106)),reserve:num('reserve',0,0,1e9),seconds:num('seconds',90,5,600),augmenter:['auto','none','manual'].includes(x.augmenter)?x.augmenter:'auto',augmenterCount:Math.floor(num('augmenterCount',0,0,10)),fueledCount:Math.floor(num('fueledCount',0,0,10)),useSupplyLimits:!!x.useSupplyLimits,alternates:[...new Set((Array.isArray(x.alternates)?x.alternates:[]).filter(k=>DATA.recipes[k]?.alt&&!DATA.recipes[k]?.groupParent))]};
}
function renderOptimizationSettings() {
  if(!$('optimizerPanel'))return;
  const o=normalizeOptimizationSettings(state.optimizationSettings);
  for(const k of ['map','clock','sloops','reserve','seconds','augmenter','augmenterCount','fueledCount'])$('opt-'+k).value=typeof o[k]==='number'?displayNumber(o[k]):o[k];
  $('opt-useSupplyLimits').checked=o.useSupplyLimits;
  $('opt-manual').hidden=o.augmenter!=='manual';
  renderOwnedAlternates();
  const report=state.optimizationReport;
  $('optimizerCurrentReport').textContent=report?`此方案优化记录：${fmt(report.points)} 点/分；安装晶体 ${report.installedSloops} 个（含增幅器）；地热与增幅器独立供电 ${fmt(report.independentPowerMW)} MW。`:'';
}
function renderOwnedAlternates() {
  if(!$('ownedAlternatesList'))return;
  const owned=new Set(normalizeOptimizationSettings(state.optimizationSettings).alternates),q=$('ownedAlternatesSearch').value.trim().toLowerCase();
  const keys=Object.keys(R).filter(k=>R[k].alt&&!R[k].groupParent);
  $('ownedAlternatesCount').textContent=`已解锁 ${owned.size} / ${keys.length} 个`;
  $('ownedAlternatesList').innerHTML=keys.filter(k=>[R[k].name,R[k].en,R[k].py,R[k].initials,k].join(' ').toLowerCase().includes(q)).map(k=>`<label class="owned-alt"><input type="checkbox" data-owned-alternate="${esc(k)}" ${owned.has(k)?'checked':''}><span><b>${esc(R[k].name)}</b><small>${esc(B[R[k].b]?.name||'')} · ${Object.keys(R[k].outs).map(i=>esc(I[i]?.name||i)).join('、')}</small></span></label>`).join('');
}
function setOptimizationSettings(patch) {
  if(optimizationWorker)stopOptimization();
  optimizationCandidate=null;
  if($("optimizerApply"))$("optimizerApply").hidden=true;
  state.optimizationSettings=normalizeOptimizationSettings({...normalizeOptimizationSettings(state.optimizationSettings),...patch});
  save();renderOptimizationSettings();
}
function initOptimizerSettings() {
  const page=$('settingsTab');if(!page)return;
  const general=document.createElement('div');general.id='settingsGeneralPage';
  for(const child of [...page.children])if(!child.classList.contains('planner-heading'))general.append(child);
  page.append(general);
  const tabs=document.createElement('div');tabs.className='settings-subnav';tabs.innerHTML='<button id="settingsGeneralButton" class="selected">常规与回收优化</button><button id="settingsAlternatesButton">已解锁替代配方</button>';
  general.before(tabs);
  const alternate=document.createElement('div');alternate.id='settingsAlternatesPage';alternate.hidden=true;
  alternate.className='panel';alternate.innerHTML='<h2>已解锁替代配方</h2><div class="optimizer-actions"><input id="ownedAlternatesSearch" type="search" placeholder="搜索名称 / 拼音 / English" aria-label="搜索替代配方"><button id="ownedAlternatesAll">全部已解锁</button><button id="ownedAlternatesNone">清空</button></div><p id="ownedAlternatesCount" role="status"></p><div id="ownedAlternatesList" class="owned-alternates-list"></div>';
  page.append(alternate);
  const show=alt=>{general.hidden=alt;alternate.hidden=!alt;$('settingsGeneralButton').classList.toggle('selected',!alt);$('settingsAlternatesButton').classList.toggle('selected',alt);if(alt)renderOwnedAlternates();};
  $('settingsGeneralButton').onclick=()=>show(false);$('settingsAlternatesButton').onclick=()=>show(true);
  $('ownedAlternatesSearch').oninput=renderOwnedAlternates;
  $('ownedAlternatesAll').onclick=()=>setOptimizationSettings({alternates:Object.keys(DATA.recipes).filter(k=>DATA.recipes[k].alt&&!DATA.recipes[k].groupParent)});
  $('ownedAlternatesNone').onclick=()=>setOptimizationSettings({alternates:[]});
  alternate.addEventListener('change',e=>{const k=e.target.dataset.ownedAlternate;if(!k)return;const a=new Set(normalizeOptimizationSettings(state.optimizationSettings).alternates);e.target.checked?a.add(k):a.delete(k);setOptimizationSettings({alternates:[...a]});});
  const panel=document.createElement('section');panel.id='optimizerPanel';panel.className='panel optimizer-panel';
  panel.innerHTML=`<h2>回收点数优化</h2><div class="optimizer-fields">
  <label>地图资源<select id="opt-map"><option value="normal">原版地图 · 实际纯度</option><option value="pure">全部矿点 / 资源井高纯度</option></select></label>
  <label>生产机器频率上限 %<input id="opt-clock" type="number" min="1" max="250" step="any"></label>
  <label>可用增产晶体<input id="opt-sloops" type="number" min="0" max="106" step="1"></label>
  <label>预留电力 MW<input id="opt-reserve" type="number" min="0" step="100"></label>
  <label>计算时限 秒<input id="opt-seconds" type="number" min="5" max="600" step="1"></label>
  <label>异星电力增幅器<select id="opt-augmenter"><option value="auto">自动比较台数与燃料组合</option><option value="none">不建</option><option value="manual">指定台数</option></select></label></div>
  <div id="opt-manual" class="optimizer-fields" hidden><label>增幅器台数<input id="opt-augmenterCount" type="number" min="0" max="10" step="1"></label><label>其中持续供给燃料的台数<input id="opt-fueledCount" type="number" min="0" max="10" step="1"></label></div>
  <label><input id="opt-useSupplyLimits" type="checkbox">额外以当前方案已填写的原始资源供给量作为上限（未填写的资源仍使用地图上限）</label>

  <div class="optimizer-actions"><button id="optimizerAlternates">选择已解锁替代配方</button><button id="optimizerRun" class="primary">开始优化</button><button id="optimizerCancel" disabled>取消计算</button></div>
  <p id="optimizerStatus" role="status" aria-live="polite">默认未勾选替代配方，请先选择已解锁配方。</p><div id="optimizerResult"></div><button id="optimizerApply" hidden>保存为新方案并打开</button><p id="optimizerCurrentReport"></p>`;
  general.prepend(panel);
  for(const key of ['map','clock','sloops','reserve','seconds','augmenter','augmenterCount','fueledCount','useSupplyLimits'])$('opt-'+key).onchange=e=>setOptimizationSettings({[key]:key==='useSupplyLimits'?e.target.checked:e.target.value});
  $('optimizerAlternates').onclick=()=>show(true);
  $('optimizerRun').onclick=startOptimization;$('optimizerCancel').onclick=()=>{stopOptimization();$('optimizerStatus').textContent='已取消，当前方案未改变。';};$('optimizerApply').onclick=applyOptimization;
  renderOptimizationSettings();
}
function stopOptimization() {
  optimizationSession++;if(optimizationWorker)optimizationWorker.terminate();optimizationWorker=null;
  if($('optimizerRun'))$('optimizerRun').disabled=false;if($('optimizerCancel'))$('optimizerCancel').disabled=true;
}
function startOptimization() {
  stopOptimization();optimizationCandidate=null;$('optimizerApply').hidden=true;$('optimizerResult').replaceChildren();
  const input=normalizeOptimizationSettings(state.optimizationSettings);
  if(input.augmenter==='manual'&&(input.fueledCount>input.augmenterCount||input.augmenterCount*10>input.sloops)){$('optimizerStatus').textContent='增幅器数量或燃料台数超过晶体预算，请调整。';return;}
  if(input.useSupplyLimits) {
    input.resourceLimits={};
    for(const p of state.supplies)if(I[p.id]?.raw)input.resourceLimits[p.id]=(input.resourceLimits[p.id]||0)+p.q;
    for(const node of state.nodes)if(I[node.item]?.raw)input.resourceLimits[node.item]=(input.resourceLimits[node.item]||0)+nodeOutput(node).output;
  }
  optimizationInput=input;
  const source=OPT_RUNTIME.loader+'\n'+OPT_RUNTIME.core+`\nself.onmessage=async e=>{try{const p=e.data;const bytes=Uint8Array.from(atob(p.wasm),c=>c.charCodeAt(0));const compiled=await WebAssembly.compile(bytes);const h=await Module({instantiateWasm:(imports,receive)=>{const instance=new WebAssembly.Instance(compiled,imports);receive(instance);return instance.exports;},print:()=>{},printErr:()=>{}});const result=await FactoryOptimizer.optimize(h,p.tables,p.data,p.input,progress=>self.postMessage({type:'progress',progress}));self.postMessage({type:'result',result});}catch(error){self.postMessage({type:'error',message:error.message||String(error)});}};`;
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));let worker;
  try {worker=new Worker(url);} catch(error){URL.revokeObjectURL(url);$('optimizerStatus').textContent='无法启动本地计算线程：'+error.message;return;}
  URL.revokeObjectURL(url);optimizationWorker=worker;const session=optimizationSession;
  $('optimizerRun').disabled=true;$('optimizerCancel').disabled=false;$('optimizerStatus').textContent='正在加载本地求解器…';
  const fail=message=>{if(session!==optimizationSession)return;stopOptimization();$('optimizerStatus').textContent=message;};
  worker.onerror=e=>fail('优化线程错误：'+e.message);
  worker.onmessage=e=>{
    if(session!==optimizationSession)return;
    if(e.data.type==='progress'){const p=e.data.progress;$('optimizerStatus').textContent=`已比较 ${p.tried}/${p.total} 个电力组合，当前增幅器 ${p.n} 座、供燃料 ${p.f} 座${p.best?'；当前最好 '+fmt(p.best)+' 点/分':''}。`;}
    else if(e.data.type==='error')fail(e.data.message);
    else if(e.data.type==='result'){
      const result=e.data.result;stopOptimization();optimizationCandidate=result;
      $('optimizerStatus').textContent=result.allOptimal?`已完成全部 ${result.tried} 个组合，得到设定模型下最优解；耗时 ${fmt(result.elapsed)} 秒。`:`得到当前最好可行解，比较 ${result.tried}/${result.total} 个组合；未证明最优，可延长时限。`;
      try {const candidate=FactoryOptimizer.makeState(result,DATA,fresh());renderOptimizationResult(candidate,result);$('optimizerApply').hidden=false;}catch(error){optimizationCandidate=null;$('optimizerStatus').textContent='结果转换失败：'+error.message;}
    }
  };
  worker.postMessage({wasm:OPT_RUNTIME.wasm,tables:OPT_TABLES,data:DATA,input});
}
function renderOptimizationResult(s,result) {
  const r=s.optimizationReport;
  $('optimizerResult').innerHTML=`<div class="optimizer-summary"><b>${fmt(r.points)} 点 / 分钟</b><span>${fmt(r.points*60)} 点 / 小时</span><span>晶体 ${r.installedSloops} / ${result.settings.sloops} · 增幅器 ${r.augmenters} 座（供燃料 ${r.fueledAugmenters} 座）</span><span>模型平均发电 ${fmt(r.modelGenerationMW)} MW · 用电 ${fmt(r.modelConsumptionMW)} MW · 余电 ${fmt(r.modelReserveMW)} MW</span></div><table><thead><tr><th>最终回收物品</th><th>每分钟产量</th><th>点数/分钟</th></tr></thead><tbody>${r.sink.map(p=>`<tr><td>${esc(I[p.item]?.name||p.item)}</td><td>${fmt(p.q)}</td><td>${fmt(p.points)}</td></tr>`).join('')}</tbody></table>`;
}
function applyOptimization() {
  if(!optimizationCandidate)return;
  try {
    const generated=FactoryOptimizer.makeState(optimizationCandidate,DATA,fresh());
    const candidate=safeState(generated),check=planSolve(demands(candidate),candidate);
    if(!check.ok)throw Error('当前工作台未能复核这份结果，未写入方案。请保留输入并调整条件后重试。');
    const id=workshop.nextId++,name=(optimizationCandidate.settings.map==='pure'?'全高纯度':'原版地图')+' · 回收优化 '+fmt(optimizationCandidate.points/1e8)+'亿/分';
    workshop.plans.push({id,name,kind:'new',savedAt:new Date().toISOString(),state:copy(candidate)});
    workshop.active={id,name,kind:'new'};state=candidate;renderAll();switchTab('planner');setStatus('已保存完整优化方案；可以继续编辑或撤销。');
  }catch(error){$('optimizerStatus').textContent=error.message;}
}
initOptimizerSettings();
function renderOptimizationPlanSummary() {
  let el=$('optimizationPlanSummary');
  const heading=document.querySelector('#plannerTab .planner-heading');
  if(!heading)return;
  if(!el){el=document.createElement('div');el.id='optimizationPlanSummary';el.className='stage';heading.after(el);}
  const r=state.optimizationReport;el.hidden=!r;if(!r)return;
  el.innerHTML=`<b>本方案来自回收优化</b><p>生成时回收 ${fmt(r.points)} 点/分；晶体预算统计 ${r.installedSloops} 个，含 ${r.augmenters} 座增幅器占用的 ${r.augmenters*10} 个。${r.fueledAugmenters?`异星能量矩阵 ${r.fueledAugmenters*5}/分为增幅器燃料，不送回收。`:''}</p>`;
}
