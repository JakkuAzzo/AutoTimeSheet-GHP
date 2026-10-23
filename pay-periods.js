(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GMTPayPeriods = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // The historical 28-day schedule remains the default. An authorised D1
  // start-date override resets the cycle phase from its selected pay month.
  var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  var ANCHOR = new Date(Date.UTC(2026, 7, 24));
  var CYCLE_DAYS = 28;
  var PAYROLL_END_OFFSET = 25;
  var DAY_MS = 86400000;

  function pad(value) { return String(value).padStart(2, '0'); }

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

  function validMonthKey(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')); }

  function shiftDate(value, days) {
    var date = validDate(value);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + Number(days));
    return dateKey(date);
  }

  function monthOffset(left, right) {
    var a = String(left || '').match(/^(\d{4})-(\d{2})$/);
    var b = String(right || '').match(/^(\d{4})-(\d{2})$/);
    return a && b ? (Number(a[1]) - Number(b[1])) * 12 + Number(a[2]) - Number(b[2]) : 0;
  }

  function adjacentMonth(key, amount) {
    var match = String(key || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return '';
    var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(amount || 0), 1));
    return monthKey(date);
  }

  function dayDifference(left, right) {
    return Math.floor((left.getTime() - right.getTime()) / DAY_MS);
  }

  function payrollFridayBefore(nextStart) {
    var date = validDate(nextStart);
    if (!date) return '';
    var daysSinceFriday = (date.getUTCDay() + 2) % 7;
    if (daysSinceFriday === 0) daysSinceFriday = 7;
    date.setUTCDate(date.getUTCDate() - daysSinceFriday);
    return dateKey(date);
  }

  function normalizedOverrides(source) {
    var values = Array.isArray(source) ? source : Object.keys(source || {}).map(function (key) {
      return { monthKey: key, startDate: source[key] };
    });
    var result = {};
    values.forEach(function (entry) {
      var key = String(entry && (entry.monthKey || entry.month_key) || '');
      var start = String(entry && (entry.startDate || entry.start_date) || '').slice(0, 10);
      if (validMonthKey(key) && validDate(start)) result[key] = start;
    });
    return result;
  }

  function createPayPeriods(initialOverrides) {
    var starts = normalizedOverrides(initialOverrides);
    var anchorKey = monthKey(new Date(ANCHOR.getTime() + PAYROLL_END_OFFSET * DAY_MS));

    function sortedOverrides() {
      return Object.keys(starts).map(function (key) { return { key: key, start: starts[key] }; })
        .sort(function (left, right) { return left.start.localeCompare(right.start); });
    }

    function rawBasePeriod(date) {
      var offset = Math.floor(dayDifference(date, ANCHOR) / CYCLE_DAYS);
      var start = new Date(ANCHOR.getTime());
      start.setUTCDate(start.getUTCDate() + offset * CYCLE_DAYS);
      var end = new Date(start.getTime());
      end.setUTCDate(end.getUTCDate() + PAYROLL_END_OFFSET);
      return { key: monthKey(end), start: dateKey(start), offset: offset, phaseKey: '' };
    }

    function rawOverridePeriod(date, override) {
      var anchor = validDate(override.start);
      var offset = Math.floor(dayDifference(date, anchor) / CYCLE_DAYS);
      var start = new Date(anchor.getTime());
      start.setUTCDate(start.getUTCDate() + offset * CYCLE_DAYS);
      var startValue = dateKey(start);
      return { key: adjacentMonth(override.key, offset), start: startValue, offset: offset, phaseKey: override.key };
    }

    function periodObject(key, start, nextStart) {
      var friday = payrollFridayBefore(nextStart);
      return {
        key: key,
        start: start,
        end: friday,
        payrollEnd: friday,
        payrollFriday: friday,
        nextStart: nextStart,
        cycleEnd: shiftDate(nextStart, -1)
      };
    }

    function periodForDate(value) {
      var date = validDate(value);
      if (!date) return null;
      var ordered = sortedOverrides();
      var active = null;
      var upcoming = null;
      ordered.forEach(function (item) {
        if (item.start <= dateKey(date)) active = item;
        else if (!upcoming) upcoming = item;
      });

      var candidate = active ? rawOverridePeriod(date, active) : rawBasePeriod(date);
      if (upcoming && candidate.key === upcoming.key) {
        candidate.key = adjacentMonth(upcoming.key, -1);
        candidate.start = shiftDate(candidate.start, -CYCLE_DAYS);
      }

      var nextKey = adjacentMonth(candidate.key, 1);
      var nextOverride = starts[nextKey] && starts[nextKey] > candidate.start ? starts[nextKey] : '';
      var nextStart = nextOverride || shiftDate(candidate.start, CYCLE_DAYS);
      return periodObject(candidate.key, candidate.start, nextStart);
    }

    function periodForMonth(key) {
      if (!validMonthKey(key)) return null;
      var candidates = [];
      var nextKey = adjacentMonth(key, 1);
      var nextStartOverride = starts[nextKey] || '';

      function addCandidate(start) {
        var date = validDate(start);
        if (!date) return;
        var period = periodForDate(start);
        if (!period || period.key !== key || period.start !== start) return;
        if (nextStartOverride && nextStartOverride > period.start) period.nextStart = nextStartOverride;
        period.end = payrollFridayBefore(period.nextStart);
        period.payrollEnd = period.end;
        period.payrollFriday = period.end;
        period.cycleEnd = shiftDate(period.nextStart, -1);
        if (!candidates.some(function (candidate) { return candidate.start === period.start; })) candidates.push(period);
      }

      if (starts[key]) addCandidate(starts[key]);

      var estimate = Math.round(monthOffset(key, anchorKey) * 30.436875 / CYCLE_DAYS);
      for (var baseOffset = estimate - 8; baseOffset <= estimate + 8; baseOffset += 1) {
        var baseStart = new Date(ANCHOR.getTime());
        baseStart.setUTCDate(baseStart.getUTCDate() + baseOffset * CYCLE_DAYS);
        var ordered = sortedOverrides();
        if (ordered.length && dateKey(baseStart) >= ordered[0].start) continue;
        addCandidate(dateKey(baseStart));
      }

      sortedOverrides().forEach(function (override, index, values) {
        var estimateFromOverride = Math.round(monthOffset(key, override.key) * 30.436875 / CYCLE_DAYS);
        var nextOverride = values[index + 1];
        var firstOffset = Math.max(0, estimateFromOverride - 8);
        var lastOffset = Math.max(firstOffset, estimateFromOverride + 8);
        for (var offset = firstOffset; offset <= lastOffset; offset += 1) {
          var candidateStart = shiftDate(override.start, offset * CYCLE_DAYS);
          if (nextOverride && candidateStart >= nextOverride.start) continue;
          addCandidate(candidateStart);
        }
      });

      if (!candidates.length) return null;
      candidates.sort(function (left, right) {
        var leftDistance = Math.abs(dayDifference(validDate(left.start), ANCHOR));
        var rightDistance = Math.abs(dayDifference(validDate(right.start), ANCHOR));
        return leftDistance - rightDistance;
      });
      return candidates[0];
    }

    function payMonthKeyForDate(value) {
      var period = periodForDate(value);
      return period ? period.key : '';
    }

    function payMonthKeyForWeek(weekStart, weekEnd) { return payMonthKeyForDate(weekStart || weekEnd); }

    function previousPayMonthKey(key) {
      var period = periodForMonth(key);
      if (!period) return '';
      var previousDate = validDate(period.start);
      previousDate.setUTCDate(previousDate.getUTCDate() - 1);
      return payMonthKeyForDate(dateKey(previousDate));
    }

    function editablePayMonthKeys(value) {
      var current = validMonthKey(value) ? String(value) : payMonthKeyForDate(value || dateKey(new Date()));
      if (!current) return [];
      var previous = previousPayMonthKey(current);
      return [current, previous].filter(function (key, index, keys) { return key && keys.indexOf(key) === index; });
    }

    function periodLabelForDate(value) {
      var period = periodForDate(value);
      return period ? period.start + ' to ' + period.cycleEnd : '';
    }

    function nextPayMonthKey(key) {
      var period = periodForMonth(key);
      return period ? payMonthKeyForDate(period.nextStart) : '';
    }

    function replaceStartDates(values) { starts = normalizedOverrides(values); }

    return {
      payMonthKeyForDate: payMonthKeyForDate,
      payMonthKeyForWeek: payMonthKeyForWeek,
      previousPayMonthKey: previousPayMonthKey,
      editablePayMonthKeys: editablePayMonthKeys,
      periodForMonth: periodForMonth,
      periodForDate: periodForDate,
      periodLabelForDate: periodLabelForDate,
      nextPayMonthKey: nextPayMonthKey,
      getStartDates: function () { return Object.assign({}, starts); },
      replaceStartDates: replaceStartDates
    };
  }

  var api = createPayPeriods({});
  api.createPayPeriods = createPayPeriods;
  api.ready = Promise.resolve(null);
  api.canManagePayMonthStarts = false;
  api.settingsLoaded = false;

  if (typeof module !== 'object' && root && root.document) {
    api.ready = Promise.resolve().then(function () {
      var portalApi = root.GMTPortalApi;
      if (!portalApi || typeof portalApi.payMonthStarts !== 'function' || (portalApi.enabled && !portalApi.enabled())) return null;
      return portalApi.payMonthStarts();
    }).then(function (settings) {
      if (!settings || typeof settings !== 'object') return null;
      api.replaceStartDates(settings.startDates || {});
      api.canManagePayMonthStarts = settings.canManage === true;
      api.settingsLoaded = true;
      api.currentMonthKey = String(settings.currentMonthKey || '');
      api.nextMonthKey = String(settings.nextMonthKey || '');
      return settings;
    }).catch(function (error) {
      api.settingsError = error || new Error('Pay-month settings are unavailable');
      return null;
    });
  }

  return api;
}));
