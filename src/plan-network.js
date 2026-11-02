/* Cross-plan network evaluator. No browser globals or mutations. */
const PlanNetwork = (() => {
  const clone = x => JSON.parse(JSON.stringify(x));
  function normalize(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.links)) return {version:1,links:[]};
    const ids = new Set();
    return {version:1,links:value.links.map(l => {
      if (!l || typeof l.id !== 'string' || ids.has(l.id) || typeof l.from !== 'string' || typeof l.to !== 'string' || typeof l.item !== 'string' || !Number.isFinite(l.rate) || l.rate < 0) throw Error('跨方案连接数据无效');
      ids.add(l.id); return {id:l.id,from:l.from,to:l.to,item:l.item,rate:l.rate};
    })};
  }
  function evaluate(plans, network, calculate) {
    const links=normalize(network).links, by=new Map();
    for(const p of plans) { if(by.has(p.id)) throw Error('方案标识重复'); by.set(p.id,p); }
    const results=new Map(), visiting=new Set(), errors=[], allocations=new Map();
    function visit(id) {
      if(results.has(id)) return results.get(id);
      if(visiting.has(id)) throw Error('循环依赖：'+[...visiting,id].join(' → '));
      const plan=by.get(id); if(!plan) throw Error('来源方案不存在：'+id);
      visiting.add(id);
      const incoming={};
      for(const l of links.filter(x=>x.to===id)) {
        const source=visit(l.from);
        if(!source.ok) throw Error('来源方案不可行：'+l.from);
        const total=links.filter(x=>x.from===l.from&&x.item===l.item).reduce((n,x)=>n+x.rate,0);
        const capacity=Math.max(0,Number(source.exports[l.item])||0);
        const q=total>0?l.rate*Math.min(1,capacity/total):0;
        allocations.set(l.id,{requested:l.rate,actual:q,shortage:Math.max(0,l.rate-q)});
        incoming[l.item]=(incoming[l.item]||0)+q;
      }
      const result=calculate(clone(plan.state),clone(incoming));
      if(!result||typeof result.ok!=='boolean') throw Error('方案计算结果无效：'+id);
      const out={...result,exports:result.ok?{...result.exports}:{},incoming};
      results.set(id,out); visiting.delete(id); return out;
    }
    // Validate all endpoints, including links whose destination was removed.
    for(const l of links) if(!by.has(l.from)||!by.has(l.to)) errors.push({link:l.id,message:'连接引用了不存在的方案'});
    if(!errors.length) for(const id of by.keys()) {
      try { visit(id); } catch(e) { errors.push({plan:id,message:e.message}); visiting.clear(); }
    }
    return {ok:errors.length===0&&[...results.values()].every(x=>x.ok),results,allocations,errors};
  }
  return {normalize,evaluate};
})();
if(typeof module==='object'&&module.exports) module.exports=PlanNetwork;
