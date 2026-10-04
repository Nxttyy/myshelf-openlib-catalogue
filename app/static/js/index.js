const isDesktop = !('ontouchstart' in window) && window.innerWidth > 768;
let currentDrawerUbId = null;

// ── Lazy-load scan-modal-only libraries ──────────────────────
// Quagga (barcode) and qrcodejs used to load unconditionally in <head> on
// every page view even though most visits never open the scan modal. Load
// them on demand instead, the first time they're actually needed.
const _loadedScripts = new Set();
function loadScriptOnce(src) {
  if (_loadedScripts.has(src)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { _loadedScripts.add(src); resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}
const loadQuagga = () => loadScriptOnce('https://unpkg.com/@ericblade/quagga2/dist/quagga.min.js');
const loadQRCode = () => loadScriptOnce('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js');

// ── View switching ────────────────────────────────────────
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + view);
  if (el) { el.classList.remove('f-rise'); void el.offsetWidth; el.classList.add('active','f-rise'); }
  document.querySelectorAll('.d-navlink').forEach(l => { l.classList.toggle('on', l.dataset.nav === view); });
  document.querySelectorAll('.f-tab').forEach(t => { t.classList.toggle('active', t.dataset.tab === view); });
  history.replaceState(null, '', '#' + view);
}

// ── Shelf / Hauls toggle (profile) ────────────────────────
function switchShelfMode(mode, btn) {
  document.querySelectorAll('.d-viewseg button').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('shelf-view').style.display = mode === 'shelf' ? '' : 'none';
  document.getElementById('hauls-view').style.display = mode === 'hauls' ? '' : 'none';
  document.getElementById('collection-hint').style.display = mode === 'shelf' ? '' : 'none';
}

// ── Library filter chips ──────────────────────────────────
function filterLib(btn, filter) {
  document.querySelectorAll('.d-chip').forEach(c => c.classList.remove('on'));
  btn.classList.add('on');
  document.querySelectorAll('#lib-grid .d-cell').forEach(cell => {
    cell.style.display = (filter === 'all' || cell.dataset.status === filter) ? '' : 'none';
  });
}

// ── Drawer ────────────────────────────────────────────────
function openDrawer(bookId) {
  const src = document.getElementById('drawer-' + bookId);
  if (!src) return;
  currentDrawerUbId = src.dataset.ubId;
  document.getElementById('drawer-body').innerHTML = src.innerHTML;
  document.getElementById('drawer-scrim').classList.add('open');
  document.getElementById('detail-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function openExploreDrawer(bookId) {
  const src = document.getElementById('drawer-' + bookId);
  if (!src) return;
  currentDrawerUbId = null;
  document.getElementById('drawer-body').innerHTML = src.innerHTML;
  document.getElementById('drawer-scrim').classList.add('open');
  document.getElementById('detail-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeDrawer() {
  document.getElementById('drawer-scrim').classList.remove('open');
  document.getElementById('detail-drawer').classList.remove('open');
  document.body.style.overflow = '';
}

// Add an existing community book to the current user's shelf.
async function addToShelf(bookId, btn) {
  const orig = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Adding…';
  try {
    const res = await fetch(`/books/user_books/add/${bookId}`, { method: 'POST' });
    if (res.ok) {
      btn.classList.remove('f-btn--amber');
      btn.classList.add('f-btn--ghost');
      btn.style.opacity = '0.7';
      btn.style.cursor = 'default';
      btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg> On your shelf';
      pushToast('Added to your shelf', 'ok');
    } else if (res.status === 401) {
      window.location.href = '/login';
    } else {
      btn.disabled = false;
      btn.innerHTML = orig;
      pushToast('Could not add book', 'err');
    }
  } catch {
    btn.disabled = false;
    btn.innerHTML = orig;
    pushToast('Connection error', 'err');
  }
}

function drawerStatusChange(sel) {
  const badge = document.querySelector('.drawer-status-badge');
  if (!badge) return;
  const v = sel.value;
  badge.dataset.s = v;
  badge.innerHTML = `<span class="pip"></span>${v.charAt(0).toUpperCase()+v.slice(1)}`;
}

async function saveDrawerChanges() {
  if (!currentDrawerUbId) return;
  const body = document.getElementById('drawer-body');
  const status    = body.querySelector('.drawer-status-select').value;
  const is_public = body.querySelector('.drawer-vis-select').value === 'true';
  const comment   = body.querySelector('.drawer-comment-textarea').value;
  const btn = body.querySelector('.f-btn--amber');
  const orig = btn.innerHTML;
  btn.innerHTML = 'Saving…';
  try {
    const res = await fetch(`/books/user_books/${currentDrawerUbId}`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({status, is_public, comment}),
    });
    if (res.ok) {
      pushToast('Saved', 'ok');
      // Update the grid cell status badge
      document.querySelectorAll(`.d-cell[onclick*="openDrawer"]`).forEach(cell => {
        const badge = cell.querySelector('.f-status');
        if (badge && cell.getAttribute('onclick').includes(currentDrawerUbId.slice(-4))) return; // rough match not ideal
      });
      setTimeout(closeDrawer, 600);
    } else { pushToast('Error saving', 'err'); }
  } catch { pushToast('Connection error', 'err'); }
  btn.innerHTML = orig;
}

// ── Profile visibility ────────────────────────────────────
function setVis(val, btn) {
  document.querySelectorAll('.d-vis-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const shareWrap = document.getElementById('share-btn-wrap');
  if (shareWrap) shareWrap.style.display = val === 'public' ? '' : 'none';
  fetch('/auth/profile', {method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_profile_public: val==='public'})});
}

