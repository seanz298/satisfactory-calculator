// Disposable local acceptance page; never publish dist/live-links-acceptance.html.
// Generate after building, then open /live-links-acceptance.html in the preview.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {environment} = require('./integration.cjs');
const context = environment();
const seed = vm.runInContext(`(() => {
  const a=fresh(); a.planUid='accept-source';
  a.supplies=[{id:'Desc_OreIron_C',q:100,stop:true}];
  a.products=[{id:'Desc_IronIngot_C',q:100,lock:true}];
  const b=fresh(); b.planUid='accept-receiver';
  b.supplies=[{id:'Desc_IronIngot_C',q:80,stop:true}];
  b.products=[{id:'Desc_IronPlate_C',q:40,lock:true}];
  const c=fresh(); c.planUid='accept-other';
  c.supplies=[{id:'Desc_IronIngot_C',q:30,stop:true}];
  c.products=[{id:'Desc_IronPlate_C',q:20,lock:true}];
  const w=emptyWorkspace();
  w.plans=[{id:1,name:'验收来源',kind:'new',state:a},{id:2,name:'验收接收一',kind:'new',state:b},{id:3,name:'验收接收二',kind:'new',state:c}];
  w.active={id:2,name:'验收接收一',kind:'new',state:b}; w.nextId=4;
  return w;
})()`, context);
const root = path.resolve(__dirname, '..');
const script = `<script>if(!sessionStorage.getItem('live-links-acceptance')) {localStorage.setItem('factory-workspace-12',${JSON.stringify(JSON.stringify(seed))});sessionStorage.setItem('live-links-acceptance','1');}</script>`;
fs.mkdirSync(path.join(root,'dist'), {recursive:true});
fs.writeFileSync(path.join(root,'dist/live-links-acceptance.html'), fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<head>', '<head>'+script));
console.log('Created disposable acceptance page with three plans. Reload preserves edits.');
