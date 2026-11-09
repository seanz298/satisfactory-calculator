/* Live links are stored on the receiving plan; source identities survive renames. */
function liveLinkState(uid) {
  if(state.planUid === uid) return state;
  const saved=workshop.plans.find(p=>p.state.planUid===uid);
  return saved ? workshop.liveDrafts?.[uid] || saved.state : undefined;
}
function addLivePlanLink(from,to,item,rate) {
  const destination=liveLinkState(to), source=liveLinkState(from);
  if(!source || !destination || from===to) throw Error('请选择两个不同的方案');
  if(!workshop.plans.some(p=>p.state.planUid===from)) throw Error('请先保存来源方案，再建立供货连接');
  if(!I[item]?.selectable || !Number.isFinite(rate) || rate<0 || rate>1e8) throw Error('物料或接入量无效');
  if(hasProductMaterial(item,destination)) throw Error('接收物料不能同时作为最终产物');
  if(destination.supplies.some(x=>x.id===item&&x.lock)) throw Error('请先解除接收方案中该物料的供给锁定');
  const prior=destination.liveLinks || [];
  if(prior.some(l=>l.from===from&&l.item===item)) throw Error('该连接已存在，可直接修改接入量');
  const link={id:makePlanUid(),from,item,rate};
  destination.liveLinks=[...prior,link];
  const report=evaluateLivePlans();
  const cycle=report.errors.find(e=>e.message.includes('循环依赖'));
  if(cycle) { destination.liveLinks=prior; throw Error(cycle.message); }
  return link;
}
function renderLivePlanLinks() {
  if(!$('livePlanPanel')) return;
  const records=livePlanRecords(),report=evaluateLivePlans();
  const select=(id,choices)=>{
    const el=$(id),old=el.value;
    el.innerHTML=choices.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('');
    if(choices.some(([v])=>v===old)) el.value=old;
  };
  select('liveFrom',records.map(p=>[p.id,p.name]));
  select('liveTo',records.map(p=>[p.id,p.name]));
  if(!$('liveTo').dataset.initialized) { $('liveTo').value=state.planUid; $('liveTo').dataset.initialized='1'; }
  const source=records.find(p=>p.id===$('liveFrom').value);
  const declared=source?liveExportDemands(source.state):{};
  const exported=source?report.results.get(source.id)?.exports||{}:{};
  const items=[...new Set([...Object.keys(declared),...Object.keys(exported)])].filter(id=>I[id]?.selectable);
  select('liveItem',items.map(id=>[id,I[id].name]));
  const rows=records.flatMap(p=>(p.state.liveLinks||[]).map(l=>({p,l,a:report.allocations.get(p.id+':'+l.id)})));
  $('livePlanStatus').textContent=rows.length?'源方案编辑后立即重新计算，切换方案和刷新后保留。接入同物料后替代接收方案的手填供给。':'选择来源与接收方案，或从画布输出端口拖到另一张方案卡片。';
  $('livePlanRows').innerHTML=rows.length?`<div class="tablewrap"><table><thead><tr><th>来源</th><th>接收方案</th><th>物料</th><th>申请 / 分</th><th>分配 / 分</th><th>缺口 / 分</th><th></th></tr></thead><tbody>${rows.map(({p,l,a})=>`<tr><td>${esc(records.find(x=>x.id===l.from)?.name||'来源缺失')}</td><td>${esc(p.name)}</td><td>${esc(I[l.item]?.name||l.item)}</td><td><input aria-label="申请接入量" type="number" min="0" max="100000000" step="any" data-live-rate="${esc(l.id)}" data-live-owner="${esc(p.id)}" value="${displayNumber(l.rate)}"></td><td>${a?fmt(a.actual):'—'}</td><td class="${a?.shortage>EPS?'over':''}">${a?fmt(a.shortage):'—'}</td><td><button data-live-delete="${esc(l.id)}" data-live-owner="${esc(p.id)}">断开</button></td></tr>`).join('')}</tbody></table></div>`:'';
  $('livePlanErrors').innerHTML=report.errors.map(e=>`<p class="over">${esc((records.find(p=>p.id===e.plan)?.name||'连接')+'：'+e.message)}</p>`).join('') + records.filter(p=>report.results.get(p.id)?.ok===false).map(p=>`<p class="over">${esc(p.name)}：${esc(report.results.get(p.id).message||'产线不可行')}</p>`).join('');
  const cols=Math.min(3,Math.max(1,records.length)),width=cols*340,height=Math.ceil(records.length/cols)*300;
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="跨方案实时供给画布">`;
  const ports=new Map(),positions=new Map();
  const rowHeights=[];
  records.forEach((p,i)=>{const count=Object.keys(liveExportDemands(p.state)).length+1;const row=Math.floor(i/cols);rowHeights[row]=Math.max(rowHeights[row]||300,110+count*25);});
  records.forEach((p,i)=>{const x=(i%cols)*340+20,y=rowHeights.slice(0,Math.floor(i/cols)).reduce((a,b)=>a+b,20);positions.set(p.id,{x,y});});
  records.forEach(p=>{
    const pos=positions.get(p.id),result=report.results.get(p.id),products=liveExportDemands(p.state);
    const ids=[...new Set([...Object.keys(products),...Object.keys(result?.exports||{})])].filter(id=>I[id]?.selectable && (id!=='Workbench_Electricity' || (result?.exports[id]||0)>EPS));
    // All outputs stay accessible; cards scroll as a group for large plans.
    const h=Math.max(120,70+ids.length*25);pos.h=h;
    svg+=`<g data-live-target="${esc(p.id)}" transform="translate(${pos.x},${pos.y})"><rect width="290" height="${h}" rx="10" fill="${result?.ok?'#fff':'#fff0ed'}" stroke="#536778"/><text x="12" y="25" fill="#111" font-size="14">${esc(p.name.slice(0,24))}</text><text x="12" y="47" fill="#555" font-size="12">${result?.ok?'可供货':'不可行 / 来源失效'}</text>`;
    ids.forEach((id,j)=>{const py=70+j*25;ports.set(p.id+':'+id,{x:pos.x+290,y:pos.y+py});svg+=`<text x="12" y="${py+4}" font-size="12" fill="#111">${esc(I[id]?.name||id)} ${fmt(result?.exports[id]||0)}/分</text><circle data-live-output="${esc(p.id)}" data-live-item="${esc(id)}" cx="290" cy="${py}" r="8" fill="#198d9c" style="cursor:crosshair;touch-action:none"><title>拖到接收方案</title></circle>`;});svg+='</g>';
  });
  for(const {p,l,a} of rows){const start=ports.get(l.from+':'+l.item),end=positions.get(p.id);if(start&&end)svg+=`<path d="M${start.x} ${start.y} C${start.x+65} ${start.y} ${end.x-40} ${end.y+40} ${end.x} ${end.y+40}" fill="none" stroke="${a?.shortage>EPS?'#c33':'#218c98'}" stroke-width="2" pointer-events="none"><title>${esc(I[l.item]?.name||l.item)} ${a?fmt(a.actual):'—'}/分</title></path>`;}
  svg+='</svg>';$('livePlanCanvas').innerHTML=svg;
  const bottom=Math.max(height,...[...positions.values()].map(p=>p.y+(p.h||0)+20));
  const el=$('livePlanCanvas').querySelector('svg');el.setAttribute('height',bottom);el.setAttribute('viewBox',`0 0 ${width} ${bottom}`);
}
function initLivePlanLinks() {
  const fail=e=>{ $('livePlanMessage').textContent=e.message; };
  for(const id of ['liveFrom','liveTo']) $(id).onchange=renderLivePlanLinks;
  $('liveAdd').onclick=()=>{try { addLivePlanLink($('liveFrom').value,$('liveTo').value,$('liveItem').value,Number($('liveRate').value));$('livePlanMessage').textContent='';renderAll(); }catch(e){fail(e)} };
  $('livePlanRows').addEventListener('change',e=>{
    const id=e.target.dataset.liveRate;if(!id)return;
    const owner=liveLinkState(e.target.dataset.liveOwner),link=owner?.liveLinks.find(x=>x.id===id),rate=Number(e.target.value);
    if(!link||!e.target.value.trim()||!Number.isFinite(rate)||rate<0||rate>1e8){fail(Error('请输入有效接入量'));renderLivePlanLinks();return;}
    link.rate=rate;renderAll();
  });
  $('livePlanRows').onclick=e=>{const b=e.target.closest('[data-live-delete]');if(!b)return;const owner=liveLinkState(b.dataset.liveOwner);owner.liveLinks=owner.liveLinks.filter(x=>x.id!==b.dataset.liveDelete);renderAll();};
  const host=$('livePlanCanvas');let dragging=null;
  host.onpointerdown=e=>{
    const port=e.target.closest('[data-live-output]');if(!port||e.button!==0)return;
    e.preventDefault();
    const svg=host.querySelector('svg'),p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;
    const start=p.matrixTransform(svg.getScreenCTM().inverse()),line=document.createElementNS('http://www.w3.org/2000/svg','path');
    for(const [k,v] of Object.entries({stroke:'#e58000','stroke-width':'3',fill:'none','pointer-events':'none'}))line.setAttribute(k,v);
    svg.append(line);dragging={from:port.dataset.liveOutput,item:port.dataset.liveItem,id:e.pointerId,start,line};host.setPointerCapture(e.pointerId);port.setAttribute('stroke','#e58000');port.setAttribute('stroke-width','4');
  };
  host.onpointermove=e=>{
    if(!dragging||dragging.id!==e.pointerId)return;e.preventDefault();
    const svg=host.querySelector('svg'),p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;const q=p.matrixTransform(svg.getScreenCTM().inverse()),a=dragging.start;
    dragging.line.setAttribute('d',`M${a.x} ${a.y} C${a.x+70} ${a.y} ${q.x-70} ${q.y} ${q.x} ${q.y}`);
  };
  host.onpointerup=e=>{
    if(!dragging||dragging.id!==e.pointerId)return;
    const d=dragging;dragging=null;d.line.remove();if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-live-target]');
    try{if(!target)throw Error('请拖到接收方案卡片');const report=evaluateLivePlans(),available=report.results.get(d.from)?.exports[d.item]||0;addLivePlanLink(d.from,target.dataset.liveTarget,d.item,available);$('livePlanMessage').textContent='连接已建立，可在表格调整申请量';renderAll();}catch(err){fail(err);renderLivePlanLinks();}
  };
  host.onpointercancel=e=>{if(dragging?.id===e.pointerId){dragging.line.remove();dragging=null;if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);renderLivePlanLinks();}};
  document.addEventListener('change',e=>{
    const id=e.target.dataset.liveContinue;if(!id)return;
    let supply=state.supplies.find(x=>x.id===id);if(!supply){supply={id,q:0,stop:true};state.supplies.push(supply);}
    supply.stop=!e.target.checked;renderAll();
  });
  document.addEventListener('click',e=>{if(!e.target.closest('[data-live-open]'))return;switchTab('graph');$('livePlanPanel').open=true;$('livePlanPanel').scrollIntoView({block:'start'});});
  renderLivePlanLinks();
}
initLivePlanLinks();
