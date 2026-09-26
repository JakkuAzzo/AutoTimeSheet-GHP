(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GMTTimesheetRows = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DEFAULT_START = '08:00';
  var DEFAULT_FINISH = '17:00';

  function validDate(value) {
    var match = String(value || '').slice(0, 10).match(DATE_PATTERN);
    if (!match) return null;
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (Number.isNaN(date.getTime())) return null;
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
    return date;
  }

  function dateKey(date) {
    return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
  }

  function addDays(value, amount) {
    var date = validDate(value);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + Number(amount || 0));
    return dateKey(date);
  }

  function isWeekendDate(value) {
    var date = validDate(value);
    if (!date) return false;
    var day = date.getUTCDay();
    return day === 0 || day === 6;
  }

  function weekDates(start, includeWeekend) {
    var first = validDate(start);
    if (!first) return [];
    var count = includeWeekend ? 7 : 5;
    var rows = [];
    for (var index = 0; index < count; index += 1) rows.push(addDays(dateKey(first), index));
    return rows;
  }

  function isUntouchedWeekendRow(row) {
    if (!row || !isWeekendDate(row.date)) return false;
    if (row.weekendEdited === true) return false;
    return String(row.start || DEFAULT_START) === DEFAULT_START
      && String(row.finish || DEFAULT_FINISH) === DEFAULT_FINISH
      && Number(row.lunchMinutes || 0) === 0
      && String(row.absenceStatus || 'NA') === 'NA'
      && !String(row.description || '').trim();
  }

  function filterSubmittedRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return !isUntouchedWeekendRow(row);
    });
  }

  function rangeIncludesWeekend(start, end) {
    var first = validDate(start);
    var last = validDate(end);
    if (!first || !last || first > last) return false;
    var cursor = new Date(first.getTime());
    while (cursor <= last) {
      if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) return true;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return false;
  }

  return {
    addDays: addDays,
    isWeekendDate: isWeekendDate,
    weekDates: weekDates,
    isUntouchedWeekendRow: isUntouchedWeekendRow,
    filterSubmittedRows: filterSubmittedRows,
    rangeIncludesWeekend: rangeIncludesWeekend
  };
}));
