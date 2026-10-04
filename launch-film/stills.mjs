// node stills.mjs film.html outdir t1 t2 ...   (renders frames via __film.render, logs page errors)
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join, resolve } from 'node:path'; import { pathToFileURL } from 'node:url';
const [file,out,...ts]=process.argv.slice(2); mkdirSync(out,{recursive:true});
const dir=mkdtempSync(join(tmpdir(),'film-chrome-'));
const ch=spawn('/usr/bin/google-chrome-stable',['--headless=new','--remote-debugging-port=0','--window-size=1920,1080','--hide-scrollbars','--no-first-run',`--user-data-dir=${dir}`,'about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let port;for(let i=0;i<100&&!port;i++){try{port=readFileSync(join(dir,'DevToolsActivePort'),'utf8').split('\n')[0]}catch{await sleep(100)}}
const t=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x=>x.type==='page');
const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
let id=0;const P=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&P.has(m.id)){P.get(m.id)(m);P.delete(m.id)} else if(m.method==='Runtime.exceptionThrown') console.log('PAGE ERROR',m.params.exceptionDetails.exception?.description); else if(m.method==='Runtime.consoleAPICalled') console.log('console',m.params.args.map(a=>a.value).join(' '));};
const send=(method,params={})=>new Promise(r=>{const i=++id;P.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,awaitPromise:true,returnByValue:true}); if(r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value;};
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:pathToFileURL(resolve(file)).href+'?t=0&clean'});
for(let i=0;i<100&&!(await ev('!!window.__film?.ready').catch(()=>false));i++) await sleep(100);
if (process.env.PERF) console.log('perf', await ev(`(()=>{for(let t=0;t<__film.DUR;t+=.5)__film.render(t);const o={};for(const k in __film.S){const [a,b]=__film.S[k];let m=0,s=0,n=0;for(let t=a;t<b;t+=1/60){const q=performance.now();__film.render(t);const d=performance.now()-q;m=Math.max(m,d);s+=d;n++;}o[k]=(s/n).toFixed(1)+'/'+m.toFixed(1);}return JSON.stringify(o)})()`));
if (process.env.AUDIO) console.log('audio', await ev(`(async()=>{const b=await __film.renderScore();const d=b.getChannelData(0),sr=b.sampleRate;let pk=0;for(const v of d)pk=Math.max(pk,Math.abs(v));const seg=[];for(const k in __film.S){const [a,e]=__film.S[k];let s=0,n=0;for(let i=Math.floor(a*sr);i<Math.min(d.length,e*sr);i++){s+=d[i]*d[i];n++;}seg.push(k+':'+(10*Math.log10(s/n)).toFixed(1));}return 'peak '+pk.toFixed(3)+' | rms dBFS '+seg.join(' ');})()`));
for(const tt of ts){ await ev(`__film.render(${tt})`); await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const s=await send('Page.captureScreenshot',{format:'png'}); writeFileSync(join(out,`${String(tt).padStart(5,'0')}.png`),Buffer.from(s.result.data,'base64')); }
ws.close(); ch.kill('SIGKILL'); await sleep(300); try{rmSync(dir,{recursive:true,force:true})}catch{} process.exit(0);
