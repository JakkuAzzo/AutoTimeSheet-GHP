(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GMTPayPeriods = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // GMT uses a fixed four-week payroll cycle. The current cycle starts on
  // Monday 24 August 2026 and its payroll Friday is 18 September 2026. The
  // two weekend days after that Friday remain with the same pay-month
  // workbook, so a cycle covers Monday through Sunday while its displayed
  // payroll end is the Friday in week four. Future cycles repeat every 28
  // days and are labelled by the calendar month containing their Friday end.
  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  var ANCHOR = new Date(Date.UTC(2026, 7, 24));
  var CYCLE_DAYS = 28;
  var PAYROLL_END_OFFSET = 25;

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function validDate(value) {
    var match = String(value || '').slice(0, 10).match(DATE_PATTERN);
    if (!match) return null;
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (Number.isNaN(date.getTime())) return null;
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
    return date;
  }

  function dateKey(date) {
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate());
  }

  function monthKey(date) {
    return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1);
  }

  function dayDifference(left, right) {
    return Math.floor((left.getTime() - right.getTime()) / 86400000);
  }

  function cycleOffsetForDate(date) {
    return Math.floor(dayDifference(date, ANCHOR) / CYCLE_DAYS);
  }

  function periodForOffset(offset) {
    var start = new Date(ANCHOR.getTime());
    start.setUTCDate(start.getUTCDate() + (Number(offset) * CYCLE_DAYS));
    var end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + PAYROLL_END_OFFSET);
    return { key: monthKey(end), start: dateKey(start), end: dateKey(end) };
  }

  function periodForDate(value) {
    var date = validDate(value);
    if (!date) return null;
    return periodForOffset(cycleOffsetForDate(date));
  }

  function periodForMonth(key) {
    if (!String(key || '').match(/^\d{4}-\d{2}$/)) return null;
    var match = String(key).match(/^(\d{4})-(\d{2})$/);
    var monthStart = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    var estimatedOffset = Math.floor(dayDifference(monthStart, ANCHOR) / CYCLE_DAYS);
    var matches = [];
    // A 28-day cycle can put two payroll Fridays in one calendar month. Keep
    // the candidate closest to the anchor for the labelled pay-month lookup;
    // date-based routing always uses the exact cycle containing the date.
    for (var offset = estimatedOffset - 4; offset <= estimatedOffset + 4; offset += 1) {
      var candidate = periodForOffset(offset);
      if (candidate.key === key) matches.push({ period: candidate, distance: Math.abs(offset) });
    }
    if (!matches.length) return null;
    matches.sort(function (left, right) { return left.distance - right.distance; });
    return matches[0].period;
  }

  function payMonthKeyForDate(value) {
    var period = periodForDate(value);
    return period ? period.key : '';
  }

  function payMonthKeyForWeek(weekStart, weekEnd) {
    return payMonthKeyForDate(weekStart || weekEnd);
  }

  // A correction window stays open for the current payroll cycle and the
  // immediately preceding cycle. Older payroll workbooks remain readable,
  // but are intentionally treated as closed for normal staff corrections.
  function previousPayMonthKey(monthKey) {
    var period = periodForMonth(monthKey);
    if (!period) return '';
    var previousDate = validDate(period.start);
    if (!previousDate) return '';
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    return payMonthKeyForDate(dateKey(previousDate));
  }

  function editablePayMonthKeys(value) {
    var current = /^\d{4}-\d{2}$/.test(String(value || ''))
      ? String(value)
      : payMonthKeyForDate(value || dateKey(new Date()));
    if (!current) return [];
    var previous = previousPayMonthKey(current);
    return [current, previous].filter(function (key, index, keys) {
      return key && keys.indexOf(key) === index;
    });
  }

  function periodLabelForDate(value) {
    var period = periodForDate(value);
    return period ? period.start + ' to ' + period.end : '';
  }

  return {
    payMonthKeyForDate: payMonthKeyForDate,
    payMonthKeyForWeek: payMonthKeyForWeek,
    previousPayMonthKey: previousPayMonthKey,
    editablePayMonthKeys: editablePayMonthKeys,
    periodForMonth: periodForMonth,
    periodForDate: periodForDate,
    periodLabelForDate: periodLabelForDate
  };
}));
