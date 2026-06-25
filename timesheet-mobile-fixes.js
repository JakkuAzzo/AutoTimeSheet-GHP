(() => {
  let lastPointerToggle = 0;

  function isLockedAbsence(card) {
    const status = card?.querySelector('[data-field="absenceStatus"]')?.value || 'NA';
    return status === 'Sick' || status === 'Holiday';
  }

  function syncBreakControl(card) {
    const control = card?.querySelector('[data-field="lunchHad"]');
    if (!control) return;
    const locked = isLockedAbsence(card);
    control.disabled = locked;
    if (locked) {
      if (control.tagName === 'SELECT') control.value = '0';
      if (control.type === 'checkbox') control.checked = false;
    }
  }

  function syncAllBreakControls() {
    document.querySelectorAll('.day-card').forEach(syncBreakControl);
  }

  function patchAbsenceState() {
    if (window.__gmtAbsencePatchInstalled) return;
    window.__gmtAbsencePatchInstalled = true;
    if (typeof applyAbsenceState === 'function') {
      const original = applyAbsenceState;
      applyAbsenceState = function patchedApplyAbsenceState(card) {
        original(card);
        syncBreakControl(card);
      };
    }
  }

  function toggleCard(card) {
    if (!card) return;
    const willCollapse = !card.classList.contains('is-collapsed');
    card.classList.toggle('is-collapsed', willCollapse);
    const button = card.querySelector('.collapse-day');
    const icon = card.querySelector('.collapse-icon');
    if (button) button.setAttribute('aria-expanded', String(!willCollapse));
    if (icon) icon.textContent = willCollapse ? '-' : '^';
    if (typeof saveDraft === 'function') saveDraft();
  }

  function installCollapseFix() {
    const container = document.getElementById('days-container');
    if (!container || container.dataset.iphoneCollapseFix) return;
    container.dataset.iphoneCollapseFix = 'true';

    container.addEventListener('pointerup', (event) => {
      const button = event.target.closest('.collapse-day');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      lastPointerToggle = Date.now();
      toggleCard(button.closest('.day-card'));
    }, true);

    container.addEventListener('click', (event) => {
      const button = event.target.closest('.collapse-day');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (Date.now() - lastPointerToggle > 600) toggleCard(button.closest('.day-card'));
    }, true);
  }

  function boot() {
    patchAbsenceState();
    syncAllBreakControls();
    installCollapseFix();
    document.addEventListener('change', (event) => {
      const card = event.target.closest('.day-card');
      if (!card) return;
      if (event.target.matches('[data-field="absenceStatus"]')) {
        setTimeout(() => {
          syncBreakControl(card);
          if (typeof recalculate === 'function') recalculate();
        }, 0);
      }
    }, true);
    const observer = new MutationObserver(() => {
      patchAbsenceState();
      syncAllBreakControls();
      installCollapseFix();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
