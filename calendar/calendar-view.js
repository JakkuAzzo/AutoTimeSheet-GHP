(() => {
  'use strict';

  const calendarDataUrl = '../data/calendar/events.json';
  const outlookUrl = 'https://outlook.cloud.microsoft/calendar/Amanda.BB@gmt-services.co.uk/view/month';
  let viewDate = new Date();
  let publishedEvents = [];

  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));

  function dateKey(value) {
    return String(value || '').slice(0, 10);
  }

  function eventRecordId(event) {
    return String(event && (event.recordId || event.record_id || event.source_record_id || event.id) || '');
  }

  function eventKind(event) {
    return String(event && (event.type || event.kind || 'general') || '');
  }

  function eventCategory(event) {
    const kind = String(event && (event.type || event.kind || event.recordKind) || '').toLowerCase();
    if (/timesheet|clock|absence|holiday|sick|time.?off/.test(kind)) return 'timesheets';
    if (/job.?card|jobcard/.test(kind)) return 'jobcards';
    if (/estimate|quote/.test(kind)) return 'estimates';
    if (/task/.test(kind)) return 'tasks';
    if (/enquir|contact/.test(kind)) return 'enquiries';
    if (/invoice/.test(kind)) return 'invoices';
    if (/calendar|event|training|meeting/.test(kind)) return 'calendar';
    return 'other';
  }

  function eventVisible(event) {
    const filterGroup = $('[data-calendar-filters]');
    if (!filterGroup) return true;
    const input = filterGroup.querySelector(`[data-calendar-filter="${eventCategory(event)}"]`);
    return !input || input.checked;
  }

  function payWeekBadge(key) {
    const periods = window.GMTPayPeriods;
    const period = periods && typeof periods.periodForDate === 'function' ? periods.periodForDate(key) : null;
    return period && period.start === key ? '<span class="calendar-week-badge">(W1)</span>' : '';
  }

  function eventCanEdit(event) {
    return !!(event && (event.can_edit === true || event.canEdit === true));
  }

  function eventCanDelete(event) {
    return !!(event && (event.can_delete === true || event.canDelete === true));
  }

  function eventIdentity(event) {
    // Daily rows from one weekly submission share a parent recordId. Prefer
    // the row-level id first so each filled date remains visible on the
    // calendar while recordId still points actions back to the submission.
    return String(event && event.id || '') || eventRecordId(event) || [dateKey(event && (event.date || event.startDate)), event && event.title, event && event.type, event && event.owner].join('|');
  }

  function mergeEvents() {
    const values = Array.from(arguments).flat();
    const helper = window.GMTCalendarData;
    if (helper && typeof helper.mergeEvents === 'function') return helper.mergeEvents(values);
    const seen = new Set();
    return values.filter((event) => {
      if (!event || !dateKey(event.date || event.startDate)) return false;
      const id = eventIdentity(event);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function isCurrentPayMonth(key) {
    // The calendar is also a creation surface. Keep every valid date
    // actionable; the timesheet form assigns its payroll workbook by date.
    return /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''));
  }

  function allEvents() {
    const events = publishedEvents.filter((event) => event && dateKey(event.date || event.startDate));
    const seen = new Set();
    return events.filter((event) => {
      const key = event.id || [event.date || event.startDate, event.title, event.type, event.owner].join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function renderMonth() {
    const grid = $('#calendar-month-grid');
    const title = $('#calendar-view-heading');
    if (!grid || !title) return;

    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    title.textContent = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(viewDate);
    const firstDay = new Date(year, month, 1);
    const offset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const eventsByDay = allEvents().filter(eventVisible).reduce((map, event) => {
      const key = dateKey(event.date || event.startDate);
      (map[key] ||= []).push(event);
      return map;
    }, {});
    const today = dateKey(new Date().toISOString());
    const cells = [];

    for (let blank = 0; blank < offset; blank += 1) cells.push('<div class="calendar-day calendar-day-empty" aria-hidden="true"></div>');
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const events = eventsByDay[key] || [];
      const eventMarkup = events.map((event, eventIndex) => {
        const label = `${event.title || event.type || 'Event'}${event.detail ? ` · ${event.detail}` : ''}`;
        return `<button type="button" class="calendar-event calendar-event-${escapeHtml(String(event.type || 'general').toLowerCase().replace(/[^a-z]+/g, '-'))}${eventIndex > 2 ? ' is-overflow' : ''}" data-calendar-record-id="${escapeHtml(eventRecordId(event))}" data-calendar-record-kind="${escapeHtml(eventKind(event))}" data-calendar-can-edit="${String(eventCanEdit(event))}" data-calendar-can-delete="${String(eventCanDelete(event))}" data-calendar-preview-title="${escapeHtml(event.title || event.type || 'Event')}" data-calendar-preview="${escapeHtml(event.detail || label)}" data-calendar-preview-status="${escapeHtml(event.status || '')}" data-calendar-date="${escapeHtml(key)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${escapeHtml(event.title || event.type || 'Event')}</button>`;
      }).join('');
      const more = events.length > 3 ? `<button type="button" class="calendar-more" data-calendar-open-day="${key}" aria-label="Show all ${events.length} entries for ${key}">+${events.length - 3} more</button>` : '';
      const dateMarkup = isCurrentPayMonth(key)
        ? `<button type="button" class="calendar-day-date" data-calendar-day="${key}" aria-label="Actions for ${key}">${day}</button>`
        : `<time datetime="${key}">${day}</time>`;
      const weekStart = payWeekBadge(key);
      cells.push(`<article class="calendar-day${key === today ? ' calendar-day-today' : ''}${weekStart ? ' is-pay-week-start' : ''}">${dateMarkup}${weekStart}${eventMarkup}${more}</article>`);
    }
    grid.innerHTML = cells.join('');
  }

  async function loadPublishedEvents() {
    const status = $('#calendar-sync-status');
    const localEvents = window.GMTCalendarData && typeof window.GMTCalendarData.localEvents === 'function'
      ? window.GMTCalendarData.localEvents()
      : [];
    let feedEvents = [];
    let feedLoaded = false;
    try {
      const response = await fetch(`${calendarDataUrl}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Calendar feed unavailable');
      const payload = await response.json();
      feedEvents = Array.isArray(payload) ? payload : (Array.isArray(payload.events) ? payload.events : []);
      feedLoaded = true;
    } catch (_) {
      feedLoaded = false;
    }
    publishedEvents = mergeEvents(feedEvents, localEvents);
    if (status) {
      if (publishedEvents.length) {
        const parts = [];
        if (feedEvents.length) parts.push(`${feedEvents.length} published`);
        if (localEvents.length) parts.push(`${localEvents.length} local`);
        status.textContent = `Shared feed connected: ${parts.join(' and ')} event${publishedEvents.length === 1 ? '' : 's'}.`;
      } else if (feedLoaded) {
        status.textContent = 'Shared feed connected. No published events yet.';
      } else {
        status.textContent = 'Shared feed is temporarily unavailable. No local requests were found.';
      }
    }
    renderMonth();
  }

  async function loadProtectedEvents() {
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== 'function' || !window.GMTPortalApi.enabled()) return;
    try {
      // Use the same all-records interpretation as the dashboard and
      // Submitted documents calendar. This includes dated timesheet rows,
      // calendar requests and other authorised operational records.
      const body = await window.GMTPortalApi.history('all');
      const records = body && Array.isArray(body.records) ? body.records : [];
      const meta = body && body.meta && typeof body.meta === 'object' ? body.meta : {};
      const helper = window.GMTCalendarData;
      const derived = helper && typeof helper.recordsToEvents === 'function'
        ? helper.recordsToEvents(records, { employees: meta.completion && meta.completion.employees || [] })
        : records.filter((record) => record && (record.event_date || record.record_date)).map((record) => ({
          id: record.source_record_id,
          recordId: record.source_record_id,
          title: record.event_title || record.employee_name || 'Untitled event',
          date: record.event_date || record.record_date || '',
          type: record.event_type || record.kind || 'General',
          owner: record.owner || record.employee_name || '',
          status: record.status || 'Submitted',
          detail: record.notes || record.detail || '',
          can_edit: record.can_edit === true,
          can_delete: record.can_delete === true
        }));
      publishedEvents = mergeEvents(publishedEvents, derived);
      const status = $('#calendar-sync-status');
      if (status && derived.length) {
        const baseStatus = status.textContent.replace(' No published events yet.', '');
        status.textContent = baseStatus + ' Protected entries: ' + derived.length + '.';
      }
      renderMonth();
    } catch (_) {
      // The static published feed remains usable if protected history is unavailable.
    }
  }

  function init() {
    const outlook = $('#open-outlook-calendar');
    if (outlook) outlook.href = outlookUrl;
    const params = new URLSearchParams(window.location.search || '');
    if (params.get('request') === 'time-off') {
      const title = $('#calendar-title');
      const type = $('#calendar-type');
      if (title && !title.value) title.value = 'Time off request';
      if (type) type.value = 'Holiday';
      const date = $('#calendar-date');
      const requestedDate = params.get('date');
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '')) date.value = requestedDate;
      if (date && typeof date.focus === 'function') setTimeout(() => date.focus(), 0);
    } else {
      const date = $('#calendar-date');
      const requestedDate = params.get('date');
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '')) date.value = requestedDate;
    }
    $('#calendar-previous')?.addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderMonth(); });
    $('#calendar-next')?.addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderMonth(); });
    $('[data-calendar-filters]')?.addEventListener('change', renderMonth);
    $('#calendar-form')?.addEventListener('submit', () => setTimeout(renderMonth, 0));
    $('#calendar-list')?.addEventListener('click', () => setTimeout(renderMonth, 0));
    loadPublishedEvents().then(loadProtectedEvents);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
