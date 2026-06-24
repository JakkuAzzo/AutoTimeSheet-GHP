(() => {
  let loadingPromise = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load Excel generator. Please check the connection and try again.'));
      document.head.appendChild(script);
    });
  }

  window.ensureXlsxLoaded = function ensureXlsxLoaded() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!loadingPromise) {
      loadingPromise = loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js').then(() => {
        if (!window.XLSX) throw new Error('Excel generator loaded but was not available. Please refresh and try again.');
        return window.XLSX;
      });
    }
    return loadingPromise;
  };

  function installSubmitGate() {
    const form = document.getElementById('timesheet-form');
    const banner = document.getElementById('form-error');
    if (!form || form.dataset.lazyXlsxGate) return;
    form.dataset.lazyXlsxGate = 'true';
    form.addEventListener('submit', async (event) => {
      if (form.dataset.xlsxReady === 'true' || window.XLSX) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        if (banner) {
          banner.textContent = 'Preparing Excel generator, then submitting...';
          banner.classList.remove('hidden');
        }
        await window.ensureXlsxLoaded();
        form.dataset.xlsxReady = 'true';
        form.requestSubmit();
      } catch (err) {
        if (banner) {
          banner.textContent = err.message || 'Could not prepare the Excel attachment.';
          banner.classList.remove('hidden');
        } else {
          alert(err.message || 'Could not prepare the Excel attachment.');
        }
      }
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installSubmitGate);
  } else {
    installSubmitGate();
  }
})();
