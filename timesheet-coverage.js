(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GMTTimesheetCoverage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function dateKey(value) {
    var match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  }

  function rowsFor(record) {
    var payload = record && record.payload && typeof record.payload === 'object' ? record.payload : {};
    if (Array.isArray(payload.rows)) return payload.rows;
    if (Array.isArray(payload.dailyRows)) return payload.dailyRows;
    if (Array.isArray(record && record.daily_rows)) return record.daily_rows;
    if (payload.row && typeof payload.row === 'object') return [Object.assign({ date: record.record_date || payload.date }, payload.row)];
    return [];
  }

  function rowDate(row) {
    return dateKey(row && (row.date || row.recordDate || row.record_date || row.workDate || row.Date));
  }

  function rowState(row) {
    if (!row || row.scheduled === false || row.deleted) return '';
    var absence = String(row.absenceStatus || row.absenceReason || row['Absence reason'] || row.absence || row.absence_reason || '').trim();
    if (absence && !/^(na|n\/a|none|worked)$/i.test(absence)) return 'absent';
    var start = String(row.start || row.Start || row.startTime || row.start_time || row.clockIn || '').match(/^(\d{1,2}):(\d{2})/);
    var finish = String(row.finish || row.Finish || row.finishTime || row.finish_time || row.clockOut || '').match(/^(\d{1,2}):(\d{2})/);
    if (!start || !finish) return 'partial';
    var startMinutes = Number(start[1]) * 60 + Number(start[2]);
    var finishMinutes = Number(finish[1]) * 60 + Number(finish[2]);
    if (startMinutes >= finishMinutes || finishMinutes > 1440) return 'partial';
    return 'recorded';
  }

  function summarize(options) {
    var period = options && options.period;
    if (!period || !dateKey(period.start) || !dateKey(period.end)) return null;
    var email = String(options.employeeEmail || '').trim().toLowerCase();
    var workdays = Array.isArray(options.workdays) && options.workdays.length ? options.workdays : [1, 2, 3, 4, 5];
    var states = {};
    var records = Array.isArray(options.records) ? options.records : [];
    records.filter(function (record) {
      return record && !record.is_demo && !record.synthetic && String(record.status || '').toLowerCase() !== 'deleted'
        && String(record.employee_upn || record.employeeEmail || record.employee_email || '').trim().toLowerCase() === email;
    }).sort(function (a, b) {
      return Date.parse(a.updated_at || a.updatedAt || a.submitted_at || '') - Date.parse(b.updated_at || b.updatedAt || b.submitted_at || '');
    }).forEach(function (record) {
      rowsFor(record).forEach(function (row) {
        var date = rowDate(row);
        var state = rowState(row);
        if (date && state && (!states[date] || state !== 'partial')) states[date] = state;
      });
    });
    (options.submittedRows || []).forEach(function (row) {
      var date = rowDate(row);
      var state = rowState(row);
      if (date && state && (!states[date] || state !== 'partial')) states[date] = state;
    });
    var today = dateKey(options.today || new Date().toISOString());
    var expected = [];
    for (var date = new Date(period.start + 'T12:00:00Z'), end = new Date(period.end + 'T12:00:00Z'); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
      var weekday = date.getUTCDay() || 7;
      if (workdays.indexOf(weekday) !== -1) expected.push(date.toISOString().slice(0, 10));
    }
    return {
      payMonth: period.key,
      expected: expected,
      recorded: expected.filter(function (date) { return states[date] === 'recorded'; }),
      absent: expected.filter(function (date) { return states[date] === 'absent'; }),
      partial: expected.filter(function (date) { return states[date] === 'partial'; }),
      overdue: expected.filter(function (date) { return date <= today && states[date] !== 'recorded' && states[date] !== 'absent'; }),
      upcoming: expected.filter(function (date) { return date > today && states[date] !== 'recorded' && states[date] !== 'absent'; })
    };
  }

  function receiptText(coverage) {
    if (!coverage) return 'Pay-month coverage could not be checked. Open Submitted documents to review your remaining days.';
    var completed = coverage.recorded.length + coverage.absent.length;
    return 'Pay month ' + coverage.payMonth + ': ' + completed + ' of ' + coverage.expected.length + ' scheduled days recorded or explained as absent. '
      + 'Still needing an entry or absence explanation through today: ' + (coverage.overdue.join(', ') || 'none') + '. '
      + 'Upcoming scheduled days: ' + (coverage.upcoming.join(', ') || 'none') + '.';
  }

  async function fromPortal(api, payPeriods, payMonth, employeeEmail, submittedRows, today) {
    if (!api || typeof api.enabled !== 'function' || !api.enabled() || typeof api.history !== 'function') return null;
    var period = payPeriods && payPeriods.periodForMonth && payPeriods.periodForMonth(payMonth);
    if (!period) return null;
    try {
      var response = await api.history('all');
      var employees = response && response.meta && response.meta.completion && response.meta.completion.employees || [];
      var employee = employees.find(function (entry) {
        return String(entry.employee_upn || '').trim().toLowerCase() === String(employeeEmail || '').trim().toLowerCase();
      });
      return summarize({
        period: period,
        employeeEmail: employeeEmail,
        records: response && response.records || [],
        submittedRows: submittedRows,
        workdays: employee && employee.schedule_weekdays || [1, 2, 3, 4, 5],
        today: today
      });
    } catch (_) {
      return null;
    }
  }

  return { summarize: summarize, receiptText: receiptText, rowState: rowState, fromPortal: fromPortal };
}));
