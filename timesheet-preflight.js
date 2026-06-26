(() => {
  const STORAGE_KEY = 'gmt_guest_timesheet_draft_v4';
  const MAX_DRAFT_SIZE = 180000;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    if (raw.length > MAX_DRAFT_SIZE) {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.setItem('gmt_timesheet_recovered', 'Large saved draft was cleared to keep the form responsive.');
      return;
    }
    const draft = JSON.parse(raw);
    if (!draft || typeof draft !== 'object' || (draft.rows && !Array.isArray(draft.rows))) {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.setItem('gmt_timesheet_recovered', 'Damaged saved draft was cleared to keep the form responsive.');
      return;
    }
    if (Array.isArray(draft.rows) && draft.rows.length > 45) {
      draft.rows = draft.rows.slice(0, 45);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
      sessionStorage.setItem('gmt_timesheet_recovered', 'Saved draft was trimmed to keep the form responsive.');
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.setItem('gmt_timesheet_recovered', 'Damaged saved draft was cleared to keep the form responsive.');
  }
})();
