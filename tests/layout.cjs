const assert = require('node:assert/strict');
const vm = require('node:vm');
const {environment} = require('./integration.cjs');
const c = environment();
const r = JSON.parse(JSON.stringify(vm.runInContext(`(()=>{
  const f = fresh();
  const bad = normalizeLayout({ pages: [{ id: 'a', name: 'A', groups: [{ id: 'g1', name: 'G' }, { id: 'g2' }], objects: [
    { id: 'm1', type: 'machine', b: 'Build_ConstructorMk1_C', k: 'Recipe_IronPlate_C', x: 1, y: 2, w: 8, h: 10, rot: 90, group: 'g1' },
    { id: 'm2', type: 'machine', b: 'Build_ConstructorMk1_C', k: 'NotARecipe', x: 'x', y: 1e9, w: -3, h: 10, rot: 45 },
    { id: 'm1', type: 'note', x: 0, y: 0 },
    { id: 'z', type: 'bogus' },
    { id: 'l1', type: 'link', from: 'm1', to: 'm2', name: 'ok' },
    { id: 'l2', type: 'link', from: 'm1', to: 'missing' },
    { id: 'n1', type: 'note', text: 'x'.repeat(5000), color: 'red', group: 'nope' },
  ] }], page: 'zzz', snap: 3 });
  const s = fresh(); s.layout = bad; const back = safeState(JSON.parse(JSON.stringify(s)));
  return { fresh: f.layout, bad, back: back.layout, none: normalizeLayout(null), legacy: safeState({ ...JSON.parse(JSON.stringify(fresh())), layout: undefined }).layout };
})()`, c)));
assert.deepEqual(r.fresh, { pages: [{ id: 'p1', name: '1F', objects: [], groups: [] }], page: 'p1', snap: 1, guides: true });
assert.deepEqual(r.none, r.fresh);
assert.deepEqual(r.legacy, r.fresh, 'old plans without a layout get an empty one');
const p = r.bad.pages[0];
assert.deepEqual(p.objects.map((o) => o.id), ['m1', 'm2', 'l1', 'n1'], 'duplicate ids, unknown types and dangling links dropped');
const [m1, m2, l1, n1] = p.objects;
assert.equal(m1.rot, 90); assert.equal(m1.k, 'Recipe_IronPlate_C'); assert.equal(m1.group, 'g1');
assert.equal(m2.k, null); assert.equal(m2.rot, 0); assert.equal(m2.x, 0); assert.equal(m2.y, 1e5); assert.equal(m2.w, 0.5);
assert.equal(l1.from, 'm1'); assert.equal(l1.to, 'm2');
assert.equal(n1.text.length, 2000); assert.equal(n1.color, ''); assert.equal(n1.group, null);
assert.deepEqual(p.groups, [{ id: 'g1', name: 'G' }], 'unused groups pruned');
assert.equal(r.bad.page, 'a'); assert.equal(r.bad.snap, 1);
assert.deepEqual(r.back, r.bad, 'layout survives save / load');
console.log('Factory layout normalization PASS');
