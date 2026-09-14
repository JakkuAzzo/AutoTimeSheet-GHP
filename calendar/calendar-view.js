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
    const eventsByDay = allEvents().reduce((map, event) => {
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
      const eventMarkup = events.slice(0, 3).map((event) => `<span class="calendar-event calendar-event-${escapeHtml(String(event.type || 'general').toLowerCase().replace(/[^a-z]+/g, '-'))}" title="${escapeHtml(event.title || 'Untitled event')}">${escapeHtml(event.title || event.type || 'Event')}</span>`).join('');
      const more = events.length > 3 ? `<span class="calendar-more">+${events.length - 3} more</span>` : '';
      cells.push(`<article class="calendar-day${key === today ? ' calendar-day-today' : ''}"><time datetime="${key}">${day}</time>${eventMarkup}${more}</article>`);
    }
    grid.innerHTML = cells.join('');
  }

  async function loadPublishedEvents() {
    const status = $('#calendar-sync-status');
    try {
      const response = await fetch(`${calendarDataUrl}?v=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Calendar feed unavailable');
      const payload = await response.json();
      publishedEvents = Array.isArray(payload) ? payload : (Array.isArray(payload.events) ? payload.events : []);
      status.textContent = publishedEvents.length ? `Shared feed: ${publishedEvents.length} published event${publishedEvents.length === 1 ? '' : 's'}.` : 'Shared feed connected. No published events yet.';
    } catch (_) {
      publishedEvents = [];
      status.textContent = 'Shared feed is not available yet. No local requests are published here.';
    }
    renderMonth();
  }

  async function loadProtectedEvents() {
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== 'function' || !window.GMTPortalApi.enabled()) return;
    try {
      const body = await window.GMTPortalApi.history('calendar');
      const records = (body && Array.isArray(body.records) ? body.records : []).map((record) => ({
        id: record.source_record_id,
        title: record.event_title || 'Untitled event',
        date: record.event_date || record.record_date || '',
        type: record.event_type || 'General',
        owner: record.owner || record.employee_name || '',
        status: record.status || 'Pending approval'
      }));
      const existing = new Set(publishedEvents.map((event) => String(event.id || '')));
      publishedEvents = publishedEvents.concat(records.filter((event) => event.date && !existing.has(String(event.id))));
      const status = $('#calendar-sync-status');
      if (status && records.length) status.textContent = status.textContent + ' Protected requests: ' + records.length + '.';
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
      if (date && typeof date.focus === 'function') setTimeout(() => date.focus(), 0);
    }
    $('#calendar-previous')?.addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1); renderMonth(); });
    $('#calendar-next')?.addEventListener('click', () => { viewDate = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1); renderMonth(); });
    $('#calendar-form')?.addEventListener('submit', () => setTimeout(renderMonth, 0));
    $('#calendar-list')?.addEventListener('click', () => setTimeout(renderMonth, 0));
    loadPublishedEvents().then(loadProtectedEvents);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
