        let count = 0;
        const scannedSet = new Set();

        function extractISBN(raw) {
            if (!raw) return null;
            const digits = raw.replace(/[^0-9X]/gi, '').toUpperCase();
            if (digits.length >= 13 && /^97[89]/.test(digits)) return digits.slice(0, 13);
            if (/^[0-9]{9}[0-9X]$/.test(digits)) return digits;
            return null;
        }

        function handleScan(rawValue) {
            const isbn = extractISBN(rawValue);
            if (isbn && !scannedSet.has(isbn)) {
                scannedSet.add(isbn);
                onScan(isbn);
            }
        }

        function showToast(msg, isError) {
            const t = document.getElementById('toast');
            t.textContent = msg;
            t.className = 'toast show' + (isError ? ' error' : '');
            clearTimeout(t._timeout);
            t._timeout = setTimeout(() => t.classList.remove('show'), 2000);
        }

        async function onScan(isbn) {
            try {
                const res = await fetch(`/scan/session/${TOKEN}/add`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isbn })
                });
                if (res.ok) {
                    count++;
                    document.getElementById('scan-count').textContent = count;
                    document.getElementById('done-label').textContent =
                        `${count} book${count !== 1 ? 's' : ''} sent to desktop`;
                    showToast('Added!');
                    addScannedItem(isbn);
                } else if (res.status === 404) {
                    showToast('Session expired — rescan QR code', true);
                }
            } catch {
                showToast('Connection error', true);
            }
        }

        function addScannedItem(isbn) {
            const list = document.getElementById('scanned-list');
            const item = document.createElement('div');
            item.className = 'scanned-item';
            item.innerHTML = `
                <img src="" onerror="this.style.display='none'">
                <div>
                    <div class="title">Looking up…</div>
                    <div class="isbn">${isbn}</div>
                </div>
            `;
            list.prepend(item);
            fetch(`/books/lookup/${isbn}`)
                .then(r => r.ok ? r.json() : null)
                .then(book => {
                    if (!book) return;
                    item.querySelector('.title').textContent = book.title || 'Unknown Title';
                    const img = item.querySelector('img');
                    const cover = book.covers?.[0]?.small || book.covers?.[0]?.medium;
                    if (cover) img.src = cover;
                });
        }

        async function startScanner() {
            const reader = document.getElementById('reader');
            if ('BarcodeDetector' in window) {
                try {
                    const formats = await BarcodeDetector.getSupportedFormats();
                    if (formats.includes('ean_13')) {
                        const stream = await navigator.mediaDevices.getUserMedia({
                            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
                        });
                        const video = document.createElement('video');
                        video.srcObject = stream;
                        video.setAttribute('playsinline', '');
                        video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px;display:block;';
                        reader.innerHTML = '';
                        reader.appendChild(video);
                        await video.play();
                        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
                        const detect = async () => {
                            try {
                                for (const { rawValue } of await detector.detect(video)) handleScan(rawValue);
                            } catch {}
                            requestAnimationFrame(detect);
                        };
                        requestAnimationFrame(detect);
                        return;
                    }
                } catch {}
            }
            // Quagga2 fallback — only devices without the native BarcodeDetector
            // API need this, so it's loaded on demand instead of unconditionally.
            reader.innerHTML = '<div style="padding:30px;text-align:center;color:#fff;font-size:0.9rem;">Loading scanner…</div>';
            await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = 'https://unpkg.com/@ericblade/quagga2/dist/quagga.min.js';
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
            reader.innerHTML = '';
            Quagga.init({
                inputStream: {
                    type: 'LiveStream',
                    target: reader,
                    constraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
                },
                decoder: { readers: ['ean_reader', 'ean_8_reader', 'upc_reader', 'upc_e_reader'] },
                locate: true,
            }, (err) => {
                if (err) {
                    reader.innerHTML = `<div style="padding:30px;text-align:center;color:#fff;font-size:0.9rem;">Camera access denied.<br>Please allow camera access and reload.</div>`;
                    return;
                }
                Quagga.start();
                Quagga.onDetected((result) => {
                    const errs = result.codeResult.decodedCodes
                        .filter(c => c.error !== undefined).map(c => c.error);
                    if (errs.length && errs.reduce((a, b) => a + b, 0) / errs.length > 0.15) return;
                    handleScan(result.codeResult.code);
                });
            });
        }

        startScanner();
