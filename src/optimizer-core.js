/* Local MILP optimizer. HiGHS/HiGHS-JS and reference model: MIT, see vendor notices. */
const FactoryOptimizer = (() => {
  const numeric = (n, lo, hi, name) => { n=Number(n); if(!Number.isFinite(n)||n<lo||n>hi)throw Error(name+'超出范围'); return n; };
  function build(tables, data, input, n=0, fueled=0) {
    const clock=numeric(input.clock,1,250,'频率')/100;
    const budget=numeric(input.sloops,0,106,'晶体数量');
    const reserve=numeric(input.reserve,0,1e9,'预留电力');
    if(!Number.isInteger(budget)||n*10>budget)throw Error('晶体预算不足');
    const base=tables[input.map==='pure'?'pure':'normal'];
    const eq={...base.equalities}, lb={...base.lowerBounds};
    eq.alien_power_matrix_cost=-5*fueled;
    lb.somersloop=-(budget-n*10);
    lb.power_production=reserve-500*n;
    const boost=1+.1*n+.2*fueled, allowed=new Set(input.alternates||[]), cols=[];
    for(const source of base.columns) {
      const c={...source,coeffs:{...source.coeffs}};
      if(c.type_==='manufacturer') {
        if(data.recipes[c.name]?.alt&&!allowed.has(c.name))continue;
        if(c.somersloops>budget-n*10)continue;
      }
      if(c.type_==='manufacturer'||(c.type_==='miner'&&base.resources[c.name]?.is_unlimited)) {
        const effective=Math.min(clock,c.clock), ratio=effective/c.clock;
        for(const key in c.coeffs) {
          if(key==='power_consumption')c.coeffs[key]*=ratio**c.exponent;
          else if(key.startsWith('item|')||key==='conveyors'||key==='pipelines')c.coeffs[key]*=ratio;
        }
        c.clock=effective;
      }
      if(c.type_==='generator')c.coeffs.power_production=c.coeffs.power_production/1.3*boost;
      if(c.type_==='sink') {c.coeffs.power_consumption=0;c.coeffs.machines=0;c.coeffs.sinkCapacity=1;}
      if(c.type_==='miner'&&input.resourceLimits) {
        for(const key in c.coeffs)if(key.startsWith('item|')&&c.coeffs[key]>0) {
          const item=key.slice(5), limit=input.resourceLimits[item];
          if(limit!==undefined) {
            numeric(limit,0,1e9,'资源上限');const row='cap|'+item;
            c.coeffs[row]=-c.coeffs[key];lb[row]=-limit*(data.items[item]?.fluid?1000:1);
          }
        }
      }
      cols.push(c);
    }
    // Real sink count, not a fractional fraction of one sink's 30 MW.
    cols.push({id:'sinkCount',type_:'sinkCount',name:'sinkCount',coeffs:{machines:1,power_consumption:30,sinkCapacity:-1200},requires_integrality:true});
    lb.sinkCapacity=0; // negate the capacity expression below: sinks <= 1200 * count
    for(const c of cols)if(c.coeffs.sinkCapacity)c.coeffs.sinkCapacity*=-1;
    const rows=new Map();
    cols.forEach((c,i)=>Object.entries(c.coeffs).forEach(([k,v])=>{if(v){if(!rows.has(k))rows.set(k,[]);rows.get(k).push([i,Number(v)]);}}));
    const expr=terms=>terms.map(([i,v])=>`${v<0?'-':'+'} ${Math.abs(v).toPrecision(16)} x${i}`).join(' ')||'0 x0';
    const lines=['Maximize',' obj: '+expr(cols.flatMap((c,i)=>c.objective_weight?[[i,c.objective_weight]]:[])),'Subject To'];
    let rowIndex=0;
    const constraints=[];
    for(const [key,terms]of rows) {
      const equal=Object.hasOwn(eq,key),bound=equal?eq[key]:(lb[key]??0);
      if(!Number.isFinite(bound))continue;
      lines.push(` r${rowIndex++}: ${expr(terms)} ${equal?'=':'>='} ${Number(bound).toPrecision(16)}`);
      constraints.push({key,terms,equal,bound});
    }
    lines.push('Bounds');cols.forEach((_,i)=>lines.push(` x${i} >= 0`));
    const integers=cols.flatMap((c,i)=>c.requires_integrality?['x'+i]:[]);
    if(integers.length)lines.push('Generals',integers.join(' '));lines.push('End');
    return {lp:lines.join('\n'),cols,constraints,n,fueled,boost,input};
  }
  function decode(model, result) {
    if(!result.Columns)return null;
    const values=model.cols.map((_,i)=>Number(result.Columns['x'+i]?.Primal||0));
    if(values.some(v=>!Number.isFinite(v)||v< -1e-6))return null;
    for(let i=0;i<values.length;i++)if(model.cols[i].requires_integrality&&Math.abs(values[i]-Math.round(values[i]))>1e-5)return null;
    let worst=0;
    for(const r of model.constraints) {
      const lhs=r.terms.reduce((a,[i,v])=>a+values[i]*v,0);
      const violation=r.equal?Math.abs(lhs-r.bound):Math.max(0,r.bound-lhs);
      worst=Math.max(worst,violation);
      if(violation>Math.max(1e-5,Math.abs(r.bound)*1e-8))return null;
    }
    const active=model.cols.flatMap((c,i)=>values[i]>1e-8?[{...c,value:values[i]}]:[]);
    const points=active.filter(c=>c.type_==='sink').reduce((a,c)=>a+c.value*c.coeffs.points,0);
    if(!(points>0))return null;
    return {points,columns:active,n:model.n,fueled:model.fueled,boost:model.boost,status:result.Status,worstResidual:worst,settings:model.input};
  }
  async function optimize(highs,tables,data,input,progress=()=>{}) {
    numeric(input.seconds,5,600,'计算时限');
    const max=Math.floor(input.sloops/10),cases=[];
    if(input.augmenter==='auto')for(let n=0;n<=max;n++)for(let f=0;f<=n;f++)cases.push([n,f]);
    else if(input.augmenter==='none')cases.push([0,0]);
    else {const n=numeric(input.augmenterCount,0,max,'增幅器台数'),f=numeric(input.fueledCount,0,n,'燃料增幅器台数');if(!Number.isInteger(n)||!Number.isInteger(f))throw Error('台数必须是整数');cases.push([n,f]);}
    const started=Date.now();let best=null,tried=0,allOptimal=true;
    for(const [n,f]of cases) {
      const remaining=input.seconds-(Date.now()-started)/1000;
      if(remaining<=0) {allOptimal=false;break;}
      progress({tried,total:cases.length,n,f,best:best?.points||0});
      const model=build(tables,data,input,n,f);
      const result=highs.solve(model.lp,{output_flag:false,time_limit:Math.max(.05,Math.min(10,remaining)),mip_rel_gap:1e-8});
      const candidate=decode(model,result);tried++;
      if(result.Status!=='Optimal'&&result.Status!=='Infeasible')allOptimal=false;
      if(candidate&&(!best||candidate.points>best.points+1e-3))best=candidate;
      await new Promise(r=>setTimeout(r,0));
    }
    if(!best)throw Error('在当前配方、资源和电力条件下未找到可行产线。可增加计算时间或放宽限制。');
    return {...best,tried,total:cases.length,allOptimal:allOptimal&&tried===cases.length,elapsed:(Date.now()-started)/1000};
  }
  function makeState(result,data,blank) {
    const s=structuredClone(blank);Object.assign(s,{version:12,supplies:[],products:[],nodes:[],selected:{},clock:result.settings.clock,over:true,strict:true,autoPin:false,event:false,mode:'forward',sloops:{},machineClocks:{},machineGroupsEnabled:true,machineGroups:{},generators:[],legacyGenerators:[],built:{},generationMult:result.boost,powerMult:1,costMult:1,genWater:0,extraLoad:0,board:{positions:{},collapsed:[],notes:{}},transport:{belt:1200,pipe:600}});
    const raw={},sink=[];let independent=500*result.n,extraction=0,consumption=0,generation=500*result.n,installed=10*result.n;
    for(const c of result.columns) {
      if(['manufacturer','miner','sinkCount'].includes(c.type_))consumption+=c.value*(c.coeffs.power_consumption||0);if(c.type_==='generator')generation+=c.value*(c.coeffs.power_production||0);
      if(c.type_==='sink') {s.products.push({id:c.name,q:c.value,lock:true,pin:false});sink.push({item:c.name,q:c.value,points:c.value*c.coeffs.points});}
      if(c.type_==='sinkCount')s.extraLoad+=30*Math.round(c.value);
      if(c.type_==='miner') {
        extraction+=c.value*(c.coeffs.power_consumption||0);
        for(const key in c.coeffs)if(key.startsWith('item|')&&c.coeffs[key]>0) {const id=key.slice(5);raw[id]=(raw[id]||0)+c.value*c.coeffs[key]/(data.items[id]?.fluid?1000:1);}
      }
      if(c.type_==='generator'&&c.machine_name==='Geothermal Generator')independent+=c.value*c.coeffs.power_production;
      let key=c.type_==='manufacturer'?c.name:null;
      if(c.type_==='generator')key=Object.keys(c.coeffs).filter(k=>k.startsWith('item|')&&c.coeffs[k]<0).map(k=>'Power_'+k.slice(5)).find(k=>data.recipes[k])||null;
      if(!key)continue;
      const r=data.recipes[key];if(!r)throw Error('计算器缺少配方：'+key);
      const group=s.machineGroups[key]??={mode:'fixed',groups:[]};
      const n=Math.floor(c.value+1e-7),tail=Math.max(0,c.value-n),clk=c.clock*100;
      if(n)group.groups.push({id:group.groups.length+1,count:n,clock:clk,sloops:c.somersloops||0});
      if(tail>1e-7)group.groups.push({id:group.groups.length+1,count:1,clock:Math.max(1,clk*tail),sloops:c.somersloops||0});
      if(tail>1e-7&&clk*tail<1)group.mode='capacity'; // Let the existing tail-machine duty logic represent sub-1% equivalent load.
      installed+=Math.round(c.value)*(c.somersloops||0);
      for(const out of Object.keys(r.outs))s.selected[out]??=key;
    }
    s.extraLoad+=extraction;
    s.supplies=Object.entries(raw).map(([id,q])=>({id,q,stop:true}));
    if(independent>0)s.supplies.push({id:'Workbench_Electricity',q:independent,stop:true});
    if(result.fueled)s.products.push({id:'Desc_AlienPowerFuel_C',q:result.fueled*5,lock:true,pin:false});
    s.optimizationSettings=structuredClone(result.settings);
    s.optimizationReport={points:result.points,sink,installedSloops:installed,augmenters:result.n,fueledAugmenters:result.fueled,independentPowerMW:independent,extractionMW:extraction,modelConsumptionMW:consumption,modelGenerationMW:generation,modelReserveMW:generation-consumption,allOptimal:result.allOptimal,elapsed:result.elapsed};
    return s;
  }
  return {build,decode,optimize,makeState};
})();
if(typeof module==='object'&&module.exports)module.exports=FactoryOptimizer;
