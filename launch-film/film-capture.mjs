// node film-capture.mjs <film.html|url> <out.mp4> [fps=60] [from=0] [to=DUR]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [target, out, fpsArg, fromArg, toArg] = process.argv.slice(2);
if (!target || !out) { console.error('usage: node film-capture.mjs <film.html|url> <out.mp4> [fps] [from] [to]'); process.exit(1); }
const FPS = +fpsArg || 60;
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const url = /^(https?|file):/.test(target) ? target : pathToFileURL(resolve(target)).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// private profile + port 0: never collides with a leftover Chrome from an interrupted run
const dir = mkdtempSync(join(tmpdir(), 'film-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--window-size=1920,1080', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--disk-cache-size=1', '--no-first-run', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch {} };
process.on('exit', cleanup); process.on('SIGINT', () => process.exit(130));

let port; for (let i = 0; i < 100 && !port; i++) { try { port = readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(100); } }
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result.result.value; };

await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: url + (url.includes('?') ? '&' : '?') + 't=0&clean' });
for (let i = 0; i < 200 && !(await ev('!!window.__film?.ready').catch(() => false)); i++) await sleep(100);
const DUR = await ev('__film.DUR'), from = +fromArg || 0, to = +toArg || DUR;

const wav = join(dir, 'score.wav');
const b64 = await ev(`(async()=>{const u=new Uint8Array(await __film.toWav(await __film.renderScore()).arrayBuffer());let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode(...u.subarray(i,i+0x8000));return btoa(s);})()`);
writeFileSync(wav, Buffer.from(b64, 'base64'));

const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
  '-ss', String(from), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', resolve(out)], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = new Promise(r => ff.on('close', r));
const N = Math.round((to - from) * FPS), t0 = Date.now();
for (let f = 0; f < N; f++) {
  await ev(`__film.render(${(from + f / FPS).toFixed(6)})`);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 95, fromSurface: true });
  if (!ff.stdin.write(Buffer.from(shot.result.data, 'base64'))) await new Promise(r => ff.stdin.once('drain', r));
  if (f % (FPS * 4) === 0) console.log(`frame ${f}/${N} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
ff.stdin.end();
const code = await ffDone; ws.close();
console.log(code === 0 ? `wrote ${out} (${N} frames, ${(to - from).toFixed(2)}s @ ${FPS}fps)` : `ffmpeg failed (${code})`);
process.exit(code);
