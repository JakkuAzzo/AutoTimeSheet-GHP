(() => {
  let saveTimer = null;
  let recalcTimer = null;

  function safeCall(name, ...args) {
    try {
      if (typeof window[name] === 'function') return window[name](...args);
    } catch (err) {
      console.warn(`GMT ${name} failed`, err);
    }
    return undefined;
  }

  function scheduleSafeSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => safeCall('saveDraft'), 900);
  }

  function scheduleSafeRecalculate() {
    clearTimeout(recalcTimer);
    recalcTimer = setTimeout(() => safeCall('recalculate'), 80);
  }

  function unlockEditableFields() {
    document.querySelectorAll('input, textarea, select').forEach((field) => {
      const card = field.closest('.day-card');
      const absence = card?.querySelector('[data-field="absenceStatus"]')?.value;
      const lockedAbsence = absence === 'Sick' || absence === 'Holiday';
      const lockable = field.matches('[data-field="start"], [data-field="finish"], [data-field="lunchHad"]');
      if (!lockedAbsence || !lockable) field.disabled = false;
      if (field.readOnly && !field.matches('[readonly][data-keep-readonly]')) field.readOnly = false;
    });
  }

  function handleLightInput(event) {
    const target = event.target;
    if (!target || !target.matches('input, textarea, select')) return;

    event.stopImmediatePropagation();

    const card = target.closest('.day-card');
    const affectsCalculation = !!card || target.id === 'week-start' || target.id === 'week-end' || target.id === 'absence-start' || target.id === 'absence-end' || target.id === 'absence-reason';

    if (card && target.matches('[data-field="absenceStatus"]')) safeCall('applyAbsenceState', card);

    if (card && target.matches('[data-field="date"]')) {
      try {
        const reason = typeof window.absenceForDate === 'function' ? window.absenceForDate(target.value) : 'NA';
        const absenceSelect = card.querySelector('[data-field="absenceStatus"]');
        if (absenceSelect && reason && reason !== 'NA') {
          absenceSelect.value = reason;
          safeCall('applyAbsenceState', card);
        }
      } catch {}
    }

    if (card && target.matches('[data-field="images"]')) safeCall('updateFileLabel', target);
    if (affectsCalculation) scheduleSafeRecalculate();
    scheduleSafeSave();
  }

  function showRecoveryNotice() {
    const message = sessionStorage.getItem('gmt_timesheet_recovered');
    if (!message) return;
    sessionStorage.removeItem('gmt_timesheet_recovered');
    const banner = document.getElementById('form-error');
    if (banner) {
      banner.textContent = message;
      banner.classList.remove('hidden');
    }
  }

  function boot() {
    unlockEditableFields();
    showRecoveryNotice();
    document.addEventListener('input', handleLightInput, true);
    document.addEventListener('change', handleLightInput, true);
    window.addEventListener('pageshow', () => {
      unlockEditableFields();
      scheduleSafeRecalculate();
    });
    document.addEventListener('focusin', (event) => {
      if (event.target?.matches('input, textarea, select')) unlockEditableFields();
    }, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
