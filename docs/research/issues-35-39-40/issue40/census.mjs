import fs from 'node:fs';
const dir = new URL('./node_modules/libcascade/dist/', import.meta.url);
const syms = new Map(fs.readFileSync(new URL('opencascade_single.js.symbols', dir),'utf8').split('\n').filter(Boolean).map(l=>{const i=l.indexOf(':');return [+l.slice(0,i), l.slice(i+1)]}));
// body sizes
const buf=fs.readFileSync(new URL('opencascade_single.wasm',dir));
let p=8; const leb=()=>{let r=0,s=0,b;do{b=buf[p++];r|=(b&0x7f)<<s;s+=7}while(b&0x80);return r>>>0};
let nImp=0; const bodySize=[]; const impNames=[];
while(p<buf.length){const id=buf[p++];const size=leb();const end=p+size;
 if(id===2){const n=leb();for(let i=0;i<n;i++){let l=leb();const mod=buf.slice(p,p+l).toString();p+=l;l=leb();const nm=buf.slice(p,p+l).toString();p+=l;const k=buf[p++];
   if(k===0){leb();impNames.push(mod+'.'+nm);nImp++}else if(k===1){p++;const f=leb();leb();if(f&1)leb()}else if(k===2){const f=leb();leb();if(f&1)leb()}else if(k===3){p+=2}else if(k===4){p++;leb()}}}
 if(id===10){const n=leb();for(let i=0;i<n;i++){const s=leb();bodySize.push(s);p+=s}}
 p=end}
const regIdx=[...syms].find(([i,n])=>n==='_embind_register_class')[0];
const [rmod,rname]=impNames[regIdx].split('.');
const regs=[];
const origInst = WebAssembly.instantiate;
let table, mem;
WebAssembly.instantiate = async function(src, imports){
  const orig = imports[rmod][rname];
  imports[rmod][rname] = function(...a){ regs.push(a); return orig.apply(this,a); };
  const r = await origInst.call(this, src, imports);
  const inst = r.instance || r; for (const v of Object.values(inst.exports)) if (v instanceof WebAssembly.Table) table = v;
  return r;
};
const { createInstance } = await import('libcascade/single/init');
const oc = await createInstance();
const exps = Object.values(oc).filter(v=>v instanceof WebAssembly.Table);
// find table via exports of instance: use oc.wasmTable if present
table = table || oc.wasmTable || exps[0];
if(!table){ console.log('no table; keys', Object.keys(oc).filter(k=>/table/i.test(k))); process.exit(1);}
const u8 = new Uint8Array(oc.wasmMemory.buffer);
const cstr = (ptr)=>{let e=ptr;while(u8[e])e++;return Buffer.from(u8.subarray(ptr,e)).toString()};
let noop=0, real=0; const byFn=new Map(); const realNames=[];
for (const a of regs) {
  const name=cstr(a[10]); const dtorPtr=a[12];
  const f=table.get(dtorPtr); const fi=+f.name; const sz=bodySize[fi-nImp];
  const isNoop = sz<=2;
  if(isNoop) noop++; else {real++; realNames.push(name);}
  byFn.set(fi,(byFn.get(fi)||0)+1);
}
console.log('classes registered', regs.length, 'noop raw_destructor', noop, 'real', real);
console.log('top destructor fns', [...byFn].sort((x,y)=>y[1]-x[1]).slice(0,8).map(([fi,c])=>[fi,c,bodySize[fi-nImp],syms.get(fi)?.slice(0,90)]));
fs.writeFileSync('real-dtor-classes.txt', realNames.join('\n'));
const want=['NCollection_Array1_gp_Pnt','BRepAlgoAPI_Cut','BRepFilletAPI_MakeFillet','BRepPrimAPI_MakeBox','TopoDS_Shape','gp_Pnt','Message_ProgressRange','Geom_BSplineCurve','BRepBuilderAPI_MakeEdge','TopExp_Explorer','STEPControl_Reader','BRepMesh_IncrementalMesh'];
for(const a of regs){const n=cstr(a[10]); if(want.includes(n)){const f=table.get(a[12]);console.log(n, '->', f.name, 'bodysize', bodySize[+f.name-nImp]);}}