// ── Edit username ─────────────────────────────────────────
function startEditUsername() {
  document.getElementById('handle-display').style.display = 'none';
  document.getElementById('handle-edit-btn').style.display = 'none';
  const edit = document.getElementById('handle-edit');
  edit.style.display = 'inline-flex';
  const input = document.getElementById('username-input');
  input.focus(); input.select();
}
function cancelEditUsername() {
  document.getElementById('handle-edit').style.display = 'none';
  document.getElementById('handle-display').style.display = '';
  document.getElementById('handle-edit-btn').style.display = '';
}
async function saveUsername(btn) {
  const input = document.getElementById('username-input');
  const uname = input.value.trim().toLowerCase();
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await fetch('/auth/username', {
      method: 'PATCH', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username: uname}),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const u = data.username || uname;
      document.getElementById('handle-text').textContent = u;
      document.getElementById('handle-display').lastChild.textContent = ` · dora.club/@${u}`;
      const link = document.getElementById('share-link-text');
      if (link) link.textContent = `/u/${u}`;
      cancelEditUsername();
      pushToast('Username updated', 'ok');
    } else {
      pushToast(data.detail || 'Could not update username', 'err');
    }
  } catch {
    pushToast('Connection error', 'err');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

// ── Share popover ─────────────────────────────────────────
function toggleShare() {
  const pop = document.getElementById('share-pop');
  if (!pop) return;
  pop.classList.toggle('open');
  if (pop.classList.contains('open')) {
    document.addEventListener('click', closeShareOnOutside, true);
  }
}
function closeShareOnOutside(e) {
  const wrap = document.querySelector('.d-share-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('share-pop').classList.remove('open');
    document.removeEventListener('click', closeShareOnOutside, true);
  }
}
function copyProfileLink() {
  const linkEl = document.getElementById('share-link-text');
  if (!linkEl) return;
  const url = window.location.origin + linkEl.textContent.trim();
  navigator.clipboard.writeText(url).then(() => pushToast('Profile link copied', 'ok')).catch(() => pushToast('Could not copy', 'err'));
  document.getElementById('share-pop').classList.remove('open');
}

// ── Pin book ──────────────────────────────────────────────
async function togglePin(btn) {
  const ubId = btn.dataset.ubId;
  const isPinned = btn.dataset.pinned === 'true';
  const newPinned = !isPinned;
  try {
    const res = await fetch(`/books/user_books/${ubId}`, {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({is_pinned: newPinned}),
    });
    if (res.ok) {
      // Unpin all other pin buttons
      if (newPinned) {
        document.querySelectorAll('.d-pin.pinned').forEach(b => {
          if (b !== btn) { b.classList.remove('pinned'); b.dataset.pinned = 'false'; b.title = 'Pin to top'; }
        });
      }
      btn.classList.toggle('pinned', newPinned);
      btn.dataset.pinned = String(newPinned);
      btn.title = newPinned ? 'Unpin' : 'Pin to top';
      pushToast(newPinned ? 'Pinned to top' : 'Unpinned', 'ok');
      // Reload to reorder the grid
      setTimeout(() => { window.location.hash='#profile'; window.location.reload(); }, 800);
    } else { pushToast('Error updating pin', 'err'); }
  } catch { pushToast('Connection error', 'err'); }
}

// ── Modal ─────────────────────────────────────────────────
const MODAL_TABS = ['scan', 'manual', 'search', 'create'];
function switchModalTab(tab) {
  for (const t of MODAL_TABS) {
    document.getElementById('tab-' + t).style.display = t === tab ? 'block' : 'none';
    const btn = document.getElementById('tab-btn-' + t);
    btn.classList.toggle('on', t === tab);
    // The strip scrolls on narrow screens — keep the active tab in view.
    if (t === tab) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (tab === 'scan') {
    if (isDesktop) initDesktopScan(); else startScanner();
  } else {
    stopDesktopPolling(); stopScanner();
  }
  if (tab === 'search') document.getElementById('search-query').focus();
  if (tab === 'create') document.getElementById('create-title').focus();
}

// ── Toast ─────────────────────────────────────────────────
// Queue a toast for after a full page reload, which a live toast wouldn't survive.
function flashAfterReload(msg, kind) {
  sessionStorage.setItem('flashToast', JSON.stringify({ msg, kind }));
}

let _tid = 0;
function pushToast(msg, kind='ok') {
  const wrap = document.getElementById('toast-wrap');
  const id = ++_tid;
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `<span class="tdot"></span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 200); }, 2200);
}

// ── Scanner ───────────────────────────────────────────────
let scanQueue = [];
let scanSessionToken = null;
let scanPollingInterval = null;
let scanSeenCount = 0;
let scanPollFailures = 0;
let qrCodeInstance = null;
let nativeStream = null;
let nativeScanLoop = null;
let quaggaRunning = false;
let scanPaused = false;

function extractISBN(raw) {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9X]/gi,'').toUpperCase();
  if (digits.length >= 13 && /^97[89]/.test(digits)) return digits.slice(0,13);
  if (/^[0-9]{9}[0-9X]$/.test(digits)) return digits;
  return null;
}

const _quaggaHandler = (result) => {
  const errs = result.codeResult.decodedCodes.filter(c=>c.error!==undefined).map(c=>c.error);
  if (errs.length && errs.reduce((a,b)=>a+b,0)/errs.length > 0.15) return;
  const isbn = extractISBN(result.codeResult.code);
  if (isbn && !queueHasKey(isbn)) appendQueue(isbn);
};

async function startScanner() {
  if ('BarcodeDetector' in window) {
    try { const f = await BarcodeDetector.getSupportedFormats(); if (f.includes('ean_13')){ startNativeScanner(); return; } } catch {}
  }
  startQuaggaScanner();
}

async function startNativeScanner() {
  const reader = document.getElementById('reader');
  try {
    nativeStream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}}});
    const video = document.createElement('video');
    video.srcObject = nativeStream; video.setAttribute('playsinline','');
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    reader.innerHTML = ''; reader.appendChild(video); await video.play();
    const detector = new BarcodeDetector({formats:['ean_13','ean_8','upc_a','upc_e']});
    const detect = async () => {
      if (!nativeStream || scanPaused) { nativeScanLoop = requestAnimationFrame(detect); return; }
      try { for (const {rawValue} of await detector.detect(video)) { const isbn=extractISBN(rawValue); if(isbn&&!queueHasKey(isbn))appendQueue(isbn); } } catch {}
      nativeScanLoop = requestAnimationFrame(detect);
    };
    nativeScanLoop = requestAnimationFrame(detect);
  } catch (err) { stopNativeScanner(); startQuaggaScanner(); }
}

async function startQuaggaScanner() {
  const reader = document.getElementById('reader');
  reader.innerHTML = '<div style="padding:20px;text-align:center;color:#fff;font-size:13px;">Loading scanner…</div>';
  await loadQuagga();
  reader.innerHTML = '';
  Quagga.init({
    inputStream:{type:'LiveStream',target:reader,constraints:{facingMode:'environment',width:{ideal:1280},height:{ideal:720}}},
    decoder:{readers:['ean_reader','ean_8_reader','upc_reader','upc_e_reader']}, locate:true,
  }, (err) => {
    if (err) { reader.innerHTML=`<div style="padding:20px;text-align:center;color:#fff;font-size:13px;">Camera unavailable.</div>`; return; }
    quaggaRunning = true; Quagga.start(); Quagga.onDetected(_quaggaHandler);
  });
}

function stopNativeScanner() {
  if (nativeScanLoop) { cancelAnimationFrame(nativeScanLoop); nativeScanLoop=null; }
  if (nativeStream) { nativeStream.getTracks().forEach(t=>t.stop()); nativeStream=null; }
}
function stopQuaggaScanner() {
  if (quaggaRunning) { Quagga.offDetected(_quaggaHandler); Quagga.stop(); quaggaRunning=false; }
}
function stopScanner() { stopNativeScanner(); stopQuaggaScanner(); }

function toggleScanPause() {
  scanPaused = !scanPaused;
  const btn = document.getElementById('cam-pause-btn');
  const line = document.getElementById('scan-line');
  if (btn) btn.textContent = scanPaused ? 'Resume' : 'Pause';
  if (line) line.style.animationPlayState = scanPaused ? 'paused' : 'running';
  if (quaggaRunning) { scanPaused ? Quagga.stop() : Quagga.start(); }
}

async function initDesktopScan() {
  document.getElementById('scan-desktop').style.display = 'block';
  document.getElementById('scan-camera').style.display = 'none';
  document.getElementById('qr-code').innerHTML = '';
  document.getElementById('desktop-scan-status').textContent = 'Creating scan session…';
  try {
    const res = await fetch('/scan/session', {method:'POST'});
    const data = await res.json();
    scanSessionToken = data.token;
    document.getElementById('scan-url-text').textContent = data.scan_url;
    document.getElementById('desktop-scan-status').textContent = 'Waiting for phone to scan books…';
    if (qrCodeInstance) { try { qrCodeInstance.clear(); } catch {} }
    await loadQRCode();
    qrCodeInstance = new QRCode(document.getElementById('qr-code'), {
      text:data.scan_url, width:180, height:180,
      colorDark:'#1A1714', colorLight:'#ffffff', correctLevel:QRCode.CorrectLevel.M,
    });
    scanSeenCount = 0;
    scanPollFailures = 0;
    scanPollingInterval = setInterval(pollScanSession, 2000);
  } catch { switchToCamera(); }
}

async function pollScanSession() {
  if (!scanSessionToken) return;
  try {
    const res = await fetch(`/scan/session/${scanSessionToken}/items?after=${scanSeenCount}`);
    if (res.status === 404) {
      // Session is genuinely gone (expired / never existed) — start a fresh one
      // so the QR code is scannable again instead of silently dying.
      stopDesktopPolling();
      initDesktopScan();
      return;
    }
    if (!res.ok) {
      // Transient error (network blip, restart) — keep polling, give up only
      // after several consecutive failures.
      if (++scanPollFailures >= 5) { stopDesktopPolling(); switchToCamera(); }
      return;
    }
    scanPollFailures = 0;
    const data = await res.json();
    if (data.isbns.length > 0) {
      for (const isbn of data.isbns) appendQueue(isbn);
      scanSeenCount += data.isbns.length;
      document.getElementById('desktop-scan-status').textContent = `${scanSeenCount} book${scanSeenCount!==1?'s':''} scanned from phone`;
    }
  } catch {
    if (++scanPollFailures >= 5) { stopDesktopPolling(); switchToCamera(); }
  }
}

function switchToCamera() {
  stopDesktopPolling();
  document.getElementById('scan-desktop').style.display = 'none';
  document.getElementById('scan-camera').style.display = 'block';
  const showQR = document.getElementById('show-qr-btn');
  if (showQR) showQR.style.display = isDesktop ? 'flex' : 'none';
  startScanner();
}

function switchToQR() {
  stopScanner();
  document.getElementById('scan-camera').style.display = 'none';
  initDesktopScan();
}

function stopDesktopPolling() {
  if (scanPollingInterval) { clearInterval(scanPollingInterval); scanPollingInterval=null; }
  scanSessionToken = null;
}

function openAddModal() {
  document.getElementById('add-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
  if (document.getElementById('tab-scan').style.display !== 'none') {
    if (isDesktop) initDesktopScan(); else startScanner();
  }
}

function closeAddModal() {
  document.getElementById('add-modal').classList.remove('active');
  document.body.style.overflow = '';
  stopDesktopPolling(); stopScanner(); closeCoverCamera();
}

function addManualIsbn() {
  const val = document.getElementById('manual-isbn').value.trim();
  if (val) { appendQueue(val); document.getElementById('manual-isbn').value = ''; }
}

// ── Title search ──────────────────────────────────────────
let searchDebounce = null;
let searchSeq = 0;
function onSearchInput() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(runBookSearch, 700);
}
// One result row, used for both Open Library hits and local-catalogue hits.
// `spec` = {key, title, meta, cover_url, tag, askDora, onAdd}
function makeResultRow(spec) {
  const row = document.createElement('div');
  row.className = 'd-queue-chip d-chip-taste';
  row.innerHTML = `
    <div class="top">
      <div class="d-queue-chip-cover" style="background:var(--ink-blue);display:flex;align-items:center;justify-content:center;">
        ${spec.cover_url ? `<img src="${doraEsc(spec.cover_url)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.remove()">`
          : BOOK_ICON}
      </div>
      <div style="flex:1;min-width:0;">
        <div class="d-queue-chip-title">${doraEsc(spec.title || 'Untitled')}</div>
        <div class="d-queue-chip-isbn">${doraEsc(spec.meta || '—')}</div>
        ${spec.tag ? `<div style="margin-top:4px;"><span class="d-tag-manual">${doraEsc(spec.tag)}</span></div>` : ''}
      </div>
      <button class="f-btn f-btn--ink add-result-btn" style="padding:0 14px;flex-shrink:0;">${queueHasKey(spec.key) ? 'Added' : 'Add'}</button>
    </div>
    <div class="d-chip-taste-slot"></div>
  `;
  if (spec.askDora) mountAskDora(row, spec.askDora);
  const btn = row.querySelector('.add-result-btn');
  btn.onclick = () => {
    if (queueHasKey(spec.key)) return;
    spec.onAdd();
    btn.textContent = 'Added';
  };
  return row;
}

async function runBookSearch() {
  clearTimeout(searchDebounce);
  const q = document.getElementById('search-query').value.trim();
  const box = document.getElementById('search-results');
  if (q.length < 2) { box.innerHTML = ''; return; }
  const seq = ++searchSeq;
  box.innerHTML = `<div class="d-queue-empty-msg">Searching…</div>`;

  // Books other users typed in by hand exist only in our catalogue, so search
  // both sources. A failure on either side shouldn't blank the other.
  const [local, remote] = await Promise.all([
    fetch(`/books/search/local?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : []).catch(() => null),
    fetch(`/books/search?q=${encodeURIComponent(q)}`).then(r => r.ok ? r.json() : []).catch(() => null),
  ]);
  if (seq !== searchSeq) return;  // a newer search superseded this one

  if (local === null && remote === null) {
    box.innerHTML = `<div class="d-queue-empty-msg">Connection error.</div>`;
    return;
  }
  const localResults = local || [], remoteResults = remote || [];
  if (!localResults.length && !remoteResults.length) {
    box.innerHTML = `<div class="d-queue-empty-msg">No matches found.<br>You can still add it by hand.</div>`;
    return;
  }

  box.innerHTML = '';
  if (localResults.length) {
    const head = document.createElement('div');
    head.className = 'd-results-head';
    head.textContent = 'Already on Dora';
    box.appendChild(head);
    for (const b of localResults) {
      box.appendChild(makeResultRow({
        key: b.book_id,
        title: b.title,
        meta: [b.authors?.join(', '), b.publish_date].filter(Boolean).join(' · '),
        cover_url: b.cover_url,
        tag: b.source === 'manual' ? (b.added_by ? `Added by @${b.added_by}` : 'Community entry') : null,
        askDora: () => ({ title: b.title || '', authors: b.authors || [], isbn: b.isbn || null, context: null }),
        onAdd: () => appendCatalogueBook(b),
      }));
    }
  }
  if (remoteResults.length) {
    const head = document.createElement('div');
    head.className = 'd-results-head';
    head.textContent = localResults.length ? 'From Open Library' : '';
    if (head.textContent) box.appendChild(head);
    for (const b of remoteResults) {
      box.appendChild(makeResultRow({
        key: b.key,
        title: b.title,
        meta: [b.authors?.join(', '), b.first_publish_year].filter(Boolean).join(' · '),
        cover_url: b.cover_url,
        askDora: () => ({
          title: b.title || '',
          authors: b.authors || [],
          isbn: (b.isbns && b.isbns[0]) || null,
          context: b.first_publish_year ? `First published ${b.first_publish_year}` : null,
        }),
        onAdd: () => appendSearchResult(b),
      }));
    }
  }
}

