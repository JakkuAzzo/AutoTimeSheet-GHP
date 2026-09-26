(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GMTClockTransport = api;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis), function () {
  function clean(value) {
    return String(value || '').trim();
  }

  function isFormSubmitEndpoint(value) {
    return /^https:\/\/formsubmit\.co\//i.test(clean(value));
  }

  function nativeEndpoint(value) {
    return clean(value).replace('https://formsubmit.co/ajax/', 'https://formsubmit.co/');
  }

  function hasFileInputs(form) {
    if (!form || typeof form.querySelectorAll !== 'function') return false;
    return Array.from(form.querySelectorAll('input[type="file"]')).some((input) => input.files && input.files.length);
  }

  function isBrowserTransportFailure(error) {
    return /failed to fetch|load failed|cors|web server|network/i.test(String(error && error.message || error || ''));
  }

  function shouldUseNativeFallback(endpoint, form, error) {
    return isFormSubmitEndpoint(endpoint) && (hasFileInputs(form) || isBrowserTransportFailure(error));
  }

  function validWebLocation(locationLike) {
    return Boolean(locationLike && /^https?:$/i.test(String(locationLike.protocol || '')) && String(locationLike.origin || '') !== 'null');
  }

  function appendSuccessRedirect(form, locationLike, documentLike) {
    if (!validWebLocation(locationLike) || !form || !documentLike || typeof documentLike.createElement !== 'function') return null;
    if (typeof form.querySelector === 'function' && form.querySelector('input[name="_next"]')) return null;
    const next = documentLike.createElement('input');
    next.type = 'hidden';
    next.name = '_next';
    next.value = `${locationLike.origin}/timesheets/submit-success.html?gmt_formsubmit=success`;
    form.appendChild(next);
    return next;
  }

  function submitNativeForm(form, frame, options) {
    const settings = options || {};
    const locationLike = settings.location || (typeof window !== 'undefined' ? window.location : null);
    const documentLike = settings.document || (typeof document !== 'undefined' ? document : null);
    const htmlForm = settings.htmlForm || (typeof HTMLFormElement !== 'undefined' ? HTMLFormElement : null);
    const timeoutMs = Number(settings.timeoutMs) > 0 ? Number(settings.timeoutMs) : 30000;
    if (!validWebLocation(locationLike)) {
      return Promise.reject(new Error('Open GMT Timesheets through the website before submitting a clock event.'));
    }
    if (!form || !frame || !frame.name) {
      return Promise.reject(new Error('The timesheet delivery frame is unavailable. Please refresh and try again.'));
    }

    const previousAction = form.action;
    const previousTarget = form.target;
    const addedNext = appendSuccessRedirect(form, locationLike, documentLike);
    form.action = nativeEndpoint(previousAction);
    form.target = frame.name;

    return new Promise((resolve, reject) => {
      let settled = false;
      let loadCount = 0;
      const timeout = setTimeout(() => finish(new Error('Timesheet delivery timed out. Please try again or contact Accounts.')), timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        frame.removeEventListener('load', onLoad);
        frame.removeEventListener('error', onError);
        form.action = previousAction;
        form.target = previousTarget;
        if (addedNext && addedNext.parentNode) addedNext.parentNode.removeChild(addedNext);
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error); else resolve({ success: true, transport: 'native-form' });
      };
      const inspectResponse = () => {
        loadCount += 1;
        try {
          const responseUrl = String(frame.contentWindow.location.href || '');
          const parsed = new URL(responseUrl, locationLike.href || locationLike.origin);
          if (parsed.origin !== locationLike.origin) return;
          const isSuccessPath = parsed.pathname.endsWith('/timesheets/submit-success.html') || parsed.pathname.endsWith('/timesheets/submit-success');
          if (isSuccessPath && parsed.searchParams.get('gmt_formsubmit') === 'success') {
            finish();
          } else if (loadCount > 1) {
            finish(new Error('Timesheet delivery was rejected. Please try again or contact Accounts.'));
          }
        } catch (_) {
          // The provider response is cross-origin until it follows _next back
          // to the small same-origin success page. Keep waiting for that hop.
        }
      };
      const onLoad = () => setTimeout(inspectResponse, 0);
      const onError = () => finish(new Error('Timesheet delivery failed. Please try again or contact Accounts.'));
      frame.addEventListener('load', onLoad);
      frame.addEventListener('error', onError);
      try {
        if (htmlForm && htmlForm.prototype && typeof htmlForm.prototype.submit === 'function') htmlForm.prototype.submit.call(form);
        else if (typeof form.submit === 'function') form.submit();
        else finish(new Error('The browser cannot submit this timesheet form. Please refresh and try again.'));
      } catch (error) {
        finish(error);
      }
    });
  }

  return {
    isFormSubmitEndpoint,
    nativeEndpoint,
    hasFileInputs,
    isBrowserTransportFailure,
    shouldUseNativeFallback,
    validWebLocation,
    submitNativeForm
  };
});
