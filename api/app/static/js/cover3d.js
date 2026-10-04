/* Pointer-tracking tilt for .cv3-tilt covers: turn 20° to reveal the spine,
   tilt toward the pointer, sweep the glare. Delegated on document so covers
   added later (explore lazy-load, drawer innerHTML) just work. */
(function () {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let cur = null;
  function reset(el) {
    el.classList.remove('on');
    const o = el.querySelector('.cv3-obj'); if (o) o.style.transform = '';
    const g = el.querySelector('.cv3-glare'); if (g) g.style.transform = '';
  }
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest && e.target.closest('.cv3-tilt');
    if (cur && cur !== el) { reset(cur); cur = null; }
    if (!el) return;
    cur = el;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.classList.add('on');
    el.querySelector('.cv3-obj').style.transform =
      'rotateX(' + (-py * 14).toFixed(2) + 'deg) rotateY(' + (px * 18 + 20).toFixed(2) + 'deg) translateZ(6px)';
    const g = el.querySelector('.cv3-glare');
    if (g) g.style.transform = 'translateX(' + (px * 54).toFixed(1) + '%)';
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { if (cur) { reset(cur); cur = null; } });
})();
