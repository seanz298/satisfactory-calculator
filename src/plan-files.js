/* Single-plan files; workspace snapshots remain browser-local only. */
const PlanFiles = (() => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const title = (value, fallback = '未命名方案') => typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : fallback;
  function filename(name) {
    let stem = title(name).replace(/\.json$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '').trim();
    if (!stem || /^\.+$/.test(stem)) stem = '未命名方案';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = '_' + stem;
    return stem + '.json';
  }
  function payload(plan, gameVersion) {
    if (!plan?.state || plan.state.version !== 12) throw Error('方案内容无效');
    return {format:'satisfactory-plan', configVersion:1, gameVersion, name:title(plan.name), kind:plan.kind === 'retrofit' ? 'retrofit' : 'new', savedAt:new Date().toISOString(), state:clone(plan.state)};
  }
  function read(value, fallback, validate) {
    const entry = p => {
      if (!p || typeof p !== 'object') throw Error('方案条目无效');
      return {name:title(p.name, title(fallback)), kind:p.kind === 'retrofit' ? 'retrofit' : 'new', savedAt:typeof p.savedAt === 'string' ? p.savedAt : '', state:validate(p.state)};
    };
    if (value?.format === 'satisfactory-plan') {
      if (value.configVersion !== 1) throw Error('不支持此方案文件版本');
      return [entry(value)];
    }
    if (value?.format === 'satisfactory-workspace') {
      if (value.configVersion !== 1 || !Array.isArray(value.plans)) throw Error('旧配置的方案列表或版本无效');
      const plans = value.plans.map(entry);
      if (value.active?.state) {
        const active = entry(value.active);
        const saved = value.plans.findIndex(p => p.id === value.active.id);
        const same = saved >= 0 && plans[saved].name === active.name && plans[saved].kind === active.kind && JSON.stringify(plans[saved].state) === JSON.stringify(active.state);
        if (!same) plans.push(active);
      }
      if (value.existing?.state) {
        const existing = entry({...value.existing, kind:'retrofit'});
        if (!plans.some(p => p.name === existing.name && JSON.stringify(p.state) === JSON.stringify(existing.state))) plans.push(existing);
      }
      if (!plans.length) throw Error('配置中没有可导入的方案');
      return plans;
    }
    if (value?.format) throw Error('不支持此配置格式');
    return [entry({name:fallback, state:value})];
  }
  function merge(workspace, incoming) {
    const next = clone(workspace), names = new Set(next.plans.map(p => p.name));
    names.add(next.active.name);
    let id = Math.max(1, next.nextId || 1, ...next.plans.map(p => p.id + 1), (next.active.id || 0) + 1);
    for (const plan of incoming) {
      const base = title(plan.name); let name = base, suffix = 2;
      while (names.has(name)) name = base.slice(0, 85) + '（导入 ' + suffix++ + '）';
      names.add(name);
      next.plans.push({...clone(plan), name, id:id++, savedAt:plan.savedAt || new Date().toISOString()});
    }
    next.nextId = id;
    return next;
  }
  return {filename, payload, read, merge};
})();
if (typeof module === 'object' && module.exports) module.exports = PlanFiles;
