function openBookDrawer(bookId) {
  const src = document.getElementById('drawer-book-' + bookId);
  if (!src) return;
  document.getElementById('drawer-body').innerHTML = src.innerHTML;
  document.getElementById('drawer-scrim').classList.add('open');
  document.getElementById('detail-drawer').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeBookDrawer() {
  document.getElementById('drawer-scrim').classList.remove('open');
  document.getElementById('detail-drawer').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeBookDrawer(); });

function pushToast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' err' : '');
  el.innerHTML = '<span class="dot"></span>';
  el.appendChild(document.createTextNode(msg));
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// Add a book from someone else's shelf to your own.
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
