// usage: node wasmfn.cjs file.wasm funcIndex...  -> prints code-section-relative start/end offsets
const fs=require('fs'); const buf=fs.readFileSync(process.argv[2]);
let p=8; const leb=()=>{let r=0,s=0,b;do{b=buf[p++];r|=(b&0x7f)<<s;s+=7}while(b&0x80);return r>>>0};
let nImp=0, codeStart=0, bodies=[];
while(p<buf.length){const id=buf[p++];const size=leb();const end=p+size;
 if(id===2){const n=leb();for(let i=0;i<n;i++){let l=leb();p+=l;l=leb();p+=l;const k=buf[p++];
   if(k===0){leb();nImp++}else if(k===1){p++;const f=leb();leb();if(f&1)leb()}else if(k===2){const f=leb();leb();if(f&1)leb()}else if(k===3){p+=2}else if(k===4){p++;leb()}}}
 if(id===10){codeStart=p;const n=leb();for(let i=0;i<n;i++){const s=leb();bodies.push([p-codeStart,p+s-codeStart]);p+=s}}
 p=end}
console.log('imports',nImp,'defined',bodies.length);
for(const a of process.argv.slice(3)){const i=+a-nImp;console.log(a, bodies[i] && bodies[i].map(x=>'0x'+x.toString(16)).join(' '))}