// ── Add a book by hand ────────────────────────────────────
// For books with no copy to scan and no Open Library record. The cover is
// uploaded as soon as it's picked (presign → POST to bucket); the catalogue row
// itself is only created when the queue is saved, so an abandoned modal leaves
// nothing behind.
let manualCoverKey = null;

function setCoverBusy(on) {
  const pick = document.getElementById('create-cover-pick');
  pick.querySelector('.d-cover-busy')?.remove();
  if (on) pick.insertAdjacentHTML('beforeend', '<div class="d-cover-busy">Uploading…</div>');
}

function pickManualCover(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (file) uploadManualCover(file);
}

// Shared by the file picker and the camera: preview immediately, then
// presign → POST straight to the bucket. The key is handed to the create call.
async function uploadManualCover(file) {
  if (file.size > 10 * 1024 * 1024) return pushToast('Image is too large (max 10MB)', 'err');

  const pick = document.getElementById('create-cover-pick');
  const previewUrl = URL.createObjectURL(file);
  pick.classList.add('has');
  pick.querySelector('img')?.remove();
  pick.insertAdjacentHTML('afterbegin', `<img src="${previewUrl}" alt="">`);
  setCoverBusy(true);

  try {
    const pres = await fetch('/books/covers/presign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: file.type, byte_size: file.size }),
    });
    if (pres.status === 401) { clearManualCover(); return pushToast('Sign in to upload a cover', 'err'); }
    if (!pres.ok) { clearManualCover(); return pushToast('Could not start the upload', 'err'); }
    const p = await pres.json();

    const form = new FormData();
    Object.entries(p.fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', file);
    const up = await fetch(p.upload_url, { method: 'POST', body: form });
    if (!up.ok) { clearManualCover(); return pushToast('Cover upload failed', 'err'); }

    manualCoverKey = p.key;
    setCoverBusy(false);
    if (!pick.querySelector('.d-cover-clear')) {
      pick.insertAdjacentHTML('beforeend',
        `<button type="button" class="d-cover-clear" title="Remove cover" onclick="event.preventDefault();event.stopPropagation();clearManualCover()">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M18 6 6 18M6 6l12 12"/></svg>
         </button>`);
    }
  } catch {
    clearManualCover();
    pushToast('Cover upload failed', 'err');
  }
}

