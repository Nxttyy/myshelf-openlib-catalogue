window.PhotoNotes = (function () {
  const MAX_IMAGES = 6;

  // ── add menu ──────────────────────────────────────────────
  function closeAllMenus() {
    document.querySelectorAll('.d-addpop.open').forEach(p => p.classList.remove('open'));
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.d-addwrap')) closeAllMenus();
  });
  function toggleAddMenu(btn) {
    const pop = btn.nextElementSibling;
    const willOpen = !pop.classList.contains('open');
    closeAllMenus();
    if (willOpen) pop.classList.add('open');
  }
  function pickFile(btn) {
    const wrap = btn.closest('.d-addwrap');
    closeAllMenus();
    wrap.querySelector('input[type=file]').click();
  }

  // ── upload (presign → PUT to bucket → confirm) ───────────
  function handleFiles(input) {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length) uploadFiles(input.closest('.d-photos'), files);
  }

  async function uploadFiles(container, files) {
    const ubId = container.dataset.ubId;
    const valid = files.filter(f => f.type.startsWith('image/'));
    if (!valid.length) return;
    const room = MAX_IMAGES - container.querySelectorAll('.d-photo').length;
    if (room <= 0) { pushToast('This note already has ' + MAX_IMAGES + ' photos', 'err'); return; }
    const batch = valid.slice(0, room);

    let presigned;
    try {
      const res = await fetch(`/books/user_books/${ubId}/images/presign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: batch.map(f => ({ content_type: f.type, byte_size: f.size })) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        pushToast(err.detail || 'Could not start upload', 'err');
        return;
      }
      presigned = await res.json();
    } catch { pushToast('Connection error', 'err'); return; }

    for (let i = 0; i < presigned.length; i++) {
      const p = presigned[i];
      const file = batch[i];
      try {
        const form = new FormData();
        Object.entries(p.fields).forEach(([k, v]) => form.append(k, v));
        form.append('file', file);
        const upRes = await fetch(p.upload_url, { method: 'POST', body: form });
        if (!upRes.ok) { pushToast('Upload failed for ' + file.name, 'err'); continue; }
        const confirmRes = await fetch(`/books/user_books/${ubId}/images/${p.image_id}/confirm`, { method: 'POST' });
        if (!confirmRes.ok) { pushToast('Could not confirm upload', 'err'); continue; }
        appendThumb(container, await confirmRes.json());
      } catch { pushToast('Connection error uploading ' + file.name, 'err'); }
    }
  }

  function appendThumb(container, img) {
    const hint = container.querySelector('.d-photo-hint');
    if (hint) hint.remove();
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'd-photo';
    btn.dataset.imageId = img.id; btn.dataset.src = img.url;
    btn.title = 'View photo';
    btn.innerHTML = '<img src="' + img.url + '" alt="">' +
      '<span class="rm" role="button" aria-label="Remove" title="Remove">' +
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></span>';
    btn.addEventListener('click', () => openLightbox(btn));
    btn.querySelector('.rm').addEventListener('click', e => { e.stopPropagation(); removePhoto(btn); });
    const addwrap = container.querySelector('.d-addwrap');
    if (addwrap) container.insertBefore(btn, addwrap); else container.appendChild(btn);
    syncSourceTemplate(container);
  }

  async function removePhoto(el) {
    const thumb = el.closest('.d-photo');
    const container = thumb.closest('.d-photos');
    const ubId = container.dataset.ubId;
    const imageId = thumb.dataset.imageId;
    thumb.style.opacity = '0.4'; thumb.style.pointerEvents = 'none';
    try {
      const res = await fetch(`/books/user_books/${ubId}/images/${imageId}`, { method: 'DELETE' });
      if (!res.ok) { thumb.style.opacity = ''; thumb.style.pointerEvents = ''; pushToast('Could not remove photo', 'err'); return; }
      thumb.remove();
      if (!container.querySelector('.d-photo') && !container.querySelector('.d-photo-hint')) {
        const hint = document.createElement('span');
        hint.className = 'd-photo-hint';
        hint.textContent = 'Add photos to this note — a quote you liked, the cover, a spread.';
        container.appendChild(hint);
      }
      syncSourceTemplate(container);
    } catch { thumb.style.opacity = ''; thumb.style.pointerEvents = ''; pushToast('Connection error', 'err'); }
  }

  // The drawer clones the hidden #drawer-{bookId} template's innerHTML on
  // every open, so live changes here would otherwise vanish on reopen.
  function syncSourceTemplate(container) {
    const bookId = container.dataset.bookId;
    if (!bookId) return;
    const src = document.getElementById('drawer-' + bookId);
    const srcPhotos = src && src.querySelector('.d-photos');
    if (srcPhotos) srcPhotos.innerHTML = container.innerHTML;
  }

  // ── lightbox ──────────────────────────────────────────────
  const lb = { photos: [], index: 0, editable: false, container: null };

  function collectPhotos(container) {
    return Array.from(container.querySelectorAll('.d-photo')).map(b => ({ id: b.dataset.imageId, src: b.dataset.src }));
  }

  function openLightbox(thumb) {
    const container = thumb.closest('.d-photos');
    lb.container = container;
    lb.photos = collectPhotos(container);
    lb.index = Math.max(0, lb.photos.findIndex(p => p.id === thumb.dataset.imageId));
    lb.editable = container.dataset.editable === 'true';
    renderLightbox();
  }

  function renderLightbox() {
    const root = document.getElementById('photo-overlay-root');
    const p = lb.photos[lb.index];
    if (!p) { closeLightbox(); return; }
    root.innerHTML = `
      <div class="d-lightbox">
        <div class="lb-top">
          <span class="lb-count">${lb.index + 1} / ${lb.photos.length}</span>
          <div style="display:flex;gap:6px;">
            ${lb.editable ? '<button class="lb-btn" title="Remove from note" onclick="PhotoNotes.removeCurrentLightboxPhoto()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>' : ''}
            <button class="lb-btn" title="Close" onclick="PhotoNotes.closeLightbox()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
          </div>
        </div>
        <div class="lb-stage">
          <button class="lb-nav" ${lb.index === 0 ? 'disabled' : ''} onclick="PhotoNotes.lightboxNav(-1)" aria-label="Previous"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg></button>
          <figure class="lb-print"><img src="${p.src}" alt=""></figure>
          <button class="lb-nav" ${lb.index === lb.photos.length - 1 ? 'disabled' : ''} onclick="PhotoNotes.lightboxNav(1)" aria-label="Next"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></button>
        </div>
        ${lb.photos.length > 1 ? '<div class="lb-strip">' + lb.photos.map((f, i) => `<button class="${i === lb.index ? 'on' : ''}" onclick="PhotoNotes.lightboxGoto(${i})"><img src="${f.src}" alt=""></button>`).join('') + '</div>' : ''}
      </div>`;
    root.querySelector('.d-lightbox').addEventListener('click', e => { if (e.target === e.currentTarget) closeLightbox(); });
  }

  function lightboxNav(delta) { lb.index = Math.max(0, Math.min(lb.photos.length - 1, lb.index + delta)); renderLightbox(); }
  function lightboxGoto(i) { lb.index = i; renderLightbox(); }
  function closeLightbox() { lb.photos = []; lb.container = null; document.getElementById('photo-overlay-root').innerHTML = ''; }

  async function removeCurrentLightboxPhoto() {
    const p = lb.photos[lb.index];
    if (!p || !lb.container) return;
    const thumb = lb.container.querySelector(`.d-photo[data-image-id="${p.id}"]`);
    if (thumb) await removePhoto(thumb);
    lb.photos = collectPhotos(lb.container);
    if (!lb.photos.length) { closeLightbox(); return; }
    lb.index = Math.min(lb.index, lb.photos.length - 1);
    renderLightbox();
  }

  document.addEventListener('keydown', function (e) {
    if (!lb.photos.length) return;
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowRight') lightboxNav(1);
    else if (e.key === 'ArrowLeft') lightboxNav(-1);
  });

  // ── camera capture (real getUserMedia, not simulated) ────
  let camStream = null, camContainer = null, camShots = 0;

  async function openCamera(btn) {
    const container = btn.closest('.d-photos');
    closeAllMenus();
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch {
      pushToast('Could not access the camera', 'err');
      return;
    }
    camContainer = container;
    camShots = 0;
    const root = document.getElementById('photo-overlay-root');
    root.innerHTML = `
      <div class="d-cam-scrim" onclick="PhotoNotes.closeCamera()"></div>
      <div class="d-camsheet">
        <div class="hd">
          <span class="f-label">Camera · point at the page</span>
          <button class="f-iconbtn" style="width:30px;height:30px;" onclick="PhotoNotes.closeCamera()" aria-label="Close camera"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
        </div>
        <div class="f-cam" id="cam-viewport">
          <video id="cam-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
          <div class="f-reticle"><span class="c1"></span><span class="c2"></span></div>
        </div>
        <div class="ft">
          <span class="caption" id="cam-caption" style="flex:1;font-size:12.5px;color:var(--ink-soft);">Shots land on this note</span>
          <button class="d-shutter" onclick="PhotoNotes.snapPhoto()" aria-label="Capture"><span></span></button>
          <button class="f-btn f-btn--ink" style="padding:8px 16px;font-size:12.5px;margin-left:auto;" onclick="PhotoNotes.closeCamera()">Done</button>
        </div>
      </div>`;
    document.getElementById('cam-video').srcObject = camStream;
  }

  async function snapPhoto() {
    const video = document.getElementById('cam-video');
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const viewport = document.getElementById('cam-viewport');
    if (viewport) {
      const fl = document.createElement('div'); fl.className = 'lb-flash';
      viewport.appendChild(fl); setTimeout(() => fl.remove(), 260);
    }
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) return;
    camShots++;
    const cap = document.getElementById('cam-caption');
    if (cap) cap.textContent = camShots + (camShots === 1 ? ' photo added' : ' photos added');
    const file = new File([blob], `capture-${camShots}.jpg`, { type: 'image/jpeg' });
    await uploadFiles(camContainer, [file]);
  }

  function closeCamera() {
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    document.getElementById('photo-overlay-root').innerHTML = '';
    camContainer = null;
  }

  return {
    toggleAddMenu, pickFile, handleFiles, removePhoto,
    openLightbox, closeLightbox, lightboxNav, lightboxGoto, removeCurrentLightboxPhoto,
    openCamera, closeCamera, snapPhoto,
  };
})();