function clearManualCover() {
  manualCoverKey = null;
  const pick = document.getElementById('create-cover-pick');
  pick.classList.remove('has');
  pick.querySelector('img')?.remove();
  pick.querySelector('.d-cover-clear')?.remove();
  setCoverBusy(false);
}

// Shoot the cover in-app instead of hunting for a file — same getUserMedia
// sheet the comment-photo camera uses, reusing its overlay root and styles.
// It renders above the add modal (z-index 71 vs the modal's 60).
let coverCamStream = null;

async function openCoverCamera() {
  try {
    coverCamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    pushToast('Could not access the camera', 'err');
    return;
  }
  document.getElementById('photo-overlay-root').innerHTML = `
    <div class="d-cam-scrim" onclick="closeCoverCamera()"></div>
    <div class="d-camsheet">
      <div class="hd">
        <span class="f-label">Camera · frame the cover</span>
        <button class="f-iconbtn" style="width:30px;height:30px;" onclick="closeCoverCamera()" aria-label="Close camera"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
      </div>
      <div class="f-cam" id="cover-cam-viewport">
        <video id="cover-cam-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
        <div class="f-reticle"><span class="c1"></span><span class="c2"></span></div>
      </div>
      <div class="ft">
        <span class="caption" style="flex:1;font-size:12.5px;color:var(--ink-soft);">One shot becomes the cover</span>
        <button class="d-shutter" onclick="snapCoverPhoto()" aria-label="Capture"><span></span></button>
        <button class="f-btn f-btn--ink" style="padding:8px 16px;font-size:12.5px;margin-left:auto;" onclick="closeCoverCamera()">Cancel</button>
      </div>
    </div>`;
  document.getElementById('cover-cam-video').srcObject = coverCamStream;
}

async function snapCoverPhoto() {
  const video = document.getElementById('cover-cam-video');
  if (!video || !video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  const viewport = document.getElementById('cover-cam-viewport');
  if (viewport) {
    const fl = document.createElement('div');
    fl.className = 'lb-flash';
    viewport.appendChild(fl);
    setTimeout(() => fl.remove(), 260);
  }
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
  if (!blob) return;
  closeCoverCamera();
  // A second shot replaces the first; only one cover per book.
  await uploadManualCover(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
}

function closeCoverCamera() {
  if (coverCamStream) { coverCamStream.getTracks().forEach(t => t.stop()); coverCamStream = null; }
  document.getElementById('photo-overlay-root').innerHTML = '';
}

// Live duplicate check — the catalogue is shared, so steer people to an
// existing entry before they type a second copy of it.
let manualDupeDebounce = null;
let manualDupeSeq = 0;
function onManualTitleInput() {
  clearTimeout(manualDupeDebounce);
  manualDupeDebounce = setTimeout(runManualDupeCheck, 600);
}
async function runManualDupeCheck() {
  const q = document.getElementById('create-title').value.trim();
  const box = document.getElementById('create-dupes');
  if (q.length < 3) { box.style.display = 'none'; box.innerHTML = ''; return; }
  const seq = ++manualDupeSeq;
  try {
    const res = await fetch(`/books/search/local?q=${encodeURIComponent(q)}&limit=3`);
    if (seq !== manualDupeSeq || !res.ok) return;
    const results = await res.json();
    if (!results.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.innerHTML = `<div class="d-dupe-note">Already on Dora — add one of these instead?</div>`;
    for (const b of results) {
      box.appendChild(makeResultRow({
        key: b.book_id,
        title: b.title,
        meta: [b.authors?.join(', '), b.publish_date].filter(Boolean).join(' · '),
        cover_url: b.cover_url,
        tag: b.source === 'manual' ? (b.added_by ? `Added by @${b.added_by}` : 'Community entry') : null,
        onAdd: () => { appendCatalogueBook(b); resetManualForm(); },
      }));
    }
    box.style.display = '';
  } catch {}
}

function splitList(value) {
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

function resetManualForm() {
  for (const id of ['create-title','create-authors','create-subtitle','create-publisher',
                    'create-year','create-pages','create-isbn','create-subjects','create-description']) {
    document.getElementById(id).value = '';
  }
  clearManualCover();
  const dupes = document.getElementById('create-dupes');
  dupes.style.display = 'none'; dupes.innerHTML = '';
  document.querySelector('.d-create-more').open = false;
}

function readManualForm() {
  const title = document.getElementById('create-title').value.trim();
  if (!title) { pushToast('A title is required', 'err'); document.getElementById('create-title').focus(); return null; }
  const pagesRaw = parseInt(document.getElementById('create-pages').value, 10);
  return {
    title,
    authors: splitList(document.getElementById('create-authors').value),
    subtitle: document.getElementById('create-subtitle').value.trim() || null,
    publishers: splitList(document.getElementById('create-publisher').value),
    publish_date: document.getElementById('create-year').value.trim() || null,
    number_of_pages: Number.isFinite(pagesRaw) ? pagesRaw : null,
    isbns: splitList(document.getElementById('create-isbn').value),
    subjects: splitList(document.getElementById('create-subjects').value),
    description: document.getElementById('create-description').value.trim() || null,
    cover_key: manualCoverKey,
  };
}

function submitManualForm() {
  if (manualEditBookId) saveManualEdit(); else addManualBook();
}

let manualDraftSeq = 0;
function addManualBook() {
  const draft = readManualForm();
  if (!draft) return;

  const coverImg = document.querySelector('#create-cover-pick img');
  const key = 'manual:' + (++manualDraftSeq);
  const cover = coverImg ? `<img src="${coverImg.src}" style="width:100%;height:100%;object-fit:cover;">` : BOOK_ICON;
  const sub = draft.authors.join(', ') || 'Added by hand';
  makeChip(key, cover, draft.title, sub);
  scanQueue.push({ key, manual: draft });
  updateQueueBadge();
  pushToast('Added · ' + draft.title, 'ok');
  resetManualForm();
  document.getElementById('create-title').focus();
}

// ── Editing a manual entry you created ────────────────────
let manualEditBookId = null;

function setManualEditMode(on) {
  manualEditBookId = on ? manualEditBookId : null;
  document.getElementById('create-submit').textContent = on ? 'Save changes' : 'Add to queue';
  document.getElementById('create-cancel-edit').style.display = on ? '' : 'none';
  document.getElementById('create-hint').textContent = on
    ? 'Corrections apply everywhere this book appears, including other readers’ shelves.'
    : 'Saved to the shared catalogue, so anyone searching for it later will find your entry. You can edit it afterwards.';
  // The duplicate check would just match the book being edited.
  const dupes = document.getElementById('create-dupes');
  if (on) { dupes.style.display = 'none'; dupes.innerHTML = ''; }
}

async function openEditManualBook(bookId) {
  let b;
  try {
    const res = await fetch(`/books/${bookId}`);
    if (!res.ok) return pushToast('Could not load this book', 'err');
    b = await res.json();
  } catch { return pushToast('Connection error', 'err'); }

  closeDrawer();
  // Switch tabs first so opening the modal doesn't spin the camera up.
  switchModalTab('create');
  openAddModal();
  resetManualForm();

  document.getElementById('create-title').value = b.title || '';
  document.getElementById('create-authors').value = (b.authors || []).map(a => a.name).join(', ');
  document.getElementById('create-subtitle').value = b.subtitle || '';
  document.getElementById('create-publisher').value = (b.publishers || []).map(p => p.name).join(', ');
  document.getElementById('create-year').value = b.publish_date || '';
  document.getElementById('create-pages').value = b.number_of_pages || '';
  document.getElementById('create-isbn').value = (b.isbns || []).join(', ');
  document.getElementById('create-subjects').value = (b.subjects || []).map(s => s.name).join(', ');
  document.getElementById('create-description').value = b.description || '';
  if (b.subtitle || b.publishers?.length || b.publish_date || b.number_of_pages ||
      b.isbns?.length || b.subjects?.length || b.description) {
    document.querySelector('.d-create-more').open = true;
  }

  // Show the existing cover; leaving it untouched keeps it on save.
  const existing = b.covers && b.covers[0] && (b.covers[0].medium || b.covers[0].small);
  if (existing) {
    const pick = document.getElementById('create-cover-pick');
    pick.classList.add('has');
    pick.insertAdjacentHTML('afterbegin', `<img src="${doraEsc(existing)}" alt="">`);
  }

  manualEditBookId = bookId;
  setManualEditMode(true);
}

function cancelManualEdit() {
  setManualEditMode(false);
  resetManualForm();
}

async function saveManualEdit() {
  const payload = readManualForm();
  if (!payload) return;
  const btn = document.getElementById('create-submit');
  const orig = btn.textContent;
  btn.textContent = 'Saving…';
  try {
    const res = await fetch(`/books/${manualEditBookId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      btn.textContent = orig;
      return pushToast(detail.detail || 'Could not save changes', 'err');
    }
    flashAfterReload('Book details updated', 'ok');
    window.location.reload();
  } catch {
    btn.textContent = orig;
    pushToast('Connection error', 'err');
  }
}

// A book already in our catalogue (local search / duplicate suggestion) — no
// lookup or creation needed, just shelve it by id.
function appendCatalogueBook(b) {
  if (queueHasKey(b.book_id)) return;
  const cover = b.cover_url
    ? `<img src="${doraEsc(b.cover_url)}" style="width:100%;height:100%;object-fit:cover;" onerror="this.remove()">`
    : BOOK_ICON;
  const sub = [b.authors?.join(', '), b.publish_date].filter(Boolean).join(' · ') || (b.isbn || '—');
  makeChip(b.book_id, cover, b.title || 'Untitled', sub);
  scanQueue.push({ key: b.book_id, book_id: b.book_id });
  updateQueueBadge();
  pushToast('Added · ' + (b.title || 'book'), 'ok');
}

function updateQueueBadge() {
  const n = scanQueue.length;
  const badge = document.getElementById('nav-badge');
  const addBtn = document.getElementById('nav-add-btn');
  const countBadge = document.getElementById('queue-count-badge');
  if (badge) badge.textContent = n;
  if (addBtn) addBtn.classList.toggle('has-queue', n > 0);
  if (countBadge) {
    countBadge.textContent = n + ' ' + (n === 1 ? 'book' : 'books');
    countBadge.classList.toggle('has', n > 0);
  }
  const authCount = document.getElementById('auth-prompt-count');
  const authPlural = document.getElementById('auth-prompt-plural');
  if (authCount) authCount.textContent = n;
  if (authPlural) authPlural.textContent = n !== 1 ? 's' : '';
}

// Queue items are objects:
//   ISBN (scan/manual):  { key: isbn, isbn }
//   Search result:       { key: workKey, book: {key,title,authors,isbns,cover_url,first_publish_year} }
//   Already in catalogue:{ key: bookId, book_id }
//   Typed in by hand:    { key: 'manual:n', manual: {title, authors, …, cover_key} }
function queueHasKey(key) { return scanQueue.some(i => i.key === key); }

function queueToEntries(is_public, status) {
  return scanQueue.map(i => {
    const base = { is_public, status, comment: '' };
    if (i.manual)  return { ...base, manual: i.manual };
    if (i.book_id) return { ...base, book_id: i.book_id };
    if (i.book)    return { ...base, book: i.book };
    return { ...base, isbn: i.isbn };
  });
}

// ── Ask Dora (real taste engine) ───────────────────────────
// POST /dora/ask fires an agent workflow that profiles the signed-in user's
// library and grades the candidate book; we then poll /dora/ask/{run_id}
// until the verdict comes back (typically 10–30s).
const DORA_ICON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5.4v13.2"/><path d="M16 5.4v13.2"/><ellipse cx="12" cy="5.4" rx="4" ry="2"/><path d="M10.6 5.6a1.4 0.8 0 0 1 2.8 0"/><path d="M8 18.6a4 2 0 0 0 8 0"/><path d="M7.1 11.8h9.8"/><path d="M9.7 11.8c-.5 1-.3 2.2.2 3.2"/></svg>`;
function doraDots(n) {
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<span class="${i <= n ? 'on' : ''}"></span>`;
  return `<span class="d-dots">${out}</span>`;
}
function doraEsc(s) {
  const d = document.createElement('span');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function doraTasteHtml(v) {
  return `<div class="taste f-rise">
      <div class="verdict ${v.kind}"><span class="vdot"></span>${doraEsc(v.verdict)}</div>
      <div class="srow"><span>Familiarity to taste</span>${doraDots(v.familiarity_to_taste)}</div>
      <div class="srow"><span>Adventure, right direction</span>${doraDots(v.adventure_in_the_right_direction)}</div>
      ${v.reason ? `<div class="reason">${doraEsc(v.reason)}</div>` : ''}
    </div>`;
}
// Wire an "Ask Dora" button inside a chip's .d-chip-taste-slot. getCandidate
// is called at click time and must return {title, authors, isbn, context}.
function mountAskDora(chip, getCandidate) {
  const slot = chip.querySelector('.d-chip-taste-slot');
  if (!slot) return;

  const showButton = (label) => {
    slot.innerHTML = `<button class="d-askdora" type="button">${DORA_ICON} ${label}</button>`;
    slot.querySelector('.d-askdora').onclick = (e) => { e.stopPropagation(); run(); };
  };

  async function run() {
    const candidate = getCandidate();
    if (!candidate.title) return showButton('Ask Dora: buy or skip?');
    slot.innerHTML = `<div class="d-askdora" style="cursor:default">${DORA_ICON} Dora is reading your shelves…</div>`;
    try {
      const res = await fetch('/dora/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(candidate),
      });
      if (res.status === 401) return showButton('Sign in to ask Dora');
      if (!res.ok) return showButton('Dora couldn’t decide — retry?');
      const { run_id } = await res.json();
      for (let n = 0; n < 40; n++) {
        await new Promise(r => setTimeout(r, 3000));
        const pr = await fetch(`/dora/ask/${run_id}`);
        if (!pr.ok) return showButton('Dora couldn’t decide — retry?');
        const data = await pr.json();
        if (data.status === 'completed' && data.verdict) {
          slot.innerHTML = doraTasteHtml(data.verdict);
          return;
        }
        if (data.status === 'failed') return showButton('Dora couldn’t decide — retry?');
      }
      showButton('Dora took too long — retry?');
    } catch {
      showButton('Dora couldn’t decide — retry?');
    }
  }

  showButton('Ask Dora: buy or skip?');
}

function makeChip(key, coverHtml, title, sub) {
  document.getElementById('queue-empty').style.display = 'none';
  const list = document.getElementById('scan-queue');
  const chip = document.createElement('div');
  chip.className = 'd-queue-chip d-chip-taste';
  chip.innerHTML = `
    <div class="top">
      <div class="d-queue-chip-cover" style="background:var(--ink-blue);display:flex;align-items:center;justify-content:center;">${coverHtml}</div>
      <div style="flex:1;min-width:0;">
        <div class="d-queue-chip-title">${doraEsc(title)}</div>
        <div class="d-queue-chip-isbn">${doraEsc(sub)}</div>
      </div>
      <button class="f-iconbtn" style="width:28px;height:28px;flex-shrink:0;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="d-chip-taste-slot"></div>
  `;
  chip.querySelector('.top .f-iconbtn').onclick = () => removeQueueItem(key, chip);
  mountAskDora(chip, () => {
    const item = scanQueue.find(i => i.key === key) || {};
    const b = item.book || {};
    return {
      title: b.title || chip.querySelector('.d-queue-chip-title')?.textContent || '',
      authors: b.authors || [],
      isbn: (b.isbns && b.isbns[0]) || item.isbn || null,
      context: b.first_publish_year ? `First published ${b.first_publish_year}` : null,
    };
  });
  list.prepend(chip);
  return chip;
}

const BOOK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(244,238,226,0.6)" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>`;

async function appendQueue(isbn) {
  if (queueHasKey(isbn)) return;
  const chip = makeChip(isbn, BOOK_ICON, 'Looking up…', isbn);
  scanQueue.push({ key: isbn, isbn });
  updateQueueBadge();

  try {
    const res = await fetch(`/books/lookup/${isbn}`);
    if (res.ok) {
      const book = await res.json();
      const cover = chip.querySelector('.d-queue-chip-cover');
      if (book.covers && book.covers[0]) {
        const src = book.covers[0].small || book.covers[0].medium;
        if (src) cover.innerHTML = `<img src="${src}" style="width:100%;height:100%;object-fit:cover;">`;
      }
      chip.querySelector('.d-queue-chip-title').textContent = book.title || isbn;
      pushToast('Added · ' + (book.title || isbn), 'ok');
    } else if (res.status === 429) {
      chip.querySelector('.d-queue-chip-title').textContent = 'Rate-limited — try again shortly';
      chip.querySelector('.d-queue-chip-title').style.color = '#d65d4a';
    } else {
      chip.querySelector('.d-queue-chip-title').textContent = 'Not found';
      chip.querySelector('.d-queue-chip-title').style.color = '#d65d4a';
    }
  } catch {}
}

// Add a title-search result using the metadata we already have — no re-lookup,
// so books without an ISBN can still be saved.
function appendSearchResult(b) {
  if (queueHasKey(b.key)) return;
  const cover = b.cover_url
    ? `<img src="${b.cover_url}" style="width:100%;height:100%;object-fit:cover;" onerror="this.remove()">`
    : BOOK_ICON;
  const sub = [b.authors?.join(', '), b.first_publish_year].filter(Boolean).join(' · ') || (b.isbn || '—');
  makeChip(b.key, cover, b.title || 'Untitled', sub);
  scanQueue.push({
    key: b.key,
    book: {
      key: b.key, title: b.title, authors: b.authors || [],
      isbns: b.isbns || [], cover_url: b.cover_url || null,
      first_publish_year: b.first_publish_year || null,
    },
  });
  updateQueueBadge();
  pushToast('Added · ' + (b.title || 'book'), 'ok');
}

function removeQueueItem(key, chipEl) {
  scanQueue = scanQueue.filter(i => i.key !== key);
  chipEl.remove();
  if (!scanQueue.length) document.getElementById('queue-empty').style.display = '';
  updateQueueBadge();
}

function stashQueueAndGo() {
  sessionStorage.setItem('pendingScanQueue', JSON.stringify(scanQueue));
}

async function saveBatchLibrary(btn) {
  if (scanQueue.length === 0) { closeAddModal(); return; }
  const is_public = document.getElementById('batch-visibility').value === 'public';
  const status = document.getElementById('batch-status').value;
  const orig = btn ? btn.innerHTML : '';
  if (btn) btn.innerHTML = 'Saving…';
  const entries = queueToEntries(is_public, status);
  try {
    const res = await fetch('/books/user_books/batch', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({entries}),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const errors = data.errors || [];
      if (errors.length && !data.added) {
        // Nothing saved — keep the queue up so the reason is actionable.
        pushToast(errors[0], 'err');
        if (btn) btn.innerHTML = orig;
        return;
      }
      // Survives the reload below, where a toast wouldn't.
      if (errors.length) flashAfterReload(errors[0], 'err');
      window.location.hash='#profile'; window.location.reload();
    }
    else if (res.status === 401) {
      // Session lapsed — keep the queue and re-authenticate; it auto-saves on return.
      pushToast('Please sign in again to save', 'err');
      stashQueueAndGo();
      window.location.href = '/login';
    }
    else { pushToast('Error saving books', 'err'); if (btn) btn.innerHTML = orig; }
  } catch { pushToast('Connection error','err'); if (btn) btn.innerHTML = orig; }
}

// ── Init ──────────────────────────────────────────────────
// getUserMedia needs a secure context — over plain HTTP on a phone there's no
// camera to offer, so don't show a button that can only fail.
if (!navigator.mediaDevices?.getUserMedia) {
  const camBtn = document.getElementById('create-cover-cam');
  if (camBtn) camBtn.style.display = 'none';
}

const flashed = sessionStorage.getItem('flashToast');
if (flashed) {
  sessionStorage.removeItem('flashToast');
  try {
    const { msg, kind } = JSON.parse(flashed);
    setTimeout(() => pushToast(msg, kind), 400);
  } catch {}
}

const pendingScans = sessionStorage.getItem('pendingScanQueue');
if (isLoggedIn && pendingScans) {
  scanQueue = JSON.parse(pendingScans);
  sessionStorage.removeItem('pendingScanQueue');
  updateQueueBadge();
  // auto-save without opening modal
  const entries = queueToEntries(true, 'unread');
  fetch('/books/user_books/batch', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries})})
    .then(r => { if(r.ok){ window.location.hash='#profile'; window.location.reload(); } });
} else {
  const hash = window.location.hash.slice(1);
  switchView(['home','books','profile'].includes(hash) ? hash : 'home');
  if (new URLSearchParams(window.location.search).get('open') === 'scan') {
    history.replaceState(null, '', '/');
    openAddModal();
  }
}

// ── Lazy-load more community books (50 at a time) ─────────
(function () {
  const EXPLORE_PAGE = 50;
  const grid = document.getElementById('explore-grid');
  const sentinel = document.getElementById('explore-sentinel');
  const loading = document.getElementById('explore-loading');
  if (!grid || !sentinel) return;

  let offset = grid.querySelectorAll('.d-cell').length;
  let done = offset < EXPLORE_PAGE;   // first page already short → nothing more
  let busy = false;

  async function loadMore() {
    if (busy || done) return;
    busy = true;
    loading.style.display = 'block';
    try {
      const res = await fetch(`/explore?offset=${offset}`);
      if (!res.ok) { done = true; return; }
      const tmp = document.createElement('div');
      tmp.innerHTML = (await res.text()).trim();
      const added = tmp.querySelectorAll('.d-cell').length;
      while (tmp.firstChild) grid.appendChild(tmp.firstChild);
      offset += added;
      if (added < EXPLORE_PAGE) done = true;
    } catch {
      /* leave sentinel observed; retries on next intersection */
    } finally {
      busy = false;
      loading.style.display = 'none';
      if (done) obs.disconnect();
    }
  }

  const obs = new IntersectionObserver(
    (entries) => { if (entries.some(e => e.isIntersecting)) loadMore(); },
    { rootMargin: '400px' }
  );
  obs.observe(sentinel);
})();
