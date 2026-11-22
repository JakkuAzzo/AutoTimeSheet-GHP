var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value2) => __defProp(target, "name", { value: value2, configurable: true });
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../pay-periods.js
var require_pay_periods = __commonJS({
  "../pay-periods.js"(exports, module) {
    (function(root, factory) {
      var api = factory(root);
      if (typeof module === "object" && module.exports) module.exports = api;
      else root.GMTPayPeriods = api;
    })(typeof globalThis !== "undefined" ? globalThis : exports, function(root) {
      "use strict";
      var DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
      var ANCHOR = new Date(Date.UTC(2026, 7, 24));
      var CYCLE_DAYS = 28;
      var PAYROLL_END_OFFSET = 25;
      var DAY_MS = 864e5;
      function pad(value2) {
        return String(value2).padStart(2, "0");
      }
      __name(pad, "pad");
      function validDate3(value2) {
        var match = String(value2 || "").slice(0, 10).match(DATE_PATTERN);
        if (!match) return null;
        var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
        if (Number.isNaN(date.getTime())) return null;
        if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return null;
        return date;
      }
      __name(validDate3, "validDate");
      function dateKey(date) {
        return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate());
      }
      __name(dateKey, "dateKey");
      function monthKey(date) {
        return date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1);
      }
      __name(monthKey, "monthKey");
      function validMonthKey(value2) {
        return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value2 || ""));
      }
      __name(validMonthKey, "validMonthKey");
      function shiftDate(value2, days) {
        var date = validDate3(value2);
        if (!date) return "";
        date.setUTCDate(date.getUTCDate() + Number(days));
        return dateKey(date);
      }
      __name(shiftDate, "shiftDate");
      function monthOffset(left, right) {
        var a = String(left || "").match(/^(\d{4})-(\d{2})$/);
        var b = String(right || "").match(/^(\d{4})-(\d{2})$/);
        return a && b ? (Number(a[1]) - Number(b[1])) * 12 + Number(a[2]) - Number(b[2]) : 0;
      }
      __name(monthOffset, "monthOffset");
      function adjacentMonth(key, amount) {
        var match = String(key || "").match(/^(\d{4})-(\d{2})$/);
        if (!match) return "";
        var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1 + Number(amount || 0), 1));
        return monthKey(date);
      }
      __name(adjacentMonth, "adjacentMonth");
      function dayDifference(left, right) {
        return Math.floor((left.getTime() - right.getTime()) / DAY_MS);
      }
      __name(dayDifference, "dayDifference");
      function payrollFridayBefore(nextStart) {
        var date = validDate3(nextStart);
        if (!date) return "";
        var daysSinceFriday = (date.getUTCDay() + 2) % 7;
        if (daysSinceFriday === 0) daysSinceFriday = 7;
        date.setUTCDate(date.getUTCDate() - daysSinceFriday);
        return dateKey(date);
      }
      __name(payrollFridayBefore, "payrollFridayBefore");
      function normalizedOverrides(source) {
        var values = Array.isArray(source) ? source : Object.keys(source || {}).map(function(key) {
          return { monthKey: key, startDate: source[key] };
        });
        var result = {};
        values.forEach(function(entry) {
          var key = String(entry && (entry.monthKey || entry.month_key) || "");
          var start = String(entry && (entry.startDate || entry.start_date) || "").slice(0, 10);
          if (validMonthKey(key) && validDate3(start)) result[key] = start;
        });
        return result;
      }
      __name(normalizedOverrides, "normalizedOverrides");
      function createPayPeriods(initialOverrides) {
        var starts = normalizedOverrides(initialOverrides);
        var anchorKey = monthKey(new Date(ANCHOR.getTime() + PAYROLL_END_OFFSET * DAY_MS));
        function sortedOverrides() {
          return Object.keys(starts).map(function(key) {
            return { key, start: starts[key] };
          }).sort(function(left, right) {
            return left.start.localeCompare(right.start);
          });
        }
        __name(sortedOverrides, "sortedOverrides");
        function rawBasePeriod(date) {
          var offset = Math.floor(dayDifference(date, ANCHOR) / CYCLE_DAYS);
          var start = new Date(ANCHOR.getTime());
          start.setUTCDate(start.getUTCDate() + offset * CYCLE_DAYS);
          var end = new Date(start.getTime());
          end.setUTCDate(end.getUTCDate() + PAYROLL_END_OFFSET);
          return { key: monthKey(end), start: dateKey(start), offset, phaseKey: "" };
        }
        __name(rawBasePeriod, "rawBasePeriod");
        function rawOverridePeriod(date, override) {
          var anchor = validDate3(override.start);
          var offset = Math.floor(dayDifference(date, anchor) / CYCLE_DAYS);
          var start = new Date(anchor.getTime());
          start.setUTCDate(start.getUTCDate() + offset * CYCLE_DAYS);
          var startValue = dateKey(start);
          return { key: adjacentMonth(override.key, offset), start: startValue, offset, phaseKey: override.key };
        }
        __name(rawOverridePeriod, "rawOverridePeriod");
        function periodObject(key, start, nextStart) {
          var friday = payrollFridayBefore(nextStart);
          return {
            key,
            start,
            end: friday,
            payrollEnd: friday,
            payrollFriday: friday,
            nextStart,
            cycleEnd: shiftDate(nextStart, -1)
          };
        }
        __name(periodObject, "periodObject");
        function periodForDate(value2) {
          var date = validDate3(value2);
          if (!date) return null;
          var ordered = sortedOverrides();
          var active = null;
          var upcoming = null;
          ordered.forEach(function(item) {
            if (item.start <= dateKey(date)) active = item;
            else if (!upcoming) upcoming = item;
          });
          var candidate = active ? rawOverridePeriod(date, active) : rawBasePeriod(date);
          if (upcoming && candidate.key === upcoming.key) {
            candidate.key = adjacentMonth(upcoming.key, -1);
            candidate.start = shiftDate(candidate.start, -CYCLE_DAYS);
          }
          var nextKey = adjacentMonth(candidate.key, 1);
          var nextOverride = starts[nextKey] && starts[nextKey] > candidate.start ? starts[nextKey] : "";
          var nextStart = nextOverride || shiftDate(candidate.start, CYCLE_DAYS);
          return periodObject(candidate.key, candidate.start, nextStart);
        }
        __name(periodForDate, "periodForDate");
        function periodForMonth(key) {
          if (!validMonthKey(key)) return null;
          var candidates = [];
          var nextKey = adjacentMonth(key, 1);
          var nextStartOverride = starts[nextKey] || "";
          function addCandidate(start) {
            var date = validDate3(start);
            if (!date) return;
            var period = periodForDate(start);
            if (!period || period.key !== key || period.start !== start) return;
            if (nextStartOverride && nextStartOverride > period.start) period.nextStart = nextStartOverride;
            period.end = payrollFridayBefore(period.nextStart);
            period.payrollEnd = period.end;
            period.payrollFriday = period.end;
            period.cycleEnd = shiftDate(period.nextStart, -1);
            if (!candidates.some(function(candidate) {
              return candidate.start === period.start;
            })) candidates.push(period);
          }
          __name(addCandidate, "addCandidate");
          if (starts[key]) addCandidate(starts[key]);
          var estimate = Math.round(monthOffset(key, anchorKey) * 30.436875 / CYCLE_DAYS);
          for (var baseOffset = estimate - 8; baseOffset <= estimate + 8; baseOffset += 1) {
            var baseStart = new Date(ANCHOR.getTime());
            baseStart.setUTCDate(baseStart.getUTCDate() + baseOffset * CYCLE_DAYS);
            var ordered = sortedOverrides();
            if (ordered.length && dateKey(baseStart) >= ordered[0].start) continue;
            addCandidate(dateKey(baseStart));
          }
          sortedOverrides().forEach(function(override, index, values) {
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
          candidates.sort(function(left, right) {
            var leftDistance = Math.abs(dayDifference(validDate3(left.start), ANCHOR));
            var rightDistance = Math.abs(dayDifference(validDate3(right.start), ANCHOR));
            return leftDistance - rightDistance;
          });
          return candidates[0];
        }
        __name(periodForMonth, "periodForMonth");
        function payMonthKeyForDate(value2) {
          var period = periodForDate(value2);
          return period ? period.key : "";
        }
        __name(payMonthKeyForDate, "payMonthKeyForDate");
        function payMonthKeyForWeek(weekStart, weekEnd) {
          return payMonthKeyForDate(weekStart || weekEnd);
        }
        __name(payMonthKeyForWeek, "payMonthKeyForWeek");
        function previousPayMonthKey(key) {
          var period = periodForMonth(key);
          if (!period) return "";
          var previousDate = validDate3(period.start);
          previousDate.setUTCDate(previousDate.getUTCDate() - 1);
          return payMonthKeyForDate(dateKey(previousDate));
        }
        __name(previousPayMonthKey, "previousPayMonthKey");
        function editablePayMonthKeys(value2) {
          var current = validMonthKey(value2) ? String(value2) : payMonthKeyForDate(value2 || dateKey(/* @__PURE__ */ new Date()));
          if (!current) return [];
          var previous = previousPayMonthKey(current);
          return [current, previous].filter(function(key, index, keys) {
            return key && keys.indexOf(key) === index;
          });
        }
        __name(editablePayMonthKeys, "editablePayMonthKeys");
        function periodLabelForDate(value2) {
          var period = periodForDate(value2);
          return period ? period.start + " to " + period.cycleEnd : "";
        }
        __name(periodLabelForDate, "periodLabelForDate");
        function nextPayMonthKey(key) {
          var period = periodForMonth(key);
          return period ? payMonthKeyForDate(period.nextStart) : "";
        }
        __name(nextPayMonthKey, "nextPayMonthKey");
        function replaceStartDates(values) {
          starts = normalizedOverrides(values);
        }
        __name(replaceStartDates, "replaceStartDates");
        return {
          payMonthKeyForDate,
          payMonthKeyForWeek,
          previousPayMonthKey,
          editablePayMonthKeys,
          periodForMonth,
          periodForDate,
          periodLabelForDate,
          nextPayMonthKey,
          getStartDates: /* @__PURE__ */ __name(function() {
            return Object.assign({}, starts);
          }, "getStartDates"),
          replaceStartDates
        };
      }
      __name(createPayPeriods, "createPayPeriods");
      var api = createPayPeriods({});
      api.createPayPeriods = createPayPeriods;
      api.ready = Promise.resolve(null);
      api.canManagePayMonthStarts = false;
      api.settingsLoaded = false;
      if (typeof module !== "object" && root && root.document) {
        api.ready = Promise.resolve().then(function() {
          var portalApi = root.GMTPortalApi;
          if (!portalApi || typeof portalApi.payMonthStarts !== "function" || portalApi.enabled && !portalApi.enabled()) return null;
          return portalApi.payMonthStarts();
        }).then(function(settings) {
          if (!settings || typeof settings !== "object") return null;
          api.replaceStartDates(settings.startDates || {});
          api.canManagePayMonthStarts = settings.canManage === true;
          api.settingsLoaded = true;
          api.currentMonthKey = String(settings.currentMonthKey || "");
          api.nextMonthKey = String(settings.nextMonthKey || "");
          return settings;
        }).catch(function(error) {
          api.settingsError = error || new Error("Pay-month settings are unavailable");
          return null;
        });
      }
      return api;
    });
  }
});

// src/index.js
var import_pay_periods = __toESM(require_pay_periods(), 1);

// src/provider-reconciliation.js
var MAX_RECORD_ID = 180;
function text(value2, fallback = "", max = 6e3) {
  return String(value2 == null ? fallback : value2).trim().slice(0, max);
}
__name(text, "text");
function numberValue(value2) {
  if (value2 === null || value2 === void 0 || value2 === "") return null;
  const number = Number(value2);
  return Number.isFinite(number) ? number : null;
}
__name(numberValue, "numberValue");
function validDate(value2) {
  const match = String(value2 || "").slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === match[0] ? date : null;
}
__name(validDate, "validDate");
function providerRowKey(row, index = 0) {
  const date = text(row && (row.date || row.recordDate || row.record_date || row.workDate || row.Date), "", 80).slice(0, 10);
  if (date) return date;
  return `row-${index}`;
}
__name(providerRowKey, "providerRowKey");
function providerRowScore(row) {
  if (!row || typeof row !== "object") return 0;
  let score = validDate(providerRowKey(row)) ? 10 : 0;
  const start = row.start || row.startTime || row.start_time || row.clockIn || row.clock_in;
  const finish = row.finish || row.finishTime || row.finish_time || row.clockOut || row.clock_out;
  if (start) score += 2;
  if (finish) score += 2;
  if (start && finish && String(start).trim() === String(finish).trim()) score -= 20;
  if (numberValue(row.workedMinutes ?? row.worked_minutes ?? row.workedHours ?? row.worked_hours) !== null) score += 2;
  return score;
}
__name(providerRowScore, "providerRowScore");
function providerAbsenceCount(record) {
  const payload = record && record.payload && typeof record.payload === "object" ? record.payload : {};
  const value2 = record && (record.absence_count ?? record.absenceCount ?? payload.absence_count ?? payload.absenceCount ?? payload.totals?.absenceCount ?? payload.totals?.absent);
  return numberValue(value2);
}
__name(providerAbsenceCount, "providerAbsenceCount");
function providerRowIsAbsenceOnly(row) {
  if (!row || typeof row !== "object") return false;
  const absence = text(row.absenceReason ?? row.absence_reason ?? row.absenceStatus ?? row.absence_status ?? row.absence, "").toLowerCase();
  if (!absence || /^(na|none|no absence|not applicable|n\/a)$/.test(absence)) return false;
  const start = row.start ?? row.startTime ?? row.start_time ?? row.clockIn ?? row.clock_in;
  const finish = row.finish ?? row.finishTime ?? row.finish_time ?? row.clockOut ?? row.clock_out;
  const worked = numberValue(row.workedMinutes ?? row.worked_minutes ?? row.workedHours ?? row.worked_hours ?? row.hours ?? row.totalHours);
  return !text(start) && !text(finish) && (worked === null || worked === 0);
}
__name(providerRowIsAbsenceOnly, "providerRowIsAbsenceOnly");
function mergeProviderRows(leftRows, rightRows, options = {}) {
  const byDate = /* @__PURE__ */ new Map();
  const left = Array.isArray(leftRows) ? leftRows : [];
  const right = Array.isArray(rightRows) ? rightRows : [];
  const source = options.dropLeftAbsenceOnly ? left.filter((row) => !providerRowIsAbsenceOnly(row)).concat(right) : left.concat(right);
  source.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const key = providerRowKey(row, index);
    const current = byDate.get(key);
    if (!current || providerRowScore(row) >= providerRowScore(current)) byDate.set(key, row);
  });
  return [...byDate.values()];
}
__name(mergeProviderRows, "mergeProviderRows");
function deduplicateProviderRecords(records) {
  const bySourceId = /* @__PURE__ */ new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const key = text(record && record.source_record_id, "", MAX_RECORD_ID) || `provider-row-${bySourceId.size}`;
    const current = bySourceId.get(key);
    if (!current) {
      bySourceId.set(key, record);
      return;
    }
    const currentPayload = current.payload && typeof current.payload === "object" ? current.payload : {};
    const nextPayload = record.payload && typeof record.payload === "object" ? record.payload : {};
    const currentUpdated = Date.parse(String(current.updated_at || current.submitted_at || "")) || 0;
    const nextUpdated = Date.parse(String(record.updated_at || record.submitted_at || "")) || 0;
    const preferred = nextUpdated >= currentUpdated && (record.employee_name || record.issue || nextPayload.rows?.length) ? record : current;
    const merged2 = { ...preferred };
    const preferredAbsenceCount = providerAbsenceCount(preferred);
    const older = preferred === record ? current : record;
    const olderPayload = older && older.payload && typeof older.payload === "object" ? older.payload : {};
    const shouldDropStaleAbsences = preferredAbsenceCount === 0 && providerAbsenceCount(older) !== 0;
    const mergedRows = shouldDropStaleAbsences ? mergeProviderRows(olderPayload.rows, preferred.payload && preferred.payload.rows || [], { dropLeftAbsenceOnly: true }) : mergeProviderRows(currentPayload.rows, nextPayload.rows);
    merged2.payload = {
      ...currentPayload,
      ...nextPayload,
      // A corrected submission that explicitly reports zero absences is a
      // replacement for stale holiday-only rows from the same source ID.
      // Keep older worked rows so a partial correction cannot erase valid
      // days from the pay-month workbook.
      rows: mergedRows
    };
    if (preferredAbsenceCount !== null) merged2.payload.absenceCount = preferredAbsenceCount;
    if (!merged2.issue) merged2.issue = current.issue || record.issue || "";
    bySourceId.set(key, merged2);
  });
  return [...bySourceId.values()];
}
__name(deduplicateProviderRecords, "deduplicateProviderRecords");
function providerEmployeeKey(record) {
  return text(record && (record.employee_upn || record.owner_upn || record.employee_email || record.employeeEmail || record.employee_name || record.employeeName), "").toLowerCase();
}
__name(providerEmployeeKey, "providerEmployeeKey");
function providerWindow(record) {
  const payload = record && record.payload && typeof record.payload === "object" ? record.payload : {};
  const start = text(record && (record.start_date || record.startDate || record.week_start || record.weekStart || payload.weekStart || payload.week_start), "").slice(0, 10);
  const end = text(record && (record.end_date || record.endDate || record.week_end || record.weekEnd || payload.weekEnd || payload.week_end), "").slice(0, 10);
  return { start: validDate(start) ? start : "", end: validDate(end) ? end : start };
}
__name(providerWindow, "providerWindow");
function dateInProviderWindow(date, window) {
  return !!(date && window && window.start && window.end && date >= window.start && date <= window.end);
}
__name(dateInProviderWindow, "dateInProviderWindow");
function removeStaleAbsenceRows(records) {
  const input = Array.isArray(records) ? records : [];
  const noAbsence = input.filter((record) => providerAbsenceCount(record) === 0 && providerEmployeeKey(record)).map((record) => ({
    record,
    employee: providerEmployeeKey(record),
    window: providerWindow(record),
    updated: Date.parse(String(record.updated_at || record.updatedAt || record.submitted_at || record.submittedAt || "")) || 0
  }));
  if (!noAbsence.length) return input;
  return input.map((record) => {
    const payload = record && record.payload && typeof record.payload === "object" ? record.payload : null;
    const rows = payload && Array.isArray(payload.rows) ? payload.rows : null;
    if (!rows || !rows.length) return record;
    const employee = providerEmployeeKey(record);
    const updated = Date.parse(String(record.updated_at || record.updatedAt || record.submitted_at || record.submittedAt || "")) || 0;
    const window = providerWindow(record);
    const replacement = noAbsence.some((candidate) => candidate.record !== record && candidate.employee === employee && candidate.updated > updated && candidate.window.start && candidate.window.end && candidate.window.start <= window.end && candidate.window.end >= window.start);
    if (!replacement) return record;
    const filtered = rows.filter((row) => {
      if (!providerRowIsAbsenceOnly(row)) return true;
      const date = providerRowKey(row, 0);
      return !noAbsence.some((candidate) => candidate.record !== record && candidate.employee === employee && candidate.updated > updated && dateInProviderWindow(date, candidate.window));
    });
    if (filtered.length === rows.length) return record;
    return { ...record, payload: { ...payload, rows: filtered } };
  });
}
__name(removeStaleAbsenceRows, "removeStaleAbsenceRows");

// src/estimate-index.js
var MAX = 2e3;
function value(input, fallback = "") {
  return String(input == null ? fallback : input).trim().slice(0, MAX);
}
__name(value, "value");
function aliases(input) {
  const source = Array.isArray(input) ? input : String(input || "").split(",");
  return [...new Set(source.map((item) => value(item, "")).filter(Boolean))].slice(0, 40);
}
__name(aliases, "aliases");
function canonicalEstimateInput(input = {}) {
  const canonical_id = value(input.canonical_id || input.canonicalId, "");
  if (!canonical_id) throw new Error("canonical_id is required");
  const source = value(input.source, "email");
  if (!["email", "app"].includes(source)) throw new Error("source must be email or app");
  return {
    canonical_id,
    estimate_number: value(input.estimate_number || input.estimateNumber),
    number_aliases: aliases(input.number_aliases || input.numberAliases),
    client: value(input.client || input.client_company || input.company),
    client_email: value(input.client_email || input.clientEmail || input.email),
    reference: value(input.reference),
    estimate_date: value(input.estimate_date || input.estimateDate || input.date, "", 80),
    source,
    mailbox: value(input.mailbox || input.source_mailbox, "").toLowerCase(),
    internet_message_id: value(input.internet_message_id || input.internetMessageId, "", 1e3),
    mailbox_message_id: value(input.mailbox_message_id || input.mailboxMessageId || input.outlook_message_id || input.outlookMessageId, "", 255),
    outlook_message_id: value(input.outlook_message_id || input.outlookMessageId, "", 255),
    outlook_url: value(input.outlook_url || input.outlookUrl, "", 2e3),
    sharepoint_url: value(input.sharepoint_url || input.sharepointUrl, "", 2e3),
    attachment_url: value(input.attachment_url || input.attachmentUrl, "", 2e3),
    correlation_status: value(input.correlation_status || input.correlationStatus, "unmatched", 80)
  };
}
__name(canonicalEstimateInput, "canonicalEstimateInput");
function merged(existing, incoming) {
  const current = existing || {};
  const next = canonicalEstimateInput({ ...current, ...incoming, number_aliases: [...aliases(current.number_aliases), ...aliases(incoming.number_aliases), current.estimate_number, incoming.estimate_number] });
  next.number_aliases = aliases(next.number_aliases).filter((item) => item !== next.estimate_number);
  return next;
}
__name(merged, "merged");
function createEstimateIndexStore(db) {
  return {
    async upsert(input) {
      const incoming = canonicalEstimateInput(input);
      const existing = incoming.outlook_message_id ? await db.prepare("SELECT * FROM estimate_index WHERE outlook_message_id = ?").bind(incoming.outlook_message_id).first() : await db.prepare("SELECT * FROM estimate_index WHERE canonical_id = ?").bind(incoming.canonical_id).first();
      const row = merged(existing, incoming);
      await db.prepare(`INSERT INTO estimate_index
        (canonical_id, estimate_number, number_aliases_json, client, client_email, reference, estimate_date, source,
         outlook_message_id, outlook_url, sharepoint_url, attachment_url, correlation_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
        ON CONFLICT(canonical_id) DO UPDATE SET estimate_number=excluded.estimate_number,
        number_aliases_json=excluded.number_aliases_json, client=excluded.client, client_email=excluded.client_email,
        reference=excluded.reference, estimate_date=excluded.estimate_date, source=excluded.source,
        outlook_message_id=COALESCE(excluded.outlook_message_id, estimate_index.outlook_message_id), outlook_url=excluded.outlook_url,
        sharepoint_url=excluded.sharepoint_url, attachment_url=excluded.attachment_url,
        correlation_status=excluded.correlation_status, updated_at=CURRENT_TIMESTAMP`).bind(
        row.canonical_id,
        row.estimate_number,
        JSON.stringify(row.number_aliases),
        row.client,
        row.client_email,
        row.reference,
        row.estimate_date,
        row.source,
        row.outlook_message_id || null,
        row.outlook_url,
        row.sharepoint_url,
        row.attachment_url,
        row.correlation_status,
        null
      ).run();
      const mailboxMessageId = row.mailbox_message_id || row.outlook_message_id;
      if (row.source === "email" && row.mailbox && mailboxMessageId) {
        await db.prepare(`INSERT INTO estimate_mail_sources
          (canonical_id, mailbox, outlook_message_id, internet_message_id, outlook_url, created_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(mailbox, outlook_message_id) DO UPDATE SET canonical_id=excluded.canonical_id,
          internet_message_id=excluded.internet_message_id, outlook_url=excluded.outlook_url`).bind(row.canonical_id, row.mailbox, mailboxMessageId, row.internet_message_id, row.outlook_url).run();
      }
      return row;
    },
    async list(limit = 500) {
      const result = await db.prepare(`SELECT i.*,
        COALESCE((SELECT json_group_array(json_object('mailbox', s.mailbox, 'outlook_message_id', s.outlook_message_id,
          'internet_message_id', s.internet_message_id, 'outlook_url', s.outlook_url))
          FROM estimate_mail_sources s WHERE s.canonical_id = i.canonical_id), '[]') AS mail_sources_json
        FROM estimate_index i ORDER BY i.updated_at DESC LIMIT ?`).bind(Math.min(Math.max(Number(limit) || 500, 1), 500)).all();
      return (result.results || []).map((row) => ({ ...row, number_aliases: aliasesFromJson(row.number_aliases_json), mail_sources: mailSourcesFromJson(row.mail_sources_json), source_mailboxes: [...new Set(mailSourcesFromJson(row.mail_sources_json).map((source) => source.mailbox).filter(Boolean))] }));
    }
  };
}
__name(createEstimateIndexStore, "createEstimateIndexStore");
function aliasesFromJson(raw) {
  try {
    return aliases(JSON.parse(raw || "[]"));
  } catch (_) {
    return aliases(raw);
  }
}
__name(aliasesFromJson, "aliasesFromJson");
function mailSourcesFromJson(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch (_) {
    return [];
  }
}
__name(mailSourcesFromJson, "mailSourcesFromJson");
function normaliseRow(row) {
  return { ...row, number_aliases: Array.isArray(row.number_aliases) ? row.number_aliases : aliasesFromJson(row.number_aliases_json) };
}
__name(normaliseRow, "normaliseRow");
function correlateEstimateRecords(indexRows = [], invoice = {}, records = []) {
  const invoiceNumber = value(invoice.invoice_number || invoice.invoiceNumber);
  const reference = value(invoice.reference);
  const client = value(invoice.contact_name || invoice.client || invoice.client_company).toLowerCase();
  const rows = indexRows.map(normaliseRow);
  const direct = rows.filter((row) => invoiceNumber && (row.estimate_number === invoiceNumber || row.number_aliases.includes(invoiceNumber)));
  const referenced = direct.length ? direct : rows.filter((row) => reference && (row.estimate_number === reference || row.number_aliases.includes(reference)));
  const exact = referenced.length ? referenced : rows.filter((row) => reference && row.reference && row.reference.toLowerCase() === reference.toLowerCase());
  const clientOnly = exact.length ? [] : rows.filter((row) => client && row.client && row.client.toLowerCase() === client);
  const chosen = exact.length ? exact : clientOnly;
  const unique = [...new Map(chosen.map((row) => [row.canonical_id, row])).values()];
  const rule = direct.length ? "estimate-number" : referenced.length ? "estimate-number-alias" : exact.length ? "reference" : "client";
  if (!exact.length) {
    const candidates2 = unique.map((row) => ({ canonical_id: row.canonical_id, rule: "client" }));
    return { matches: [], candidates: candidates2, explanation: candidates2.length ? "Customer name only; Accounts review required" : "No confident estimate match" };
  }
  const matches = unique.length === 1 ? [{ canonical_id: unique[0].canonical_id, rule }] : [];
  const candidates = unique.length > 1 ? unique.map((row) => ({ canonical_id: row.canonical_id, rule: "ambiguous" })) : [];
  return { matches, candidates, explanation: matches.length ? `Matched by ${rule}` : candidates.length ? "Multiple candidates require Accounts review" : "No confident estimate match" };
}
__name(correlateEstimateRecords, "correlateEstimateRecords");

// src/estimate-archive.js
var MAX_FIELD = 6e3;
var MAX_RECIPIENTS = 60;
var CLASSIFICATIONS = /* @__PURE__ */ new Set(["candidate", "confirmed", "needs-review", "excluded"]);
var SOURCES = /* @__PURE__ */ new Set(["email", "app"]);
var TARGET_KINDS = /* @__PURE__ */ new Set(["estimate", "job-card", "invoice"]);
var ASSOCIATION_STATES = /* @__PURE__ */ new Set(["candidate", "confirmed", "needs-review", "rejected"]);
var ASSOCIATION_PROVENANCE = /* @__PURE__ */ new Set(["exact-reference", "conversation-id", "shared-customer-date", "manual-review", "app-link"]);
function clean(value2, max = MAX_FIELD) {
  return String(value2 == null ? "" : value2).trim().slice(0, max);
}
__name(clean, "clean");
function email(value2) {
  return clean(value2, 320).toLowerCase();
}
__name(email, "email");
function jsonObject(value2, field) {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  return JSON.stringify(value2);
}
__name(jsonObject, "jsonObject");
function recipientValues(value2) {
  const items = Array.isArray(value2) ? value2 : String(value2 || "").split(/[;,\s]+/);
  return [...new Set(items.map(email).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)))].slice(0, MAX_RECIPIENTS);
}
__name(recipientValues, "recipientValues");
function canonicalRecord(input = {}) {
  const sourceKind = clean(input.source_kind || input.sourceKind || input.source || "email", 16).toLowerCase();
  if (!SOURCES.has(sourceKind)) throw Object.assign(new Error("source_kind must be email or app"), { status: 400 });
  const mailbox = email(input.mailbox || input.source_mailbox);
  const sourceMessageId = clean(input.source_message_id || input.sourceMessageId || input.outlook_message_id, 2e3);
  const internetMessageId = clean(input.internet_message_id || input.internetMessageId, 1e3).toLowerCase();
  if (!sourceMessageId) throw Object.assign(new Error("source_message_id is required"), { status: 400 });
  if (sourceKind === "email" && !mailbox) throw Object.assign(new Error("mailbox is required for email source"), { status: 400 });
  const canonicalId = clean(input.canonical_id || input.canonicalId || (internetMessageId ? `email:${internetMessageId}` : `${sourceKind}:${mailbox}:${sourceMessageId}`), 2200);
  if (!canonicalId) throw Object.assign(new Error("canonical_id is required"), { status: 400 });
  const classification = clean(input.classification_state || input.classificationState || "candidate", 24);
  if (!CLASSIFICATIONS.has(classification)) throw Object.assign(new Error("classification_state is invalid"), { status: 400 });
  const recipients = recipientValues(input.recipient_emails || input.recipientEmails || input.to);
  const sender = email(input.sender_email || input.senderEmail || input.from);
  const provenance = jsonObject(input.provenance, "provenance");
  const created = clean(input.created_at || input.createdAt, 80);
  return {
    id: clean(input.id, 220) || crypto.randomUUID(),
    canonical_id: canonicalId,
    source_kind: sourceKind,
    classification_state: classification,
    message_direction: clean(input.message_direction || input.direction, 16),
    mailbox,
    source_message_id: sourceMessageId,
    internet_message_id: internetMessageId,
    conversation_id: clean(input.conversation_id || input.conversationId, 1e3),
    sender_email: sender,
    recipient_emails: JSON.stringify(recipients),
    normalized_sender_email: sender,
    normalized_recipient_emails: recipients.join(" "),
    subject: clean(input.subject),
    customer_display: clean(input.customer_display || input.customerDisplay || input.customer || input.client, 1e3),
    normalized_customer: clean(input.normalized_customer || input.normalizedCustomer || input.customer_display || input.customerDisplay || input.customer || input.client, 1e3).toLocaleLowerCase(),
    customer_email: email(input.customer_email || input.customerEmail || input.client_email),
    estimate_number: clean(input.estimate_number || input.estimateNumber, 500),
    reference: clean(input.reference || input.job_reference, 1e3),
    sent_at: clean(input.sent_at || input.sentAt, 80),
    received_at: clean(input.received_at || input.receivedAt, 80),
    content_sha256: clean(input.content_sha256 || input.contentSha256, 128),
    sharepoint_eml_item_id: clean(input.sharepoint_eml_item_id || input.sharepointEmlItemId, 500),
    sharepoint_manifest_item_id: clean(input.sharepoint_manifest_item_id || input.sharepointManifestItemId, 500),
    provenance_json: provenance,
    created_at: created
  };
}
__name(canonicalRecord, "canonicalRecord");
async function upsertEstimateArchive(env, input) {
  if (!env?.DB) throw Object.assign(new Error("Protected storage is not configured"), { status: 503 });
  const row = canonicalRecord(input);
  const db = env.DB;
  const existing = row.internet_message_id ? await db.prepare("SELECT id, mailbox, source_message_id FROM archive_messages WHERE internet_message_id = ?").bind(row.internet_message_id).first() : await db.prepare("SELECT id, mailbox, source_message_id FROM archive_messages WHERE mailbox = ? AND source_message_id = ?").bind(row.mailbox, row.source_message_id).first();
  if (existing?.id) {
    row.id = existing.id;
    if (existing.mailbox && row.mailbox !== existing.mailbox) {
      row.mailbox = existing.mailbox;
      row.source_message_id = existing.source_message_id;
    }
  }
  const current = await db.prepare("SELECT created_at FROM archive_messages WHERE id = ?").bind(row.id).first();
  await db.prepare(`INSERT INTO archive_messages (
      id, canonical_id, source_kind, classification_state, message_direction, mailbox,
      source_message_id, internet_message_id, conversation_id, sender_email, recipient_emails,
      normalized_sender_email, normalized_recipient_emails, subject, customer_display, normalized_customer,
      customer_email, estimate_number, reference, sent_at, received_at, content_sha256,
      sharepoint_eml_item_id, sharepoint_manifest_item_id, provenance_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      classification_state=CASE WHEN archive_messages.classification_state='confirmed' AND excluded.classification_state='candidate' THEN archive_messages.classification_state ELSE excluded.classification_state END,
      message_direction=COALESCE(NULLIF(excluded.message_direction, ''), archive_messages.message_direction),
      mailbox=COALESCE(NULLIF(excluded.mailbox, ''), archive_messages.mailbox),
      source_message_id=COALESCE(NULLIF(excluded.source_message_id, ''), archive_messages.source_message_id),
      internet_message_id=COALESCE(NULLIF(excluded.internet_message_id, ''), archive_messages.internet_message_id),
      conversation_id=COALESCE(NULLIF(excluded.conversation_id, ''), archive_messages.conversation_id),
      sender_email=COALESCE(NULLIF(excluded.sender_email, ''), archive_messages.sender_email),
      recipient_emails=CASE WHEN excluded.recipient_emails='[]' THEN archive_messages.recipient_emails ELSE excluded.recipient_emails END,
      normalized_sender_email=COALESCE(NULLIF(excluded.normalized_sender_email, ''), archive_messages.normalized_sender_email),
      normalized_recipient_emails=COALESCE(NULLIF(excluded.normalized_recipient_emails, ''), archive_messages.normalized_recipient_emails),
      subject=COALESCE(NULLIF(excluded.subject, ''), archive_messages.subject),
      customer_display=COALESCE(NULLIF(excluded.customer_display, ''), archive_messages.customer_display),
      normalized_customer=COALESCE(NULLIF(excluded.normalized_customer, ''), archive_messages.normalized_customer),
      customer_email=COALESCE(NULLIF(excluded.customer_email, ''), archive_messages.customer_email),
      estimate_number=COALESCE(NULLIF(excluded.estimate_number, ''), archive_messages.estimate_number),
      reference=COALESCE(NULLIF(excluded.reference, ''), archive_messages.reference),
      sent_at=COALESCE(NULLIF(excluded.sent_at, ''), archive_messages.sent_at),
      received_at=COALESCE(NULLIF(excluded.received_at, ''), archive_messages.received_at),
      content_sha256=COALESCE(NULLIF(excluded.content_sha256, ''), archive_messages.content_sha256),
      sharepoint_eml_item_id=COALESCE(NULLIF(excluded.sharepoint_eml_item_id, ''), archive_messages.sharepoint_eml_item_id),
      sharepoint_manifest_item_id=COALESCE(NULLIF(excluded.sharepoint_manifest_item_id, ''), archive_messages.sharepoint_manifest_item_id),
      provenance_json=CASE WHEN excluded.provenance_json='{}' THEN archive_messages.provenance_json ELSE excluded.provenance_json END,
      updated_at=CURRENT_TIMESTAMP`).bind(
    row.id,
    row.canonical_id,
    row.source_kind,
    row.classification_state,
    row.message_direction,
    row.mailbox,
    row.source_message_id,
    row.internet_message_id,
    row.conversation_id,
    row.sender_email,
    row.recipient_emails,
    row.normalized_sender_email,
    row.normalized_recipient_emails,
    row.subject,
    row.customer_display,
    row.normalized_customer,
    row.customer_email,
    row.estimate_number,
    row.reference,
    row.sent_at,
    row.received_at,
    row.content_sha256,
    row.sharepoint_eml_item_id,
    row.sharepoint_manifest_item_id,
    row.provenance_json,
    row.created_at
  ).run();
  return { id: row.id, created: !current, updated: Boolean(current) };
}
__name(upsertEstimateArchive, "upsertEstimateArchive");
async function upsertEstimateAssociation(env, messageId, input, createdBy = "") {
  const targetKind = clean(input?.target_kind || input?.targetKind, 32);
  const targetId = clean(input?.target_id || input?.targetId, 300);
  const targetReference = clean(input?.target_reference || input?.targetReference, 500);
  const relationship = clean(input?.relationship, 80) || "related";
  const state = clean(input?.state, 24) || "candidate";
  const provenanceKind = clean(input?.provenance_kind || input?.provenanceKind, 40);
  const confidence = Number(input?.confidence);
  const evidence = jsonObject(input?.evidence || {}, "evidence");
  if (!TARGET_KINDS.has(targetKind) || !targetId || !ASSOCIATION_STATES.has(state) || !ASSOCIATION_PROVENANCE.has(provenanceKind) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw Object.assign(new Error("association is invalid"), { status: 400 });
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO archive_associations
    (id, message_id, target_kind, target_id, target_reference, relationship, confidence, state, provenance_kind, evidence_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id, target_kind, target_id, relationship) DO UPDATE SET
      target_reference=excluded.target_reference, confidence=excluded.confidence, state=excluded.state,
      provenance_kind=excluded.provenance_kind, evidence_json=excluded.evidence_json,
      created_by=excluded.created_by, updated_at=CURRENT_TIMESTAMP`).bind(id, messageId, targetKind, targetId, targetReference, relationship, confidence, state, provenanceKind, evidence, clean(createdBy, 300)).run();
  return { message_id: messageId, target_kind: targetKind, target_id: targetId, target_reference: targetReference, relationship, confidence, state };
}
__name(upsertEstimateAssociation, "upsertEstimateAssociation");
function encodeCursor(row) {
  const bytes = new TextEncoder().encode(JSON.stringify([row.received_at || "", row.id]));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(encodeCursor, "encodeCursor");
function decodeCursor(value2) {
  if (!value2) return null;
  try {
    const normalized = String(value2).replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)));
    if (!Array.isArray(decoded) || decoded.length !== 2 || typeof decoded[0] !== "string" || typeof decoded[1] !== "string") throw new Error();
    return decoded;
  } catch (_) {
    throw Object.assign(new Error("cursor is invalid"), { status: 400 });
  }
}
__name(decodeCursor, "decodeCursor");
async function queryEstimateArchive(env, filters = {}) {
  if (!env?.DB) throw Object.assign(new Error("Protected storage is not configured"), { status: 503 });
  const clauses = [];
  const params = [];
  const add = /* @__PURE__ */ __name((clause, value2) => {
    if (value2) {
      clauses.push(clause);
      params.push(value2);
    }
  }, "add");
  const term = clean(filters.q, 300);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(`(subject LIKE ? ESCAPE '\\' OR estimate_number LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\' OR normalized_customer LIKE ? ESCAPE '\\' OR customer_email LIKE ? ESCAPE '\\' OR normalized_sender_email LIKE ? ESCAPE '\\' OR normalized_recipient_emails LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like.toLocaleLowerCase(), like.toLocaleLowerCase(), like.toLocaleLowerCase(), like.toLocaleLowerCase());
  }
  add("estimate_number = ?", clean(filters.estimateNumber, 500));
  add("normalized_customer = ?", clean(filters.customer, 1e3).toLocaleLowerCase());
  const emailFilter = email(filters.email);
  if (emailFilter) {
    clauses.push("(customer_email = ? OR normalized_sender_email = ? OR normalized_recipient_emails LIKE ?)");
    params.push(emailFilter, emailFilter, `%${emailFilter}%`);
  }
  add("reference = ?", clean(filters.reference, 1e3));
  const from = clean(filters.from, 80);
  const to = clean(filters.to, 80);
  add("COALESCE(NULLIF(sent_at, ''), received_at) >= ?", /^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00.000Z` : from);
  add("COALESCE(NULLIF(sent_at, ''), received_at) <= ?", /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to);
  add("classification_state = ?", clean(filters.state, 24));
  if (filters.relatedJobId) {
    clauses.push("EXISTS (SELECT 1 FROM archive_associations a WHERE a.message_id=archive_messages.id AND a.target_kind='job-card' AND (a.target_id=? OR a.target_reference=?))");
    params.push(clean(filters.relatedJobId, 300), clean(filters.relatedJobId, 300));
  }
  if (filters.relatedInvoice) {
    clauses.push("EXISTS (SELECT 1 FROM archive_associations a WHERE a.message_id=archive_messages.id AND a.target_kind='invoice' AND (a.target_id=? OR a.target_reference=?))");
    params.push(clean(filters.relatedInvoice, 300), clean(filters.relatedInvoice, 300));
  }
  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    clauses.push("(received_at < ? OR (received_at = ? AND id < ?))");
    params.push(cursor[0], cursor[0], cursor[1]);
  }
  const limit = Math.max(1, Math.min(Number.parseInt(filters.limit, 10) || 50, 100));
  const sql = `SELECT id, source_kind, classification_state, message_direction,
    mailbox, sender_email,
    recipient_emails, subject, customer_display AS customer, customer_email,
    estimate_number, reference, sent_at, received_at, created_at, updated_at
    FROM archive_messages ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
    ORDER BY received_at DESC, id DESC LIMIT ?`;
  const result = await env.DB.prepare(sql).bind(...params, limit + 1).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const records = rows.slice(0, limit).map((row) => ({
    ...row,
    recipient_emails: (() => {
      try {
        const parsed = JSON.parse(row.recipient_emails || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    })()
  }));
  return { records, nextCursor: hasMore && records.length ? encodeCursor(records[records.length - 1]) : null, indexState: "ready" };
}
__name(queryEstimateArchive, "queryEstimateArchive");
function normalizeEstimateArchiveRecord(input) {
  return canonicalRecord(input);
}
__name(normalizeEstimateArchiveRecord, "normalizeEstimateArchiveRecord");

// src/job-card-archive.js
var CARD_TYPES = /* @__PURE__ */ new Set(["EC", "MTA"]);
var REVIEW_STATES = /* @__PURE__ */ new Set(["ready", "needs-review", "confirmed"]);
var CONFIRMED_FIELDS = /* @__PURE__ */ new Map([
  ["cardNumber", 240],
  ["date", 80],
  ["customer", 1e3],
  ["orderNumber", 500],
  ["site", 2e3],
  ["engineer", 500],
  ["report", 6e3],
  ["amount", 240]
]);
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
__name(fail, "fail");
function clean2(value2, max = 6e3) {
  return String(value2 == null ? "" : value2).trim().slice(0, max);
}
__name(clean2, "clean");
function isSha256(value2) {
  return /^[a-f0-9]{64}$/i.test(String(value2 || ""));
}
__name(isSha256, "isSha256");
function isQuickXorHash(value2) {
  return /^[A-Za-z0-9+/]{27}=$/.test(String(value2 || ""));
}
__name(isQuickXorHash, "isQuickXorHash");
function sourceFilename(value2) {
  const name = clean2(value2, 180);
  if (!/^(?:EC|MTA)[A-Za-z0-9._-]*\.pdf$/i.test(name) || name.includes("..")) fail("source PDF filename is invalid");
  return name;
}
__name(sourceFilename, "sourceFilename");
function normalizeSource(value2) {
  const fileName = sourceFilename(value2?.fileName || value2?.file_name);
  const pageCount = Number(value2?.pageCount ?? value2?.page_count);
  const sizeBytes = Number(value2?.sizeBytes ?? value2?.size_bytes);
  const sha256 = clean2(value2?.sha256, 64).toLowerCase();
  const quickXorHash = clean2(value2?.quickXorHash || value2?.quick_xor_hash, 80);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || !isSha256(sha256) || !isQuickXorHash(quickXorHash)) {
    fail(`source inventory is invalid for ${fileName}`);
  }
  return { fileName, pageCount, sizeBytes, sha256, quickXorHash };
}
__name(normalizeSource, "normalizeSource");
async function sha256Hex(value2) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value2)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
async function jobCardBatchId(sources) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 100) fail("source inventory is invalid");
  const normalized = sources.map(normalizeSource).sort((a, b) => a.fileName.localeCompare(b.fileName));
  if (new Set(normalized.map((source) => source.fileName.toLowerCase())).size !== normalized.length) fail("source filenames must be unique");
  const identity = normalized.map(({ fileName, sha256 }) => `${fileName}
${sha256}`).join("\n");
  return `jobcard-batch-${await sha256Hex(identity)}`;
}
__name(jobCardBatchId, "jobCardBatchId");
function actorFields(actor) {
  const oid = clean2(actor?.oid, 240);
  const upn = clean2(actor?.upn, 320).toLowerCase();
  if (!oid || !upn) fail("authenticated Accounts identity is required", 401);
  return { oid, upn, name: clean2(actor?.name, 240) || upn };
}
__name(actorFields, "actorFields");
async function startJobCardBatch(env, input, actor) {
  if (!env?.DB) fail("Protected storage is not configured", 503);
  const identity = actorFields(actor);
  const sources = Array.isArray(input?.sources) ? input.sources.map(normalizeSource).sort((a, b) => a.fileName.localeCompare(b.fileName)) : [];
  const sourceCount = Number(input?.sourceCount ?? input?.source_count ?? sources.length);
  const pageCount = Number(input?.pageCount ?? input?.page_count);
  if (!sources.length || sources.length !== sourceCount || !Number.isSafeInteger(pageCount) || pageCount < 1 || sources.reduce((sum, source) => sum + source.pageCount, 0) !== pageCount) {
    fail("job-card batch inventory does not reconcile");
  }
  if (new Set(sources.map((source) => source.fileName.toLowerCase())).size !== sources.length) fail("source filenames must be unique");
  const batchId = clean2(input?.batchId || input?.batch_id, 100);
  if (!/^jobcard-batch-[a-f0-9]{64}$/.test(batchId) || await jobCardBatchId(sources) !== batchId) fail("batch ID does not match its source inventory");
  const sourcesJson = JSON.stringify(sources);
  const current = await env.DB.prepare("SELECT source_count, page_count, sources_json, status FROM job_card_import_batches WHERE batch_id=?").bind(batchId).first();
  if (current) {
    if (current.source_count !== sourceCount || current.page_count !== pageCount || current.sources_json !== sourcesJson) fail("batch ID is already registered with different source metadata", 409);
    return { batchId, status: current.status, duplicate: true };
  }
  await env.DB.prepare(`INSERT INTO job_card_import_batches
    (batch_id, source_count, page_count, sources_json, status, created_by_oid, created_by_upn)
    VALUES (?, ?, ?, ?, 'uploading', ?, ?)`).bind(batchId, sourceCount, pageCount, sourcesJson, identity.oid, identity.upn).run();
  return { batchId, status: "uploading", duplicate: false };
}
__name(startJobCardBatch, "startJobCardBatch");
async function getJobCardBatch(env, batchId) {
  const id = clean2(batchId, 100);
  if (!/^jobcard-batch-[a-f0-9]{64}$/.test(id)) fail("job-card batch was not found", 404);
  const row = await env.DB.prepare("SELECT batch_id, source_count, page_count, sources_json, status FROM job_card_import_batches WHERE batch_id=?").bind(id).first();
  if (!row) fail("job-card batch was not found", 404);
  let sources;
  try {
    sources = JSON.parse(row.sources_json);
  } catch (_) {
    fail("job-card batch inventory is invalid", 500);
  }
  return { ...row, sources: Array.isArray(sources) ? sources : [] };
}
__name(getJobCardBatch, "getJobCardBatch");
async function jobCardBatchStatus(env, batchId) {
  const batch = await getJobCardBatch(env, batchId);
  const sources = await env.DB.prepare("SELECT source_file FROM job_card_source_files WHERE batch_id=? ORDER BY source_file").bind(batch.batch_id).all();
  const pages = await env.DB.prepare("SELECT record_id FROM job_card_archive WHERE batch_id=? ORDER BY record_id").bind(batch.batch_id).all();
  return {
    batchId: batch.batch_id,
    status: batch.status,
    expectedSources: batch.source_count,
    uploadedSources: (sources.results || []).map((row) => row.source_file),
    expectedPages: batch.page_count,
    importedRecordIds: (pages.results || []).map((row) => row.record_id)
  };
}
__name(jobCardBatchStatus, "jobCardBatchStatus");
async function normalizeJobCardEntry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("job-card manifest entry is required");
  const batchId = clean2(input.batchId || input.batch_id, 100);
  const sourceFile = sourceFilename(input.sourceFile || input.source_file);
  const sourceSha256 = clean2(input.sourceSha256 || input.source_sha256, 64).toLowerCase();
  const sourceQuickXorHash = clean2(input.sourceQuickXorHash || input.source_quick_xor_hash, 80);
  const sourcePage = Number(input.sourcePage ?? input.source_page);
  const sizeBytes = Number(input.sizeBytes ?? input.size_bytes);
  const sha256 = clean2(input.sha256, 64).toLowerCase();
  const quickXorHash = clean2(input.quickXorHash || input.quick_xor_hash, 80);
  const recordId = clean2(input.recordId || input.record_id, 180);
  const cardType = clean2(input.cardType || input.card_type, 8).toUpperCase();
  const expectedCardType = sourceFile.match(/^(EC|MTA)/i)?.[1].toUpperCase();
  if (!/^jobcard-batch-[a-f0-9]{64}$/.test(batchId) || !isSha256(sourceSha256) || !isQuickXorHash(sourceQuickXorHash) || !Number.isSafeInteger(sourcePage) || sourcePage < 1) fail("job-card source page identity is invalid");
  if (!isSha256(sha256) || !isQuickXorHash(quickXorHash) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1) fail("job-card page file metadata is invalid");
  if (recordId !== `jobcard-${sourceSha256}-${String(sourcePage).padStart(4, "0")}`) fail("job-card record ID does not match its source page");
  if (!CARD_TYPES.has(cardType) || cardType !== expectedCardType) fail("job-card type does not match its source file");
  const rawCandidates = input.candidates && typeof input.candidates === "object" && !Array.isArray(input.candidates) ? input.candidates : {};
  const candidates = {};
  for (const field of CONFIRMED_FIELDS.keys()) {
    const value2 = rawCandidates[field];
    if (value2 != null && typeof value2 !== "string") fail(`job-card candidate ${field} is invalid`);
    candidates[field] = clean2(value2, CONFIRMED_FIELDS.get(field));
  }
  const ocrText = String(input.ocrText ?? input.ocr_text ?? "").slice(0, 5e5);
  const confidenceValue = input.meanOcrConfidence ?? input.mean_ocr_confidence;
  const meanOcrConfidence = confidenceValue == null ? null : Number(confidenceValue);
  if (meanOcrConfidence !== null && (!Number.isFinite(meanOcrConfidence) || meanOcrConfidence < 0 || meanOcrConfidence > 100)) fail("OCR confidence is invalid");
  const reviewReasons = Array.isArray(input.reviewReasons || input.review_reasons) ? [...new Set((input.reviewReasons || input.review_reasons).map((reason) => clean2(reason, 80)).filter(Boolean))].slice(0, 40) : [];
  const requestedReviewState = clean2(input.reviewState || input.review_state, 24);
  if (requestedReviewState && !REVIEW_STATES.has(requestedReviewState)) fail("job-card review state is invalid");
  const reviewState = requestedReviewState === "ready" && !reviewReasons.length ? "ready" : "needs-review";
  return {
    batchId,
    recordId,
    sourceFile,
    sourceSha256,
    sourceQuickXorHash,
    sourcePage,
    cardType,
    sizeBytes,
    sha256,
    quickXorHash,
    candidates,
    ocrText,
    meanOcrConfidence,
    reviewState,
    reviewReasons
  };
}
__name(normalizeJobCardEntry, "normalizeJobCardEntry");
async function upsertJobCardSourceFile(env, batchId, sourceInput, item, actor) {
  const identity = actorFields(actor);
  const batch = await getJobCardBatch(env, batchId);
  const source = normalizeSource(sourceInput);
  const expected = batch.sources.find((candidate) => candidate.fileName === source.fileName);
  if (!expected || JSON.stringify(expected) !== JSON.stringify(source)) fail("uploaded source does not match the registered batch inventory", 409);
  if (!item?.id || !item?.file?.hashes?.quickXorHash || Number(item.size) !== source.sizeBytes || item.file.hashes.quickXorHash !== source.quickXorHash) {
    fail("SharePoint source size or QuickXorHash did not match the local source", 409);
  }
  const path = `JobCards/Source Batches/${batch.batch_id}/${source.fileName}`;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO job_card_source_files
      (batch_id, source_file, page_count, size_bytes, sha256, quick_xor_hash, sharepoint_item_id, sharepoint_path, uploaded_by_oid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(batch_id, source_file) DO UPDATE SET page_count=excluded.page_count, size_bytes=excluded.size_bytes,
        sha256=excluded.sha256, quick_xor_hash=excluded.quick_xor_hash, sharepoint_item_id=excluded.sharepoint_item_id,
        sharepoint_path=excluded.sharepoint_path, uploaded_by_oid=excluded.uploaded_by_oid, uploaded_at=CURRENT_TIMESTAMP`).bind(batch.batch_id, source.fileName, source.pageCount, source.sizeBytes, source.sha256, source.quickXorHash, item.id, path, identity.oid),
    env.DB.prepare(`UPDATE job_card_import_batches SET status=CASE
        WHEN (SELECT COUNT(*) FROM job_card_source_files WHERE batch_id=?) = source_count
          AND (SELECT COALESCE(SUM(page_count), 0) FROM job_card_source_files WHERE batch_id=?) = page_count
        THEN 'source-complete' ELSE 'uploading' END, updated_at=CURRENT_TIMESTAMP
      WHERE batch_id=?`).bind(batch.batch_id, batch.batch_id, batch.batch_id)
  ]);
  const latest = await getJobCardBatch(env, batch.batch_id);
  return { batchId: latest.batch_id, status: latest.status, uploadedSourceCount: await sourceFileCount(env, batch.batch_id) };
}
__name(upsertJobCardSourceFile, "upsertJobCardSourceFile");
async function sourceFileCount(env, batchId) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM job_card_source_files WHERE batch_id=?").bind(batchId).first();
  return Number(row?.count) || 0;
}
__name(sourceFileCount, "sourceFileCount");
async function upsertJobCardArchive(env, input, actor) {
  if (!env?.DB) fail("Protected storage is not configured", 503);
  const identity = actorFields(actor);
  const entry = await normalizeJobCardEntry(input?.manifestEntry || input);
  const sharepointItemId = clean2(input?.sharepointItemId || input?.sharepoint_item_id, 500);
  const sharepointPath = clean2(input?.sharepointPath || input?.sharepoint_path, 1e3);
  if (!sharepointItemId || !sharepointPath || sharepointPath !== `JobCards/Records/${entry.recordId}.pdf`) fail("SharePoint page pointer is invalid");
  const existing = await env.DB.prepare("SELECT kind, action FROM records WHERE record_id=?").bind(entry.recordId).first();
  if (existing && (existing.kind !== "job-cards" || existing.action !== "archive_import")) fail("record ID is already used by another GMT record", 409);
  const archive = await env.DB.prepare("SELECT batch_id, source_file, source_page, content_sha256, confirmed_json, review_state, reviewed_by_oid, reviewed_by_upn, reviewed_at, review_note FROM job_card_archive WHERE record_id=?").bind(entry.recordId).first();
  if (archive && (archive.source_file !== entry.sourceFile || archive.source_page !== entry.sourcePage || archive.content_sha256 !== entry.sha256)) {
    fail("stable job-card ID is already associated with different source page content", 409);
  }
  let confirmed = {};
  try {
    confirmed = archive?.confirmed_json ? JSON.parse(archive.confirmed_json) : {};
  } catch (_) {
    confirmed = {};
  }
  const reviewState = archive?.review_state === "confirmed" ? "confirmed" : entry.reviewState;
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  const recordPayload = JSON.stringify({
    archiveType: "scanned-job-card",
    batchId: entry.batchId,
    sourceFile: entry.sourceFile,
    sourcePage: entry.sourcePage,
    cardType: entry.cardType,
    jobReference: confirmed.cardNumber || "",
    company: confirmed.customer || "",
    date: confirmed.date || "",
    candidateFields: entry.candidates,
    confirmedFields: confirmed,
    reviewState
  });
  const recordDate = confirmed.date && /^\d{4}-\d{2}-\d{2}$/.test(confirmed.date) ? confirmed.date : null;
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO records
      (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date, record_date,
       submitted_at, updated_at, issue, payload_json, source_message_key, source_attachment_ids,
       reconciliation_key, source_variant_status, reconciled_at)
      VALUES (?, ?, ?, 'GMT Scanned Archive', 'job-cards', 'archive_import', 'Archived', NULL, NULL, ?, ?, ?, '', ?, NULL, NULL, NULL, NULL, NULL)
      ON CONFLICT(record_id) DO UPDATE SET status='Archived', record_date=excluded.record_date,
        updated_at=excluded.updated_at, payload_json=excluded.payload_json
      WHERE records.kind='job-cards' AND records.action='archive_import'`).bind(entry.recordId, identity.oid, identity.upn, recordDate, now2, now2, recordPayload),
    env.DB.prepare(`INSERT INTO job_card_archive
      (record_id, batch_id, source_file, source_page, card_type, sharepoint_item_id, sharepoint_path,
       size_bytes, content_sha256, quick_xor_hash, ocr_text, mean_ocr_confidence, candidates_json,
       confirmed_json, review_state, review_note, imported_by_oid, reviewed_by_oid, reviewed_by_upn, reviewed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET batch_id=excluded.batch_id, source_file=excluded.source_file,
        source_page=excluded.source_page, card_type=excluded.card_type, sharepoint_item_id=excluded.sharepoint_item_id,
        sharepoint_path=excluded.sharepoint_path, size_bytes=excluded.size_bytes, content_sha256=excluded.content_sha256,
        quick_xor_hash=excluded.quick_xor_hash, ocr_text=excluded.ocr_text, mean_ocr_confidence=excluded.mean_ocr_confidence,
        candidates_json=excluded.candidates_json, confirmed_json=job_card_archive.confirmed_json,
        review_state=CASE WHEN job_card_archive.review_state='confirmed' THEN 'confirmed' ELSE excluded.review_state END,
        review_note=job_card_archive.review_note, imported_by_oid=excluded.imported_by_oid,
        reviewed_by_oid=job_card_archive.reviewed_by_oid, reviewed_by_upn=job_card_archive.reviewed_by_upn,
        reviewed_at=job_card_archive.reviewed_at, updated_at=CURRENT_TIMESTAMP`).bind(
      entry.recordId,
      entry.batchId,
      entry.sourceFile,
      entry.sourcePage,
      entry.cardType,
      sharepointItemId,
      sharepointPath,
      entry.sizeBytes,
      entry.sha256,
      entry.quickXorHash,
      entry.ocrText,
      entry.meanOcrConfidence,
      JSON.stringify(entry.candidates),
      JSON.stringify(confirmed),
      reviewState,
      archive?.review_note || "",
      identity.oid,
      archive?.reviewed_by_oid || null,
      archive?.reviewed_by_upn || null,
      archive?.reviewed_at || null
    )
  ]);
  const result = await env.DB.prepare("SELECT record_id, review_state FROM job_card_archive WHERE record_id=?").bind(entry.recordId).first();
  return { recordId: result.record_id, reviewState: result.review_state, duplicate: Boolean(archive) };
}
__name(upsertJobCardArchive, "upsertJobCardArchive");
function decodeCursor2(cursor) {
  if (!cursor) return "";
  try {
    const normalized = String(cursor).replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    if (!/^jobcard-[a-f0-9]{64}-\d{4,}$/.test(decoded)) fail("search cursor is invalid");
    return decoded;
  } catch (error) {
    if (error.status) throw error;
    fail("search cursor is invalid");
  }
}
__name(decodeCursor2, "decodeCursor");
function encodeCursor2(recordId) {
  return btoa(recordId).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(encodeCursor2, "encodeCursor");
function parseJson(value2) {
  try {
    const parsed = JSON.parse(value2 || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}
__name(parseJson, "parseJson");
async function queryJobCardArchive(env, filters = {}) {
  if (!env?.DB) fail("Protected storage is not configured", 503);
  const clauses = ["r.kind='job-cards'", "r.action='archive_import'", "r.status <> 'Deleted'"];
  const params = [];
  const term = clean2(filters.q, 300);
  if (term) {
    if (Array.from(term).length < 3) fail("Search terms must contain at least three characters");
    clauses.push("job_card_archive_fts MATCH ?");
    params.push(`"${term.replace(/"/g, '""')}"`);
  }
  const cardType = clean2(filters.cardType || filters.card_type, 8).toUpperCase();
  if (cardType) {
    if (!CARD_TYPES.has(cardType)) fail("cardType must be EC or MTA");
    clauses.push("a.card_type=?");
    params.push(cardType);
  }
  const from = clean2(filters.from, 10);
  const to = clean2(filters.to, 10);
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) fail("from must be an ISO date");
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) fail("to must be an ISO date");
  if (from) {
    clauses.push("json_extract(a.confirmed_json, '$.date') >= ?");
    params.push(from);
  }
  if (to) {
    clauses.push("json_extract(a.confirmed_json, '$.date') <= ?");
    params.push(to);
  }
  const cursor = decodeCursor2(filters.cursor);
  if (cursor) {
    clauses.push("a.record_id > ?");
    params.push(cursor);
  }
  const parsedLimit = Number.parseInt(filters.limit, 10) || 50;
  const limit = Math.max(1, Math.min(parsedLimit, 100));
  const ftsJoin = term ? "JOIN job_card_archive_fts ON job_card_archive_fts.record_id=a.record_id" : "";
  const result = await env.DB.prepare(`SELECT a.record_id, a.batch_id, a.source_file, a.source_page, a.card_type,
      substr(a.ocr_text, 1, 1000) AS ocr_preview, a.mean_ocr_confidence, a.candidates_json, a.confirmed_json, a.review_state,
      a.review_note, a.imported_at, a.reviewed_at
    FROM job_card_archive a JOIN records r ON r.record_id=a.record_id ${ftsJoin}
    WHERE ${clauses.join(" AND ")}
    ORDER BY a.record_id ASC LIMIT ?`).bind(...params, limit + 1).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  const records = rows.slice(0, limit).map((row) => ({
    record_id: row.record_id,
    batch_id: row.batch_id,
    source_file: row.source_file,
    source_page: row.source_page,
    card_type: row.card_type,
    ocr_preview: row.ocr_preview,
    mean_ocr_confidence: row.mean_ocr_confidence,
    candidates: parseJson(row.candidates_json),
    confirmed_fields: parseJson(row.confirmed_json),
    review_state: row.review_state,
    review_note: row.review_note,
    imported_at: row.imported_at,
    reviewed_at: row.reviewed_at
  }));
  return { records, nextCursor: hasMore && records.length ? encodeCursor2(records[records.length - 1].record_id) : null };
}
__name(queryJobCardArchive, "queryJobCardArchive");
async function getJobCardArchiveRecord(env, recordId) {
  const id = clean2(recordId, 180);
  if (!/^jobcard-[a-f0-9]{64}-\d{4,}$/.test(id)) fail("job card was not found", 404);
  const row = await env.DB.prepare(`SELECT a.record_id, a.batch_id, a.source_file, a.source_page, a.card_type,
      a.sharepoint_item_id, a.sharepoint_path, a.size_bytes, a.content_sha256, a.quick_xor_hash,
      a.ocr_text, a.mean_ocr_confidence, a.candidates_json, a.confirmed_json, a.review_state,
      a.review_note, a.reviewed_at, r.kind, r.action, r.status
    FROM job_card_archive a JOIN records r ON r.record_id=a.record_id WHERE a.record_id=?`).bind(id).first();
  if (!row || row.status === "Deleted" || row.action !== "archive_import") fail("job card was not found", 404);
  return row;
}
__name(getJobCardArchiveRecord, "getJobCardArchiveRecord");
async function reviewJobCardArchive(env, recordId, input, actor) {
  if (!env?.DB) fail("Protected storage is not configured", 503);
  const identity = actorFields(actor);
  const current = await getJobCardArchiveRecord(env, recordId);
  const fields = input?.confirmedFields ?? input?.confirmed_fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) fail("confirmedFields must be an object");
  const confirmed = parseJson(current.confirmed_json);
  for (const [field, max] of CONFIRMED_FIELDS) {
    if (!Object.hasOwn(fields, field)) continue;
    if (fields[field] != null && typeof fields[field] !== "string") fail(`confirmed field ${field} must be text`);
    const value2 = clean2(fields[field], max);
    if (field === "date" && value2 && !/^\d{4}-\d{2}-\d{2}$/.test(value2)) fail("confirmed date must use YYYY-MM-DD");
    confirmed[field] = value2;
  }
  const requestedState = clean2(input.state, 24) || "needs-review";
  if (!["confirmed", "needs-review"].includes(requestedState)) fail("review state must be confirmed or needs-review");
  const note = clean2(input.note, 2e3);
  const now2 = (/* @__PURE__ */ new Date()).toISOString();
  const before = parseJson(current.confirmed_json);
  const action = requestedState === "confirmed" ? Object.keys(before).length ? "correct" : "confirm" : "reopen";
  const auditId = crypto.randomUUID();
  const payload = await env.DB.prepare("SELECT payload_json FROM records WHERE record_id=?").bind(current.record_id).first();
  const recordPayload = parseJson(payload?.payload_json);
  recordPayload.confirmedFields = confirmed;
  recordPayload.jobReference = confirmed.cardNumber || "";
  recordPayload.company = confirmed.customer || "";
  recordPayload.date = confirmed.date || "";
  recordPayload.reviewState = requestedState;
  await env.DB.batch([
    env.DB.prepare(`UPDATE job_card_archive SET confirmed_json=?, review_state=?, review_note=?,
      reviewed_by_oid=?, reviewed_by_upn=?, reviewed_at=?, updated_at=? WHERE record_id=?`).bind(JSON.stringify(confirmed), requestedState, note, identity.oid, identity.upn, now2, now2, current.record_id),
    env.DB.prepare("UPDATE records SET record_date=?, payload_json=?, updated_at=? WHERE record_id=? AND action='archive_import'").bind(confirmed.date || null, JSON.stringify(recordPayload), now2, current.record_id),
    env.DB.prepare(`INSERT INTO job_card_archive_review_audit
      (audit_id, record_id, actor_oid, actor_upn, action, before_json, after_json, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(auditId, current.record_id, identity.oid, identity.upn, action, JSON.stringify(before), JSON.stringify(confirmed), note, now2)
  ]);
  return { recordId: current.record_id, confirmedFields: confirmed, reviewState: requestedState, reviewedAt: now2 };
}
__name(reviewJobCardArchive, "reviewJobCardArchive");

// src/offsite-clock.js
var REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{11,119}$/;
var MAX_SITE_LENGTH = 240;
var MAX_DECISION_NOTE_LENGTH = 1e3;
var ENTRY_COLUMNS = `entry_id, owner_oid, owner_upn, employee_name, work_date, site,
  clock_in_at, lunch_start_at, lunch_end_at, clock_out_at, booking_id, status, decision_note, decided_by_oid, decided_by_upn,
  decided_at, created_at, updated_at`;
var BOOKING_COLUMNS = `booking_id, owner_oid, owner_upn, employee_name, work_date, planned_start,
  planned_end, site, note, status, version, decision_note, decided_by_oid, decided_by_upn,
  decided_at, created_at, updated_at`;
function fail2(status, message) {
  throw Object.assign(new Error(message), { status });
}
__name(fail2, "fail");
function entryView(row) {
  if (!row) return null;
  return {
    entryId: row.entry_id,
    ownerUpn: row.owner_upn,
    ownerName: row.employee_name,
    workDate: row.work_date,
    site: row.site,
    clockInAt: row.clock_in_at,
    lunchStartAt: row.lunch_start_at || "",
    lunchEndAt: row.lunch_end_at || "",
    clockOutAt: row.clock_out_at || "",
    bookingId: row.booking_id || "",
    status: row.status,
    decisionNote: row.decision_note || "",
    decidedByUpn: row.decided_by_upn || "",
    decidedAt: row.decided_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
__name(entryView, "entryView");
function bookingView(row) {
  if (!row) return null;
  return {
    bookingId: row.booking_id,
    ownerUpn: row.owner_upn,
    ownerName: row.employee_name,
    workDate: row.work_date,
    start: row.planned_start,
    end: row.planned_end,
    site: row.site,
    note: row.note || "",
    status: row.status,
    version: Number(row.version || 1),
    decisionNote: row.decision_note || "",
    decidedByUpn: row.decided_by_upn || "",
    decidedAt: row.decided_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
__name(bookingView, "bookingView");
function bookingAuditView(row) {
  let payload = {};
  try {
    payload = JSON.parse(row.payload_json || "{}");
  } catch (_) {
  }
  const flatBooking = row.event_type === "book" ? {
    workDate: payload.workDate || "",
    start: payload.start || "",
    end: payload.end || "",
    site: payload.site || "",
    note: payload.note || ""
  } : null;
  return {
    eventType: row.event_type,
    previousStatus: row.previous_status || "",
    nextStatus: row.next_status || "",
    version: Number(row.version || 1),
    actorUpn: row.actor_upn || "",
    occurredAt: row.occurred_at,
    previous: payload.previous || null,
    next: payload.next || flatBooking,
    planned: payload.planned || null,
    note: payload.note || ""
  };
}
__name(bookingAuditView, "bookingAuditView");
function requestId(body) {
  const value2 = String(body?.requestId || "").trim();
  if (!REQUEST_ID_PATTERN.test(value2)) fail2(400, "A valid request ID is required for safe retry.");
  return value2;
}
__name(requestId, "requestId");
function requireIdentity(identity) {
  if (!identity?.oid || !identity?.upn) fail2(401, "A verified GMT account is required.");
}
__name(requireIdentity, "requireIdentity");
function requireDutyManager(identity) {
  if (identity?.canReviewOffsite !== true) fail2(403, "Off-site sign-off is restricted to assigned Duty Managers.");
}
__name(requireDutyManager, "requireDutyManager");
function londonWorkDate(timestamp) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(timestamp);
  const part = /* @__PURE__ */ __name((type) => String(parts.find((item) => item.type === type)?.value || ""), "part");
  return `${part("year")}-${part("month")}-${part("day")}`;
}
__name(londonWorkDate, "londonWorkDate");
function auditStatement(env, { eventId, entryId, identity, type, previousStatus, nextStatus, occurredAt }) {
  return env.DB.prepare(`INSERT INTO offsite_clock_audit
    (event_id, entry_id, actor_oid, actor_upn, event_type, previous_status, next_status, occurred_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`).bind(eventId, entryId, identity.oid, identity.upn, type, previousStatus, nextStatus, occurredAt);
}
__name(auditStatement, "auditStatement");
async function priorEvent(env, eventId) {
  return env.DB.prepare("SELECT event_id, entry_id, actor_oid, actor_upn, event_type FROM offsite_clock_audit WHERE event_id = ?").bind(eventId).first();
}
__name(priorEvent, "priorEvent");
async function currentEntry(env, entryId) {
  return env.DB.prepare(`SELECT ${ENTRY_COLUMNS} FROM offsite_clock_entries WHERE entry_id = ?`).bind(entryId).first();
}
__name(currentEntry, "currentEntry");
async function currentBooking(env, bookingId) {
  return env.DB.prepare(`SELECT ${BOOKING_COLUMNS} FROM offsite_bookings WHERE booking_id = ?`).bind(bookingId).first();
}
__name(currentBooking, "currentBooking");
function londonTime(timestamp) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(timestamp));
}
__name(londonTime, "londonTime");
function afterTimestamp(...values) {
  const latest = values.map((value2) => Date.parse(value2 || "")).filter(Number.isFinite).reduce((max, value2) => Math.max(max, value2), 0);
  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}
__name(afterTimestamp, "afterTimestamp");
function validDate2(value2) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value2 || ""));
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}
__name(validDate2, "validDate");
function isCoordinatePair(value2) {
  return /^\s*-?\d{1,3}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?\s*(?:\(.*\))?$/i.test(String(value2 || ""));
}
__name(isCoordinatePair, "isCoordinatePair");
function bookingInput(body) {
  const workDate = String(body.workDate || "").trim();
  const start = String(body.start || "").trim();
  const end = String(body.end || "").trim();
  const site = typeof body.site === "string" ? body.site.trim() : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!validDate2(workDate)) fail2(400, "Choose a valid off-site date.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) {
    fail2(400, "Enter a valid same-day start and end time; overnight bookings are not supported.");
  }
  if (!site || site.length > MAX_SITE_LENGTH) fail2(400, `Enter an off-site location of ${MAX_SITE_LENGTH} characters or fewer.`);
  if (isCoordinatePair(site)) fail2(400, "Enter a road, business or site name instead of coordinates.");
  if (note.length > MAX_DECISION_NOTE_LENGTH) fail2(400, `The booking note must be ${MAX_DECISION_NOTE_LENGTH} characters or fewer.`);
  if (workDate < londonWorkDate(/* @__PURE__ */ new Date())) fail2(400, "Off-site bookings must be for today or a future date.");
  return { workDate, start, end, site, note };
}
__name(bookingInput, "bookingInput");
function sameActor(event, identity) {
  return event && event.actor_oid === identity.oid && String(event.actor_upn || "").toLowerCase() === String(identity.upn || "").toLowerCase();
}
__name(sameActor, "sameActor");
function duplicateConflict() {
  return { status: 409, body: { error: "This request ID was already used for a different action." } };
}
__name(duplicateConflict, "duplicateConflict");
async function idempotentResult(env, event, identity, type, entryId = "") {
  if (!event) return null;
  if (!sameActor(event, identity) || event.event_type !== type || entryId && event.entry_id !== entryId) return duplicateConflict();
  const row = await currentEntry(env, event.entry_id);
  if (!row) return { status: 409, body: { error: "The original off-site entry is no longer available." } };
  return { status: 200, body: { ok: true, idempotent: true, entry: entryView(row) } };
}
__name(idempotentResult, "idempotentResult");
function conflict(message) {
  return { status: 409, body: { error: message } };
}
__name(conflict, "conflict");
function isConstraintError(error) {
  const message = String(error && error.message || error || "").toLowerCase();
  return message.includes("constraint failed") || message.includes("constraint violation") || message.includes("sqlite_constraint");
}
__name(isConstraintError, "isConstraintError");
async function clockIn(request, env, identity, readJson2) {
  requireIdentity(identity);
  const body = await readJson2(request);
  const eventId = requestId(body);
  const site = typeof body.site === "string" ? body.site.trim() : "";
  const bookingId = String(body.bookingId || "").trim();
  if (!site || site.length > MAX_SITE_LENGTH) fail2(400, `Enter an off-site location of ${MAX_SITE_LENGTH} characters or fewer.`);
  if (isCoordinatePair(site)) fail2(400, "Enter a road, business or site name instead of coordinates.");
  const duplicate = await priorEvent(env, eventId);
  if (duplicate) {
    const result = await idempotentResult(env, duplicate, identity, "clock_in");
    if (result?.status !== 200) return result;
    if (result.body.entry.site !== site || result.body.entry.bookingId !== bookingId) return duplicateConflict();
    return result;
  }
  if (bookingId) {
    const booking = await currentBooking(env, bookingId);
    if (!booking || booking.owner_oid !== identity.oid || booking.status !== "approved") fail2(409, "Choose one of your approved off-site bookings, or clock in without a booking.");
    if (booking.work_date !== londonWorkDate(/* @__PURE__ */ new Date())) fail2(409, "An approved booking can only be linked to an actual shift on its booked date.");
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const entryId = crypto.randomUUID();
  const statement = env.DB.prepare(`INSERT INTO offsite_clock_entries
    (entry_id, owner_oid, owner_upn, employee_name, work_date, site, clock_in_at, booking_id, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'clocked_in', ?, ?)`).bind(entryId, identity.oid, identity.upn, String(identity.name || identity.upn).slice(0, 240), londonWorkDate(new Date(timestamp)), site, timestamp, bookingId || null, timestamp, timestamp);
  const audit = env.DB.prepare(`INSERT INTO offsite_clock_audit
    (event_id, entry_id, actor_oid, actor_upn, event_type, previous_status, next_status, occurred_at)
    VALUES (?, ?, ?, ?, 'clock_in', '', 'clocked_in', ?)`).bind(eventId, entryId, identity.oid, identity.upn, timestamp);
  try {
    await env.DB.batch([statement, audit]);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await priorEvent(env, eventId);
    if (raced) {
      const result = await idempotentResult(env, raced, identity, "clock_in");
      if (result?.status === 200 && result.body.entry.site === site && result.body.entry.bookingId === bookingId) return result;
      if (result?.status === 200) return duplicateConflict();
      if (result) return result;
    }
    return conflict("You already have an off-site shift clocked in, or this request conflicts with a recent action.");
  }
  const row = await currentEntry(env, entryId);
  return { status: 201, body: { ok: true, entry: entryView(row) } };
}
__name(clockIn, "clockIn");
async function clockOut(request, env, identity, readJson2) {
  requireIdentity(identity);
  const body = await readJson2(request);
  const eventId = requestId(body);
  const entryId = String(body.entryId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) fail2(400, "A valid off-site entry is required.");
  const duplicate = await priorEvent(env, eventId);
  if (duplicate) return await idempotentResult(env, duplicate, identity, "clock_out", entryId) || duplicateConflict();
  const existing = await currentEntry(env, entryId);
  if (!existing || existing.owner_oid !== identity.oid) fail2(404, "Off-site entry not found.");
  if (existing.status !== "clocked_in") return conflict("This off-site entry is not clocked in.");
  const timestamp = afterTimestamp(existing.clock_in_at, existing.lunch_start_at, existing.lunch_end_at);
  if (existing.lunch_start_at && !existing.lunch_end_at) return conflict("Record lunch end before clocking out.");
  const update = env.DB.prepare(`UPDATE offsite_clock_entries SET clock_out_at = ?, status = 'awaiting_approval', updated_at = ?
    WHERE entry_id = ? AND owner_oid = ? AND status = 'clocked_in' AND clock_out_at IS NULL
      AND clock_in_at < ? AND (lunch_start_at IS NULL OR (lunch_end_at IS NOT NULL AND lunch_start_at < lunch_end_at AND lunch_end_at < ?))`).bind(timestamp, timestamp, entryId, identity.oid, timestamp, timestamp);
  const audit = auditStatement(env, { eventId, entryId, identity, type: "clock_out", previousStatus: "clocked_in", nextStatus: "awaiting_approval", occurredAt: timestamp });
  try {
    const results = await env.DB.batch([update, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await priorEvent(env, eventId);
      if (raced) return await idempotentResult(env, raced, identity, "clock_out", entryId) || duplicateConflict();
      return conflict("This off-site entry has already been clocked out.");
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await priorEvent(env, eventId);
    if (raced) return await idempotentResult(env, raced, identity, "clock_out", entryId) || duplicateConflict();
    return conflict("This off-site entry has already been clocked out.");
  }
  return { status: 200, body: { ok: true, entry: entryView(await currentEntry(env, entryId)) } };
}
__name(clockOut, "clockOut");
async function lunchEvent(request, env, identity, readJson2, eventType) {
  requireIdentity(identity);
  const body = await readJson2(request);
  const eventId = requestId(body);
  const entryId = String(body.entryId || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(entryId)) fail2(400, "A valid off-site entry is required.");
  const duplicate = await priorEvent(env, eventId);
  if (duplicate) return await idempotentResult(env, duplicate, identity, eventType, entryId) || duplicateConflict();
  const existing = await currentEntry(env, entryId);
  if (!existing || existing.owner_oid !== identity.oid) fail2(404, "Off-site entry not found.");
  if (existing.status !== "clocked_in") return conflict("Lunch times can only be recorded during an active off-site shift.");
  const isStart = eventType === "lunch_start";
  const timestamp = afterTimestamp(isStart ? existing.clock_in_at : existing.lunch_start_at);
  if (isStart && (existing.lunch_start_at || existing.lunch_end_at)) return conflict("Lunch start has already been recorded for this shift.");
  if (!isStart && (!existing.lunch_start_at || existing.lunch_end_at)) return conflict("Record lunch start before lunch end.");
  const field = isStart ? "lunch_start_at" : "lunch_end_at";
  const order = isStart ? "clock_in_at < ?" : "lunch_start_at < ?";
  const update = env.DB.prepare(`UPDATE offsite_clock_entries SET ${field} = ?, updated_at = ?
    WHERE entry_id = ? AND owner_oid = ? AND status = 'clocked_in' AND ${field} IS NULL AND ${order}`).bind(timestamp, timestamp, entryId, identity.oid, timestamp);
  const audit = auditStatement(env, { eventId, entryId, identity, type: eventType, previousStatus: "clocked_in", nextStatus: "clocked_in", occurredAt: timestamp });
  try {
    const results = await env.DB.batch([update, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await priorEvent(env, eventId);
      if (raced) return await idempotentResult(env, raced, identity, eventType, entryId) || duplicateConflict();
      return conflict(isStart ? "Lunch start has already been recorded." : "Record lunch start before lunch end.");
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await priorEvent(env, eventId);
    if (raced) return await idempotentResult(env, raced, identity, eventType, entryId) || duplicateConflict();
    return conflict(isStart ? "Lunch start has already been recorded." : "Record lunch start before lunch end.");
  }
  return { status: 200, body: { ok: true, entry: entryView(await currentEntry(env, entryId)) } };
}
__name(lunchEvent, "lunchEvent");
async function mine(env, identity) {
  requireIdentity(identity);
  const result = await env.DB.prepare(`SELECT ${ENTRY_COLUMNS} FROM offsite_clock_entries
    WHERE owner_oid = ? ORDER BY clock_in_at DESC LIMIT 100`).bind(identity.oid).all();
  return { status: 200, body: { entries: (result.results || []).map(entryView) } };
}
__name(mine, "mine");
async function pending(env, identity) {
  requireDutyManager(identity);
  const result = await env.DB.prepare(`SELECT ${ENTRY_COLUMNS} FROM offsite_clock_entries
    WHERE status = 'awaiting_approval' ORDER BY clock_out_at ASC LIMIT 100`).all();
  return { status: 200, body: { entries: (result.results || []).map((row) => ({
    ...entryView(row),
    canDecide: row.owner_oid !== identity.oid && String(row.owner_upn || "").toLowerCase() !== String(identity.upn || "").toLowerCase()
  })) } };
}
__name(pending, "pending");
async function decide(request, env, identity, readJson2, entryId) {
  requireDutyManager(identity);
  const body = await readJson2(request);
  const eventId = requestId(body);
  const decision = String(body.decision || "").trim().toLowerCase();
  if (!["approve", "reject"].includes(decision)) fail2(400, "Choose approve or reject.");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > MAX_DECISION_NOTE_LENGTH) fail2(400, `The decision note must be ${MAX_DECISION_NOTE_LENGTH} characters or fewer.`);
  if (decision === "reject" && !note) fail2(400, "Add a reason before rejecting this off-site entry.");
  const eventType = decision;
  const duplicate = await priorEvent(env, eventId);
  if (duplicate) {
    const result = await idempotentResult(env, duplicate, identity, eventType, entryId);
    if (result?.status !== 200) return result || duplicateConflict();
    const expectedStatus = decision === "approve" ? "approved" : "rejected";
    if (result.body.entry.status !== expectedStatus || result.body.entry.decisionNote !== note) return duplicateConflict();
    return result;
  }
  const existing = await currentEntry(env, entryId);
  if (!existing) fail2(404, "Off-site entry not found.");
  if (existing.owner_oid === identity.oid || String(existing.owner_upn || "").toLowerCase() === String(identity.upn || "").toLowerCase()) {
    fail2(403, "You cannot sign off your own off-site entry.");
  }
  if (existing.status !== "awaiting_approval") return conflict("Only entries awaiting sign-off can be decided.");
  const nextStatus = decision === "approve" ? "approved" : "rejected";
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const update = env.DB.prepare(`UPDATE offsite_clock_entries SET status = ?, decision_note = ?, decided_by_oid = ?,
    decided_by_upn = ?, decided_at = ?, updated_at = ? WHERE entry_id = ? AND status = 'awaiting_approval'`).bind(nextStatus, note, identity.oid, identity.upn, timestamp, timestamp, entryId);
  const audit = auditStatement(env, { eventId, entryId, identity, type: eventType, previousStatus: "awaiting_approval", nextStatus, occurredAt: timestamp });
  const workRow = {
    date: existing.work_date,
    start: londonTime(existing.clock_in_at),
    lunchStart: existing.lunch_start_at ? londonTime(existing.lunch_start_at) : "",
    lunchEnd: existing.lunch_end_at ? londonTime(existing.lunch_end_at) : "",
    finish: londonTime(existing.clock_out_at),
    location: existing.site,
    site: existing.site,
    status: "Recorded"
  };
  const payload = JSON.stringify({
    schemaVersion: 1,
    source: "approved-offsite-shift",
    date: existing.work_date,
    action: "full_day",
    actionLabel: "Approved off-site shift",
    dayStart: workRow.start,
    lunchStart: workRow.lunchStart,
    lunchEnd: workRow.lunchEnd,
    dayFinish: workRow.finish,
    location: existing.site,
    note: existing.booking_id ? `Approved off-site shift linked to booking ${existing.booking_id}.` : "Approved off-site shift.",
    approval: { decision: "approved", decidedByUpn: identity.upn, decidedAt: timestamp },
    rows: [workRow]
  });
  const approvedClockRecord = decision === "approve" ? env.DB.prepare(`INSERT OR IGNORE INTO records
        (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date,
         record_date, submitted_at, updated_at, issue, payload_json)
        SELECT ?, owner_oid, owner_upn, employee_name, 'clock', 'full_day', 'Approved', NULL, NULL,
          work_date, ?, ?, NULL, ? FROM offsite_clock_entries WHERE entry_id = ? AND status = 'approved'`).bind(`offsite-${entryId}`, existing.clock_out_at, timestamp, payload, entryId) : env.DB.prepare("SELECT 1 WHERE 0");
  try {
    const results = await env.DB.batch([update, approvedClockRecord, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await priorEvent(env, eventId);
      if (raced) {
        const result = await idempotentResult(env, raced, identity, eventType, entryId);
        if (result?.status === 200 && result.body.entry.status === nextStatus && result.body.entry.decisionNote === note) return result;
        if (result) return result;
      }
      return conflict("This entry has already been decided.");
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await priorEvent(env, eventId);
    if (raced) {
      const result = await idempotentResult(env, raced, identity, eventType, entryId);
      if (result?.status === 200 && result.body.entry.status === nextStatus && result.body.entry.decisionNote === note) return result;
      if (result) return result;
    }
    return conflict("This entry has already been decided.");
  }
  return {
    status: 200,
    body: {
      ok: true,
      entry: entryView(await currentEntry(env, entryId)),
      ...decision === "approve" ? { recordId: `offsite-${entryId}` } : {}
    }
  };
}
__name(decide, "decide");
async function bookingPriorEvent(env, eventId) {
  return env.DB.prepare("SELECT event_id, booking_id, actor_oid, actor_upn, event_type FROM offsite_booking_audit WHERE event_id = ?").bind(eventId).first();
}
__name(bookingPriorEvent, "bookingPriorEvent");
function bookingAuditStatement(env, { eventId, bookingId, identity, type, previousStatus, nextStatus, version, payload, occurredAt }) {
  return env.DB.prepare(`INSERT INTO offsite_booking_audit
    (event_id, booking_id, actor_oid, actor_upn, event_type, previous_status, next_status, version, payload_json, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(eventId, bookingId, identity.oid, identity.upn, type, previousStatus, nextStatus, version, JSON.stringify(payload || {}), occurredAt);
}
__name(bookingAuditStatement, "bookingAuditStatement");
async function bookingIdempotent(env, event, identity, type, bookingId = "") {
  if (!event) return null;
  if (!sameActor(event, identity) || event.event_type !== type || bookingId && event.booking_id !== bookingId) return duplicateConflict();
  const row = await currentBooking(env, event.booking_id);
  if (!row) return { status: 409, body: { error: "The original off-site booking is no longer available." } };
  return { status: 200, body: { ok: true, idempotent: true, booking: bookingView(row) } };
}
__name(bookingIdempotent, "bookingIdempotent");
async function createBooking(request, env, identity, readJson2) {
  requireIdentity(identity);
  const body = await readJson2(request);
  const eventId = requestId(body);
  const input = bookingInput(body);
  const duplicate = await bookingPriorEvent(env, eventId);
  if (duplicate) {
    const result = await bookingIdempotent(env, duplicate, identity, "book");
    if (result?.status !== 200) return result;
    const booking = result.body.booking;
    if (booking.workDate !== input.workDate || booking.start !== input.start || booking.end !== input.end || booking.site !== input.site || booking.note !== input.note) return duplicateConflict();
    return result;
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const bookingId = crypto.randomUUID();
  const fields = { ...input };
  const insert = env.DB.prepare(`INSERT INTO offsite_bookings
    (booking_id, owner_oid, owner_upn, employee_name, work_date, planned_start, planned_end, site, note,
     status, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_approval', 1, ?, ?)`).bind(bookingId, identity.oid, identity.upn, String(identity.name || identity.upn).slice(0, 240), input.workDate, input.start, input.end, input.site, input.note, timestamp, timestamp);
  const audit = bookingAuditStatement(env, { eventId, bookingId, identity, type: "book", previousStatus: "", nextStatus: "awaiting_approval", version: 1, payload: fields, occurredAt: timestamp });
  try {
    await env.DB.batch([insert, audit]);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await bookingPriorEvent(env, eventId);
    if (raced) {
      const result = await bookingIdempotent(env, raced, identity, "book");
      if (result?.status === 200 && result.body.booking.workDate === input.workDate && result.body.booking.start === input.start && result.body.booking.end === input.end && result.body.booking.site === input.site && result.body.booking.note === input.note) return result;
      if (result) return result.status === 200 ? duplicateConflict() : result;
    }
    return conflict("This booking request conflicts with an existing booking action.");
  }
  return { status: 201, body: { ok: true, booking: bookingView(await currentBooking(env, bookingId)) } };
}
__name(createBooking, "createBooking");
async function listBookings(env, identity, forManagers = false) {
  if (forManagers) requireDutyManager(identity);
  else requireIdentity(identity);
  const where = forManagers ? "WHERE status = 'awaiting_approval'" : "WHERE owner_oid = ?";
  const statement = env.DB.prepare(`SELECT ${BOOKING_COLUMNS} FROM offsite_bookings ${where}
    ORDER BY work_date ${forManagers ? "ASC" : "DESC"}, planned_start ASC LIMIT 100`);
  const result = forManagers ? await statement.all() : await statement.bind(identity.oid).all();
  const rows = result.results || [];
  const historyByBooking = /* @__PURE__ */ new Map();
  if (!forManagers && rows.length) {
    const bookingIds = rows.map((row) => row.booking_id);
    const placeholders = bookingIds.map(() => "?").join(", ");
    const auditResult = await env.DB.prepare(`SELECT booking_id, event_type, previous_status, next_status, version,
        actor_upn, payload_json, occurred_at
      FROM offsite_booking_audit WHERE booking_id IN (${placeholders}) ORDER BY booking_id, rowid ASC`).bind(...bookingIds).all();
    for (const event of auditResult.results || []) {
      if (!historyByBooking.has(event.booking_id)) historyByBooking.set(event.booking_id, []);
      historyByBooking.get(event.booking_id).push(bookingAuditView(event));
    }
  }
  return {
    status: 200,
    body: {
      bookings: rows.map((row) => ({
        ...bookingView(row),
        ...forManagers ? { canDecide: row.owner_oid !== identity.oid && String(row.owner_upn || "").toLowerCase() !== String(identity.upn || "").toLowerCase() } : { history: historyByBooking.get(row.booking_id) || [] }
      }))
    }
  };
}
__name(listBookings, "listBookings");
async function amendBooking(request, env, identity, readJson2, bookingId) {
  requireIdentity(identity);
  const body = await readJson2(request);
  const eventId = requestId(body);
  const input = bookingInput(body);
  const duplicate = await bookingPriorEvent(env, eventId);
  if (duplicate) {
    const result = await bookingIdempotent(env, duplicate, identity, "amend", bookingId);
    if (result?.status !== 200) return result;
    const booking = result.body.booking;
    if (booking.workDate !== input.workDate || booking.start !== input.start || booking.end !== input.end || booking.site !== input.site || booking.note !== input.note) return duplicateConflict();
    return result;
  }
  const existing = await currentBooking(env, bookingId);
  if (!existing || existing.owner_oid !== identity.oid) fail2(404, "Off-site booking not found.");
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const version = Number(existing.version || 1) + 1;
  const update = env.DB.prepare(`UPDATE offsite_bookings SET work_date = ?, planned_start = ?, planned_end = ?, site = ?, note = ?,
    status = 'awaiting_approval', version = ?, decision_note = '', decided_by_oid = NULL, decided_by_upn = NULL,
    decided_at = NULL, updated_at = ? WHERE booking_id = ? AND owner_oid = ? AND version = ?`).bind(input.workDate, input.start, input.end, input.site, input.note, version, timestamp, bookingId, identity.oid, existing.version);
  const audit = env.DB.prepare(`INSERT INTO offsite_booking_audit
    (event_id, booking_id, actor_oid, actor_upn, event_type, previous_status, next_status, version, payload_json, occurred_at)
    SELECT ?, ?, ?, ?, 'amend', ?, 'awaiting_approval', ?, ?, ? WHERE changes() > 0`).bind(eventId, bookingId, identity.oid, identity.upn, existing.status, version, JSON.stringify({ previous: bookingView(existing), next: input }), timestamp);
  try {
    const results = await env.DB.batch([update, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await bookingPriorEvent(env, eventId);
      if (raced) return await bookingIdempotent(env, raced, identity, "amend", bookingId) || duplicateConflict();
      return conflict("This booking has changed. Refresh and try again.");
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await bookingPriorEvent(env, eventId);
    if (raced) return await bookingIdempotent(env, raced, identity, "amend", bookingId) || duplicateConflict();
    return conflict("This booking has changed. Refresh and try again.");
  }
  return { status: 200, body: { ok: true, booking: bookingView(await currentBooking(env, bookingId)) } };
}
__name(amendBooking, "amendBooking");
async function decideBooking(request, env, identity, readJson2, bookingId) {
  requireDutyManager(identity);
  const body = await readJson2(request);
  const eventId = requestId(body);
  const decision = String(body.decision || "").trim().toLowerCase();
  if (!["approve", "reject"].includes(decision)) fail2(400, "Choose approve or reject.");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > MAX_DECISION_NOTE_LENGTH) fail2(400, `The decision note must be ${MAX_DECISION_NOTE_LENGTH} characters or fewer.`);
  if (decision === "reject" && !note) fail2(400, "Add a reason before rejecting this off-site booking.");
  const eventType = decision;
  const duplicate = await bookingPriorEvent(env, eventId);
  if (duplicate) {
    const result = await bookingIdempotent(env, duplicate, identity, eventType, bookingId);
    if (result?.status !== 200) return result || duplicateConflict();
    const expected = decision === "approve" ? "approved" : "rejected";
    if (result.body.booking.status !== expected || result.body.booking.decisionNote !== note) return duplicateConflict();
    return result;
  }
  const existing = await currentBooking(env, bookingId);
  if (!existing) fail2(404, "Off-site booking not found.");
  if (existing.owner_oid === identity.oid || String(existing.owner_upn || "").toLowerCase() === String(identity.upn || "").toLowerCase()) fail2(403, "You cannot sign off your own off-site booking.");
  if (existing.status !== "awaiting_approval") return conflict("Only bookings awaiting sign-off can be decided.");
  const version = Number(existing.version || 1);
  if (Number(body.version) !== version) return conflict("This booking version has changed. Refresh the queue before deciding.");
  const nextStatus = decision === "approve" ? "approved" : "rejected";
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const update = env.DB.prepare(`UPDATE offsite_bookings SET status = ?, decision_note = ?, decided_by_oid = ?, decided_by_upn = ?,
    decided_at = ?, updated_at = ? WHERE booking_id = ? AND status = 'awaiting_approval' AND version = ?`).bind(nextStatus, note, identity.oid, identity.upn, timestamp, timestamp, bookingId, version);
  const audit = env.DB.prepare(`INSERT INTO offsite_booking_audit
    (event_id, booking_id, actor_oid, actor_upn, event_type, previous_status, next_status, version, payload_json, occurred_at)
    SELECT ?, ?, ?, ?, ?, 'awaiting_approval', ?, ?, ?, ? WHERE changes() > 0`).bind(eventId, bookingId, identity.oid, identity.upn, eventType, nextStatus, version, JSON.stringify({ note, planned: bookingView(existing) }), timestamp);
  try {
    const results = await env.DB.batch([update, audit]);
    if (!(Number(results?.[0]?.meta?.changes) > 0)) {
      const raced = await bookingPriorEvent(env, eventId);
      if (raced) return await bookingIdempotent(env, raced, identity, eventType, bookingId) || duplicateConflict();
      return conflict("This booking has already been decided.");
    }
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    const raced = await bookingPriorEvent(env, eventId);
    if (raced) return await bookingIdempotent(env, raced, identity, eventType, bookingId) || duplicateConflict();
    return conflict("This booking has already been decided.");
  }
  return { status: 200, body: { ok: true, booking: bookingView(await currentBooking(env, bookingId)) } };
}
__name(decideBooking, "decideBooking");
async function offsiteClockEndpoint(request, env, identity, readJson2) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/api/offsite-clock/mine" && request.method === "GET") return mine(env, identity);
  if (path === "/api/offsite-clock/pending" && request.method === "GET") return pending(env, identity);
  if (path === "/api/offsite-clock/clock-in" && request.method === "POST") return clockIn(request, env, identity, readJson2);
  if (path === "/api/offsite-clock/lunch-start" && request.method === "POST") return lunchEvent(request, env, identity, readJson2, "lunch_start");
  if (path === "/api/offsite-clock/lunch-end" && request.method === "POST") return lunchEvent(request, env, identity, readJson2, "lunch_end");
  if (path === "/api/offsite-clock/clock-out" && request.method === "POST") return clockOut(request, env, identity, readJson2);
  if (path === "/api/offsite-bookings/mine" && request.method === "GET") return listBookings(env, identity, false);
  if (path === "/api/offsite-bookings/pending" && request.method === "GET") return listBookings(env, identity, true);
  if (path === "/api/offsite-bookings" && request.method === "POST") return createBooking(request, env, identity, readJson2);
  const bookingDecisionMatch = path.match(/^\/api\/offsite-bookings\/([0-9a-f-]{36})\/decision$/i);
  if (bookingDecisionMatch && request.method === "POST") return decideBooking(request, env, identity, readJson2, decodeURIComponent(bookingDecisionMatch[1]));
  const bookingMatch = path.match(/^\/api\/offsite-bookings\/([0-9a-f-]{36})$/i);
  if (bookingMatch && request.method === "PATCH") return amendBooking(request, env, identity, readJson2, decodeURIComponent(bookingMatch[1]));
  const decisionMatch = path.match(/^\/api\/offsite-clock\/([0-9a-f-]{36})\/decision$/i);
  if (decisionMatch && request.method === "POST") return decide(request, env, identity, readJson2, decodeURIComponent(decisionMatch[1]));
  if (path.startsWith("/api/offsite-clock/") || path.startsWith("/api/offsite-bookings")) {
    return { status: 405, body: { error: "Method not allowed." } };
  }
  return null;
}
__name(offsiteClockEndpoint, "offsiteClockEndpoint");

// src/job-card-attachments.js
var MAX_ATTACHMENT_COUNT = 10;
var MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
var MAX_ATTACHMENT_TOTAL_BYTES = 100 * 1024 * 1024;
var SHA256 = /^[a-f0-9]{64}$/;
var QUICK_XOR = /^[A-Za-z0-9+/]{27}=$/;
var MIME_BY_EXTENSION = /* @__PURE__ */ new Map([
  [".pdf", "application/pdf"],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".heif", "image/heif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"]
]);
function fail3(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
__name(fail3, "fail");
function clean3(value2, max = 500) {
  return String(value2 == null ? "" : value2).trim().slice(0, max);
}
__name(clean3, "clean");
function actorFields2(actor) {
  const oid = clean3(actor?.oid, 240);
  const upn = clean3(actor?.upn, 320).toLowerCase();
  if (!oid || !upn) fail3("Authenticated GMT identity is required", 401);
  return { oid, upn };
}
__name(actorFields2, "actorFields");
function ascii(bytes, start, end) {
  return String.fromCharCode(...bytes.subarray(start, end));
}
__name(ascii, "ascii");
function hasIsoBaseMediaFileType(bytes) {
  if (bytes.byteLength < 16 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (boxSize < 16 || boxSize > bytes.byteLength || (boxSize - 16) % 4 !== 0) return false;
  const brands = [ascii(bytes, 8, 12)];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) brands.push(ascii(bytes, offset, offset + 4));
  return brands.some((brand) => ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis", "hevm", "hevs"].includes(brand));
}
__name(hasIsoBaseMediaFileType, "hasIsoBaseMediaFileType");
function hasJobCardAttachmentSignature(bytes, contentType) {
  const prefix = /* @__PURE__ */ __name((expected) => bytes.byteLength >= expected.length && expected.every((byte, index) => bytes[index] === byte), "prefix");
  switch (contentType) {
    case "application/pdf":
      return ascii(bytes, 0, 5) === "%PDF-";
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6));
    case "image/heic":
    case "image/heif":
      return hasIsoBaseMediaFileType(bytes);
    case "image/jpeg":
      return prefix([255, 216, 255]);
    case "image/png":
      return prefix([137, 80, 78, 71, 13, 10, 26, 10]);
    case "image/webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
    default:
      return false;
  }
}
__name(hasJobCardAttachmentSignature, "hasJobCardAttachmentSignature");
function normalizeJobCardAttachmentMetadata(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail3("Attachment metadata is required");
  const rawFileName = String(input.fileName || input.file_name || "");
  if (rawFileName !== rawFileName.trim() || /["*:<>?\/\\|\u0000-\u001f\u007f]/.test(rawFileName)) {
    fail3("Attachment filename contains characters or spaces SharePoint does not allow");
  }
  const fileName = clean3(rawFileName, 220);
  const contentType = clean3(input.contentType || input.content_type, 160).toLowerCase();
  const sizeBytes = Number(input.sizeBytes ?? input.size_bytes);
  const sha256 = clean3(input.sha256, 64).toLowerCase();
  const quickXorHash = clean3(input.quickXorHash || input.quick_xor_hash, 80);
  if (!fileName || fileName === "." || fileName === "..") fail3("Attachment filename is invalid");
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : "";
  if (!MIME_BY_EXTENSION.has(extension) || MIME_BY_EXTENSION.get(extension) !== contentType) fail3("Only image and PDF attachments with matching file types are supported");
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1) fail3("Attachment size is invalid");
  if (sizeBytes > MAX_ATTACHMENT_BYTES) fail3("Attachments must not exceed 20 MiB each", 413);
  if (!SHA256.test(sha256)) fail3("Attachment SHA-256 is invalid");
  if (!QUICK_XOR.test(quickXorHash)) fail3("Attachment QuickXorHash is invalid");
  return { fileName, contentType, sizeBytes, sha256, quickXorHash };
}
__name(normalizeJobCardAttachmentMetadata, "normalizeJobCardAttachmentMetadata");
async function readJobCardAttachmentBytes(request, session) {
  const expectedSize = Number(session?.size_bytes);
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_ATTACHMENT_BYTES) fail3("Attachment size is invalid", 413);
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) !== expectedSize)) fail3("Uploaded bytes must match the reserved attachment size", 413);
  const contentType = clean3(request.headers.get("content-type"), 160).toLowerCase();
  if (contentType && contentType !== String(session.content_type || "").toLowerCase()) fail3("Uploaded content type does not match the attachment metadata");
  if (!request.body) fail3("Attachment content is required");
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { value: value2, done } = await reader.read();
    if (done) break;
    totalBytes += value2.byteLength;
    if (totalBytes > expectedSize || totalBytes > MAX_ATTACHMENT_BYTES) {
      try {
        await reader.cancel();
      } catch (_) {
      }
      fail3("Uploaded bytes exceed the reserved attachment size", 413);
    }
    chunks.push(value2);
  }
  if (totalBytes !== expectedSize) fail3("Uploaded bytes do not match the reserved attachment size", 409);
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (sha256 !== String(session.sha256 || "").toLowerCase()) fail3("Uploaded bytes do not match the attachment SHA-256", 409);
  if (!hasJobCardAttachmentSignature(bytes, String(session.content_type || "").toLowerCase())) fail3("Uploaded bytes do not match the declared image or PDF format", 415);
  return bytes;
}
__name(readJobCardAttachmentBytes, "readJobCardAttachmentBytes");
function projectJobCardAttachment(row) {
  if (!row) return null;
  return {
    attachment_id: row.attachment_id,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: Number(row.size_bytes),
    uploaded_at: row.uploaded_at
  };
}
__name(projectJobCardAttachment, "projectJobCardAttachment");
async function findCompletedJobCardAttachment(env, recordId, metadata) {
  const row = await env.DB.prepare(`SELECT attachment_id, record_id, file_name, content_type, size_bytes,
      sha256, quick_xor_hash, sharepoint_item_id, sharepoint_path, uploaded_by_oid, uploaded_by_upn, uploaded_at
    FROM job_card_attachments WHERE record_id=? AND file_name=? AND sha256=?`).bind(recordId, metadata.fileName, metadata.sha256).first();
  return row || null;
}
__name(findCompletedJobCardAttachment, "findCompletedJobCardAttachment");
async function reserveJobCardAttachmentUploadSession(env, { attachmentId, recordId, metadata, expectedPath, expiresAt, actor }) {
  const identity = actorFields2(actor);
  const safeId = clean3(attachmentId, 80);
  if (!/^[0-9a-f-]{36}$/i.test(safeId)) fail3("Attachment upload session ID is invalid");
  const pathParts = String(expectedPath || "").split("/");
  if (pathParts.length !== 4 || pathParts[0] !== "JobCards" || pathParts[1] !== "Attachments" || !/^[A-Za-z0-9_-]{1,180}$/.test(pathParts[2]) || pathParts[3] !== `${safeId}-${metadata.fileName}` || String(expectedPath).includes("..")) fail3("Attachment storage path is invalid");
  if (!Number.isFinite(Date.parse(expiresAt))) fail3("Attachment upload expiry is invalid");
  const result = await env.DB.prepare(`WITH revision_files AS (
      SELECT size_bytes FROM job_card_attachments WHERE record_id=?
      UNION ALL
      SELECT s.size_bytes FROM job_card_attachment_upload_sessions s
        WHERE s.record_id=? AND s.status='uploading'
          AND s.expires_at > ?
          AND NOT EXISTS (SELECT 1 FROM job_card_attachments a WHERE a.attachment_id=s.attachment_id)
    )
    INSERT INTO job_card_attachment_upload_sessions
    (attachment_id, record_id, file_name, content_type, size_bytes, sha256, quick_xor_hash,
     expected_path, expires_at, actor_oid, actor_upn)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM revision_files) < ?
      AND COALESCE((SELECT SUM(size_bytes) FROM revision_files), 0) + ? <= ?`).bind(
    recordId,
    recordId,
    (/* @__PURE__ */ new Date()).toISOString(),
    safeId,
    recordId,
    metadata.fileName,
    metadata.contentType,
    metadata.sizeBytes,
    metadata.sha256,
    metadata.quickXorHash,
    expectedPath,
    expiresAt,
    identity.oid,
    identity.upn,
    MAX_ATTACHMENT_COUNT,
    metadata.sizeBytes,
    MAX_ATTACHMENT_TOTAL_BYTES
  ).run();
  return Number(result?.meta?.changes || 0) === 1;
}
__name(reserveJobCardAttachmentUploadSession, "reserveJobCardAttachmentUploadSession");
async function getJobCardAttachmentUploadSession(env, recordId, attachmentId) {
  const id = clean3(attachmentId, 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) fail3("Attachment was not found", 404);
  const row = await env.DB.prepare(`SELECT * FROM job_card_attachment_upload_sessions
    WHERE attachment_id=? AND record_id=?`).bind(id, recordId).first();
  if (!row) fail3("Attachment was not found", 404);
  return row;
}
__name(getJobCardAttachmentUploadSession, "getJobCardAttachmentUploadSession");
async function expireJobCardAttachmentUploadSession(env, attachmentId) {
  await env.DB.prepare(`UPDATE job_card_attachment_upload_sessions
    SET status='expired', expected_path=NULL, completed_at=? WHERE attachment_id=? AND status='uploading'`).bind((/* @__PURE__ */ new Date()).toISOString(), attachmentId).run();
}
__name(expireJobCardAttachmentUploadSession, "expireJobCardAttachmentUploadSession");
async function completeJobCardAttachmentUpload(env, session, item) {
  if (session.status === "complete") {
    const current = await env.DB.prepare(`SELECT * FROM job_card_attachments WHERE attachment_id=?`).bind(session.attachment_id).first();
    if (!current) fail3("Completed attachment metadata is unavailable", 500);
    return { attachment: current, duplicate: false };
  }
  if (session.status === "duplicate" && session.duplicate_of) {
    const existing = await env.DB.prepare("SELECT * FROM job_card_attachments WHERE attachment_id=?").bind(session.duplicate_of).first();
    if (!existing) fail3("Duplicate attachment metadata is unavailable", 500);
    return { attachment: existing, duplicate: true };
  }
  if (session.status !== "uploading") fail3("Attachment upload session is no longer active", 410);
  if (Date.parse(session.expires_at) <= Date.now()) {
    await expireJobCardAttachmentUploadSession(env, session.attachment_id);
    fail3("Attachment upload session expired; select the file again to retry", 410);
  }
  const expectedName = `${session.attachment_id}-${session.file_name}`;
  if (!session.expected_path || !item?.id || item.name !== expectedName || Number(item.size) !== Number(session.size_bytes) || item.file?.hashes?.quickXorHash !== session.quick_xor_hash) {
    fail3("SharePoint attachment size, name, or QuickXorHash did not match the upload", 409);
  }
  const prior = await env.DB.prepare(`SELECT * FROM job_card_attachments
    WHERE record_id=? AND file_name=? AND sha256=?`).bind(session.record_id, session.file_name, session.sha256).first();
  if (prior) {
    return markDuplicateJobCardAttachmentUpload(env, session, prior, item.id);
  }
  const uploadedAt = (/* @__PURE__ */ new Date()).toISOString();
  const auditId = crypto.randomUUID();
  const event = JSON.stringify({ fileName: session.file_name, contentType: session.content_type, sizeBytes: Number(session.size_bytes), sha256: session.sha256 });
  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO job_card_attachments
      (attachment_id, record_id, file_name, content_type, size_bytes, sha256, quick_xor_hash,
       sharepoint_item_id, sharepoint_path, uploaded_by_oid, uploaded_by_upn, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      session.attachment_id,
      session.record_id,
      session.file_name,
      session.content_type,
      session.size_bytes,
      session.sha256,
      session.quick_xor_hash,
      item.id,
      session.expected_path,
      session.actor_oid,
      session.actor_upn,
      uploadedAt
    ),
    env.DB.prepare(`UPDATE job_card_attachment_upload_sessions SET status='complete', expected_path=NULL,
      completed_at=? WHERE attachment_id=? AND status='uploading'
        AND EXISTS (SELECT 1 FROM job_card_attachments WHERE attachment_id=?)`).bind(uploadedAt, session.attachment_id, session.attachment_id),
    env.DB.prepare(`INSERT INTO job_card_attachment_audit
      (audit_id, record_id, attachment_id, actor_oid, actor_upn, action, event_json, created_at)
      SELECT ?, ?, ?, ?, ?, 'uploaded', ?, ?
      WHERE EXISTS (SELECT 1 FROM job_card_attachments WHERE attachment_id=?)`).bind(auditId, session.record_id, session.attachment_id, session.actor_oid, session.actor_upn, event, uploadedAt, session.attachment_id)
  ]);
  const attachment = await env.DB.prepare("SELECT * FROM job_card_attachments WHERE attachment_id=?").bind(session.attachment_id).first();
  if (!attachment) {
    const concurrentPrior = await findCompletedJobCardAttachment(env, session.record_id, {
      fileName: session.file_name,
      sha256: session.sha256
    });
    if (concurrentPrior && concurrentPrior.attachment_id !== session.attachment_id) {
      return markDuplicateJobCardAttachmentUpload(env, session, concurrentPrior, item.id);
    }
    fail3("Attachment metadata could not be committed", 500);
  }
  return { attachment, duplicate: false };
}
__name(completeJobCardAttachmentUpload, "completeJobCardAttachmentUpload");
async function markDuplicateJobCardAttachmentUpload(env, session, prior, orphanItemId) {
  await env.DB.prepare(`UPDATE job_card_attachment_upload_sessions SET status='duplicate', duplicate_of=?,
    orphan_item_id=?, expected_path=NULL, completed_at=? WHERE attachment_id=? AND status='uploading'`).bind(prior.attachment_id, orphanItemId, (/* @__PURE__ */ new Date()).toISOString(), session.attachment_id).run();
  return { attachment: prior, duplicate: true };
}
__name(markDuplicateJobCardAttachmentUpload, "markDuplicateJobCardAttachmentUpload");
async function listJobCardAttachments(env, recordId) {
  const result = await env.DB.prepare(`SELECT attachment_id, record_id, file_name, content_type, size_bytes, uploaded_at
    FROM job_card_attachments WHERE record_id=? ORDER BY uploaded_at, attachment_id`).bind(recordId).all();
  return (result.results || []).map(projectJobCardAttachment);
}
__name(listJobCardAttachments, "listJobCardAttachments");
async function getJobCardAttachment(env, recordId, attachmentId) {
  const row = await env.DB.prepare(`SELECT * FROM job_card_attachments
    WHERE record_id=? AND attachment_id=?`).bind(recordId, attachmentId).first();
  if (!row) fail3("Attachment was not found", 404);
  return row;
}
__name(getJobCardAttachment, "getJobCardAttachment");

// src/index.js
var ALLOWED_KINDS = /* @__PURE__ */ new Set(["timesheets", "clock", "estimates", "job-cards", "calendar", "tasks", "audit", "enquiries"]);
var MAX_BODY_BYTES = 13e5;
var MAX_TIMESHEET_RECEIPT_BYTES = 32768;
var MAX_RECORD_ID2 = 180;
var MAX_TEXT = 6e3;
var MAX_ATTACHMENT_BYTES2 = 22e4;
var MAX_ATTACHMENT_TOTAL_BYTES2 = 7e5;
var MAX_QUEUE_BATCH = 25;
var MAX_PROFILE_NAME = 240;
var MAX_PROFILE_EMAIL = 320;
var ATTACHMENT_FIELDS = /* @__PURE__ */ new Set(["attachment_record", "attachment", "attachment_csv", "attachment_calendar_sync"]);
var SAFE_PAYROLL_ROW_KEYS = /* @__PURE__ */ new Set(["Absence reason", "Total hours", "Total minutes", "Worked hours", "Worked minutes", "Basic hours", "Basic minutes", "OT x1.5 hours", "OT x1.5 minutes", "OT x2.0 hours", "OT x2.0 minutes", "Weighted hours"]);
var JWKS_CACHE = /* @__PURE__ */ new Map();
var SHAREPOINT_TOKEN_CACHE = /* @__PURE__ */ new Map();
var SHAREPOINT_FOLDER_CACHE = /* @__PURE__ */ new Set();
function now() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(now, "now");
function json(data, status = 200, origin = "", extraHeaders = {}) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    vary: "Origin"
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
  }
  Object.entries(extraHeaders || {}).forEach(([name, value2]) => {
    headers[name] = value2;
  });
  return new Response(JSON.stringify(data), { status, headers });
}
__name(json, "json");
function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "Authorization, X-GMT-Upstream-Authorization, Content-Type, Accept",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "cache-control": "no-store",
    vary: "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function base64UrlDecode(value2) {
  const normalized = String(value2 || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
__name(base64UrlDecode, "base64UrlDecode");
function base64UrlEncode(value2) {
  const bytes = value2 instanceof Uint8Array ? value2 : new Uint8Array(value2 || []);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64UrlEncode, "base64UrlEncode");
function randomBase64Url(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
__name(randomBase64Url, "randomBase64Url");
async function sha256Base64Url(value2) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value2 || "")));
  return base64UrlEncode(new Uint8Array(bytes));
}
__name(sha256Base64Url, "sha256Base64Url");
function decodeJsonPart(value2) {
  return JSON.parse(new TextDecoder().decode(base64UrlDecode(value2)));
}
__name(decodeJsonPart, "decodeJsonPart");
function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(String(left || ""));
  const b = new TextEncoder().encode(String(right || ""));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}
__name(constantTimeEqual, "constantTimeEqual");
function csvSet(value2) {
  return new Set(String(value2 || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
}
__name(csvSet, "csvSet");
function audienceValue(value2) {
  return String(value2 || "").trim().toLowerCase().replace(/\/+$/, "");
}
__name(audienceValue, "audienceValue");
function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  if (!origin) return "";
  const allowed = csvSet(env.ALLOWED_ORIGINS);
  return allowed.has(origin.toLowerCase()) ? origin : null;
}
__name(allowedOrigin, "allowedOrigin");
function bearerToken(request, headerName = "Authorization") {
  const value2 = request.headers.get(headerName) || "";
  const match = value2.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}
__name(bearerToken, "bearerToken");
async function signingKey(tenantId, kid) {
  const cacheKey = `${tenantId}:${kid}`;
  if (JWKS_CACHE.has(cacheKey)) return JWKS_CACHE.get(cacheKey);
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/discovery/v2.0/keys`, {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 3600, cacheEverything: true }
  });
  if (!response.ok) throw new Error("Microsoft signing keys unavailable");
  const body = await response.json();
  const jwk = Array.isArray(body.keys) ? body.keys.find((item) => item.kid === kid) : null;
  if (!jwk) throw new Error("Microsoft signing key not found");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  JWKS_CACHE.set(cacheKey, key);
  return key;
}
__name(signingKey, "signingKey");
function tokenIdentity(claims, env) {
  const tenantId = String(env.ENTRA_TENANT_ID || "").trim().toLowerCase();
  const tokenTenant = String(claims.tid || "").trim().toLowerCase();
  if (!tenantId || !tokenTenant || !constantTimeEqual(tokenTenant, tenantId)) throw new Error("Wrong Microsoft tenant");
  const audiences = new Set(String(env.ENTRA_AUDIENCES || "").split(",").map(audienceValue).filter(Boolean));
  if (!audiences.size || !audiences.has(audienceValue(claims.aud))) throw new Error("Token audience is not permitted");
  const expectedIssuers = /* @__PURE__ */ new Set([
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`
  ]);
  if (!expectedIssuers.has(String(claims.iss || "").toLowerCase())) throw new Error("Token issuer is not permitted");
  const nowSeconds = Math.floor(Date.now() / 1e3);
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) < nowSeconds - 60) throw new Error("Token has expired");
  if (claims.nbf && Number(claims.nbf) > nowSeconds + 60) throw new Error("Token is not active");
  const oid = String(claims.oid || "").trim();
  const upn = String(claims.preferred_username || claims.upn || claims.email || "").trim().toLowerCase();
  if (!oid || !upn) throw new Error("Token has no employee identity");
  const adminUpns = /* @__PURE__ */ new Set([...csvSet(env.ADMIN_UPNS), ...csvSet(env.ADDITIONAL_ADMIN_UPNS)]);
  const adminOids = csvSet(env.ADMIN_OIDS);
  const adminGroups = csvSet(env.ADMIN_GROUP_IDS);
  const timesheetViewerUpns = csvSet(env.TIMESHEET_VIEWER_UPNS);
  const submissionsAdminUpns = csvSet(env.SUBMISSIONS_ADMIN_UPNS);
  const payMonthStartAdminUpns = csvSet(env.PAY_MONTH_START_ADMIN_UPNS);
  const jobCardAdminUpns = csvSet(env.JOB_CARD_ADMIN_UPNS);
  const operationsAdminUpns = csvSet(env.OPERATIONS_ADMIN_UPNS);
  const hrAdminUpns = csvSet(env.HR_ADMIN_UPNS);
  const xeroAdminUpns = csvSet(env.XERO_ADMIN_UPNS);
  const offsiteDutyManagerUpns = csvSet(env.OFFSITE_DUTY_MANAGER_UPNS);
  const groups = Array.isArray(claims.groups) ? claims.groups.map((item) => String(item).toLowerCase()) : [];
  const isAdmin = adminUpns.has(upn) || adminOids.has(oid.toLowerCase()) || groups.some((group) => adminGroups.has(group));
  const isHrAdmin = isAdmin || hrAdminUpns.has(upn);
  const isSubmissionAdmin = submissionsAdminUpns.has(upn);
  return {
    oid,
    upn,
    name: String(claims.name || "").trim(),
    aud: audienceValue(claims.aud),
    tid: tokenTenant,
    isAdmin,
    isHrAdmin,
    isTimesheetViewer: timesheetViewerUpns.has(upn),
    isSubmissionAdmin,
    canReviewOffsite: offsiteDutyManagerUpns.has(upn),
    canManagePayMonthStarts: payMonthStartAdminUpns.has(upn),
    isXeroAdmin: isAdmin || xeroAdminUpns.has(upn),
    isOperationsAdmin: isAdmin || operationsAdminUpns.has(upn),
    isJobCardAdmin: isAdmin || operationsAdminUpns.has(upn) || jobCardAdminUpns.has(upn)
  };
}
__name(tokenIdentity, "tokenIdentity");
function canViewAllRecords(identity, kind = "") {
  const category = canonicalKind(kind);
  if (!identity) return false;
  if (identity.isSubmissionAdmin === true) return true;
  if (category === "timesheets" || category === "clock") return identity.isTimesheetViewer === true;
  return Boolean(identity.isAdmin || category === "job-cards" && !identity.isHrAdmin || identity.isHrAdmin && category === "calendar" || identity.isOperationsAdmin && category !== "timesheets" && category !== "clock" || category === "job-cards" && identity.isJobCardAdmin);
}
__name(canViewAllRecords, "canViewAllRecords");
function isCorrectionOwner(identity,row) {
  const oid=String(identity?.oid||'').trim().toLowerCase(),upn=String(identity?.upn||'').trim().toLowerCase();
  return Boolean(oid && upn && oid===String(row?.owner_oid||'').trim().toLowerCase() &&
    upn===String(row?.owner_upn||'').trim().toLowerCase());
}

function canAccessRecord(identity, row) {
  if (!identity || !row) return false;
  if (identity.isSubmissionAdmin === true) return true;
  const category = canonicalKind(row.kind);
  const ownRecord = category === 'timesheets' && row.action === 'pay_month_correction'
    ? isCorrectionOwner(identity,row)
    : row.owner_oid === identity.oid;
  if (category === 'timesheets' || category === 'clock') return Boolean(ownRecord || (identity.isAdmin && identity.isTimesheetViewer === true));
  return Boolean(ownRecord || identity.isAdmin || (identity.isOperationsAdmin && category !== 'timesheets' && category !== 'clock') || (category === 'job-cards' && identity.isJobCardAdmin));
}
__name(canAccessRecord, "canAccessRecord");
function recordPayMonthKey(row, payPeriods2 = defaultPayPeriods()) {
  if (!row) return "";
  const payload = row.payload && typeof row.payload === "object" ? row.payload : payloadObject(row);
  const declared = text2(payload.payMonth || payload.pay_month, "", 7);
  if (row.action === "pay_month_correction" && /^\d{4}-\d{2}$/.test(declared)) return declared;
  const dates = Array.isArray(payload.rows) ? payload.rows.map((entry) => text2(entry?.date, "", 10)).filter(Boolean) : [];
  return payCycleKeyForDate(dates[0] || payload.date || row.record_date || row.start_date || row.end_date, payPeriods2) || declared;
}
__name(recordPayMonthKey, "recordPayMonthKey");
function isOwnerRecord(identity, row) {
  if (!identity || !row) return false;
  const category = canonicalKind(row.kind);
  // Legacy on-behalf corrections may retain the editor's OID. Hold them for
  // ownership review instead of allowing mutations based on an address alone.
  if (category === 'timesheets' && row.action === 'pay_month_correction') {
    return isCorrectionOwner(identity,row);
  }
  return row.owner_oid === identity.oid
    || text2(row.employee_upn || row.employee_email || '', '', 320).toLowerCase() === identity.upn?.toLowerCase();
}
__name(isOwnerRecord, "isOwnerRecord");
function canEditRecord(identity, row, nowDate = /* @__PURE__ */ new Date(), payPeriods2 = defaultPayPeriods()) {
  if (!identity || !row) return false;
  if (identity.isSubmissionAdmin === true) return true;
  const category = canonicalKind(row.kind);
  if (category === "timesheets" || category === "clock") {
    const owner = isOwnerRecord(identity, row);
    const currentPayMonth = recordPayMonthKey(row, payPeriods2) === payCycleKeyForDate(londonDateKey(nowDate, "Europe/London"), payPeriods2);
    if (owner) return currentPayMonth;
    return identity.isAdmin === true && identity.isTimesheetViewer === true && isCurrentPayMonthRecord(row, "Europe/London", nowDate, payPeriods2);
  }
  return Boolean(isOwnerRecord(identity, row) || identity.isAdmin || identity.isOperationsAdmin && category !== "timesheets" && category !== "clock" || category === "job-cards" && identity.isJobCardAdmin);
}
__name(canEditRecord, "canEditRecord");
function canReadHistoryRecord(identity, row) {
  if (!identity || !row) return false;
  if (identity.isSubmissionAdmin === true) return true;
  const category = canonicalKind(row.kind || row.action);
  const employeeUpn = text2(row.employee_upn || row.employee_email || row.employeeEmail || row.owner_upn, "", 320).toLowerCase();
  const employeeName = text2(row.employee_name || row.employeeName, "", 240).toLowerCase();
  const ownRecord = employeeUpn ? employeeUpn === identity.upn : Boolean(identity.name && employeeName && employeeName === identity.name.toLowerCase());
  if (category === "timesheets" || category === "clock") return identity.isTimesheetViewer === true || ownRecord;
  if (identity.isAdmin || identity.isOperationsAdmin) return true;
  if (category === "job-cards" || identity.isHrAdmin && category === "calendar") return true;
  return ownRecord;
}
__name(canReadHistoryRecord, "canReadHistoryRecord");
function canViewRecord(identity, row) {
  return Boolean(identity && row && (canAccessRecord(identity, row) || canViewAllRecords(identity, row.kind)));
}
__name(canViewRecord, "canViewRecord");
async function authenticateToken(token, env) {
  if (!token) throw Object.assign(new Error("Authentication required"), { status: 401 });
  const pieces = token.split(".");
  if (pieces.length !== 3) throw Object.assign(new Error("Invalid authentication token"), { status: 401 });
  let header;
  let claims;
  try {
    header = decodeJsonPart(pieces[0]);
    claims = decodeJsonPart(pieces[1]);
  } catch (_) {
    throw Object.assign(new Error("Invalid authentication token"), { status: 401 });
  }
  if (header.alg !== "RS256" || !header.kid) throw Object.assign(new Error("Unsupported authentication token"), { status: 401 });
  const key = await signingKey(env.ENTRA_TENANT_ID, header.kid);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlDecode(pieces[2]), new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`));
  if (!valid) throw Object.assign(new Error("Invalid authentication token"), { status: 401 });
  try {
    return tokenIdentity(claims, env);
  } catch (error) {
    throw Object.assign(new Error(error.message || "Unauthorised"), { status: 401 });
  }
}
__name(authenticateToken, "authenticateToken");
async function authenticate(request, env) {
  const identity = await authenticateToken(bearerToken(request), env);
  if (!env.DB) return identity;
  try {
    const result = await env.DB.prepare("SELECT role FROM portal_access_assignments WHERE owner_oid = ? AND owner_upn = ?").bind(identity.oid, identity.upn).all();
    const roles = new Set((result.results || []).map((row) => String(row.role || "")));
    identity.assignedRoles = Array.from(roles);
    identity.isHrAdmin = identity.isHrAdmin || roles.has("hr");
    identity.isXeroAdmin = identity.isXeroAdmin || roles.has("xero");
    identity.isOperationsAdmin = identity.isOperationsAdmin || roles.has("operations");
    identity.isJobCardAdmin = identity.isJobCardAdmin || roles.has("job-card");
  } catch (_) {
    identity.assignedRoles = [];
  }
  return identity;
}
__name(authenticate, "authenticate");
async function authenticateFlowToken(request, env, portalIdentity) {
  const token = bearerToken(request, "X-GMT-Upstream-Authorization");
  if (!token) throw Object.assign(new Error("A signed-in employee Flow Service token is required"), { status: 401 });
  const pieces = token.split(".");
  if (pieces.length !== 3) throw Object.assign(new Error("Invalid Flow Service token"), { status: 401 });
  let header;
  let claims;
  try {
    header = decodeJsonPart(pieces[0]);
    claims = decodeJsonPart(pieces[1]);
  } catch (_) {
    throw Object.assign(new Error("Invalid Flow Service token"), { status: 401 });
  }
  if (header.alg !== "RS256" || !header.kid) throw Object.assign(new Error("Unsupported Flow Service token"), { status: 401 });
  let validSignature = false;
  try {
    const key = await signingKey(env.ENTRA_TENANT_ID, header.kid);
    validSignature = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlDecode(pieces[2]), new TextEncoder().encode(`${pieces[0]}.${pieces[1]}`));
  } catch (_) {
    validSignature = false;
  }
  if (!validSignature) throw Object.assign(new Error("Invalid Flow Service token"), { status: 401 });
  const tenantId = String(env.ENTRA_TENANT_ID || "").trim().toLowerCase();
  const tokenTenant = String(claims.tid || "").trim().toLowerCase();
  if (!tenantId || tokenTenant !== tenantId) throw Object.assign(new Error("Flow Service token is from the wrong tenant"), { status: 403 });
  if (String(claims.aud || "") !== "https://service.flow.microsoft.com/") throw Object.assign(new Error("Flow Service token has the wrong audience"), { status: 403 });
  const expectedIssuers = /* @__PURE__ */ new Set([
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`
  ]);
  if (!expectedIssuers.has(String(claims.iss || "").toLowerCase())) throw Object.assign(new Error("Flow Service token issuer is not permitted"), { status: 403 });
  const nowSeconds = Math.floor(Date.now() / 1e3);
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) < nowSeconds - 60 || claims.nbf && Number(claims.nbf) > nowSeconds + 60) {
    throw Object.assign(new Error("Flow Service token is not currently valid"), { status: 401 });
  }
  if (!claims.oid || String(claims.oid).toLowerCase() !== String(portalIdentity?.oid || "").toLowerCase()) {
    throw Object.assign(new Error("Flow Service token must belong to the signed-in portal user"), { status: 403 });
  }
  return token;
}
__name(authenticateFlowToken, "authenticateFlowToken");
function text2(value2, fallback = "", max = MAX_TEXT) {
  const result = String(value2 == null ? fallback : value2).trim();
  return result.slice(0, max);
}
__name(text2, "text");
function httpUrl(value2, max = 2e3) {
  const candidate = text2(value2, "", max);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? candidate : "";
  } catch (_) {
    return "";
  }
}
__name(httpUrl, "httpUrl");
function profileDisplayName(value2, fallback = "") {
  const candidate = text2(value2, fallback, MAX_PROFILE_NAME);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? "" : candidate;
}
__name(profileDisplayName, "profileDisplayName");
function profileNotificationEmail(value2) {
  const candidate = text2(value2, "", MAX_PROFILE_EMAIL);
  if (!candidate) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
    throw Object.assign(new Error("Enter a valid personal email address."), { status: 400 });
  }
  return candidate;
}
__name(profileNotificationEmail, "profileNotificationEmail");
function profileView(identity, row = null) {
  return {
    name: row ? text2(row.display_name, "", MAX_PROFILE_NAME) : profileDisplayName(identity.name),
    username: identity.upn,
    notificationEmail: row ? text2(row.notification_email, "", MAX_PROFILE_EMAIL) : "",
    updatedAt: row ? text2(row.updated_at, "", 80) : "",
    source: row ? "portal-d1" : "identity-default"
  };
}
__name(profileView, "profileView");
async function getProfileSettings(env, identity) {
  const row = await env.DB.prepare(`SELECT display_name, notification_email, updated_at
    FROM profile_settings WHERE owner_oid = ?`).bind(identity.oid).first();
  return profileView(identity, row || null);
}
__name(getProfileSettings, "getProfileSettings");
async function saveProfileSettings(env, identity, body) {
  const existing = await env.DB.prepare(`SELECT display_name, notification_email
    FROM profile_settings WHERE owner_oid = ?`).bind(identity.oid).first();
  const hasName = Object.prototype.hasOwnProperty.call(body || {}, "name") || Object.prototype.hasOwnProperty.call(body || {}, "displayName");
  const hasNotificationEmail = Object.prototype.hasOwnProperty.call(body || {}, "notificationEmail") || Object.prototype.hasOwnProperty.call(body || {}, "notification_email");
  const displayName = hasName ? profileDisplayName(body.name ?? body.displayName, "") : text2(existing?.display_name, "", MAX_PROFILE_NAME);
  const notificationEmail = hasNotificationEmail ? profileNotificationEmail(body.notificationEmail ?? body.notification_email) : text2(existing?.notification_email, "", MAX_PROFILE_EMAIL);
  const updatedAt = now();
  await env.DB.prepare(`INSERT INTO profile_settings
      (owner_oid, owner_upn, display_name, notification_email, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(owner_oid) DO UPDATE SET owner_upn = excluded.owner_upn,
      display_name = excluded.display_name, notification_email = excluded.notification_email,
      updated_at = excluded.updated_at`).bind(
    identity.oid,
    identity.upn,
    displayName,
    notificationEmail,
    updatedAt
  ).run();
  return profileView(identity, {
    display_name: displayName,
    notification_email: notificationEmail,
    updated_at: updatedAt
  });
}
__name(saveProfileSettings, "saveProfileSettings");
var XERO_DEFAULT_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
var XERO_DEFAULT_TOKEN_URL = "https://identity.xero.com/connect/token";
var XERO_DEFAULT_API_URL = "https://api.xero.com";
var XERO_DEFAULT_RETURN_URL = "https://gmt-services.co.uk/tools/invoices?xero=connected";
var XERO_DEFAULT_SCOPES = "openid profile email offline_access accounting.invoices accounting.contacts accounting.settings";
function xeroSettings(env) {
  const clientId = text2(env.XERO_CLIENT_ID, "", 240);
  const clientSecret = text2(env.XERO_CLIENT_SECRET, "", 500);
  const redirectUri = text2(env.XERO_REDIRECT_URI, "", 2e3);
  const encryptionKey = text2(env.XERO_TOKEN_ENCRYPTION_KEY, "", 1e3);
  return {
    clientId,
    clientSecret,
    redirectUri,
    encryptionKey,
    authUrl: text2(env.XERO_AUTH_URL, XERO_DEFAULT_AUTH_URL, 2e3),
    tokenUrl: text2(env.XERO_TOKEN_URL, XERO_DEFAULT_TOKEN_URL, 2e3),
    apiUrl: text2(env.XERO_API_URL, XERO_DEFAULT_API_URL, 2e3).replace(/\/+$/, ""),
    scopes: text2(env.XERO_SCOPES, XERO_DEFAULT_SCOPES, 1e3),
    returnUrl: safeXeroReturnUrl(env.XERO_POST_CONNECT_REDIRECT, env),
    configured: Boolean(clientId && clientSecret && redirectUri && encryptionKey)
  };
}
__name(xeroSettings, "xeroSettings");
function safeXeroReturnUrl(value2, env) {
  const fallback = XERO_DEFAULT_RETURN_URL;
  const candidate = text2(value2, fallback, 2e3);
  try {
    const parsed = new URL(candidate);
    const allowed = csvSet(env?.ALLOWED_ORIGINS);
    return allowed.has(parsed.origin.toLowerCase()) ? parsed.href : fallback;
  } catch (_) {
    return fallback;
  }
}
__name(safeXeroReturnUrl, "safeXeroReturnUrl");
function decodeXeroKey(value2) {
  const candidate = text2(value2, "", 1e3);
  if (!candidate) return null;
  try {
    if (/^[0-9a-f]{64}$/i.test(candidate)) return Uint8Array.from(candidate.match(/.{2}/g).map((pair) => parseInt(pair, 16)));
    const decoded = base64UrlDecode(candidate);
    return decoded.length === 32 ? decoded : null;
  } catch (_) {
    return null;
  }
}
__name(decodeXeroKey, "decodeXeroKey");
async function xeroCryptoKey(settings, usages) {
  const bytes = decodeXeroKey(settings.encryptionKey);
  if (!bytes || bytes.length !== 32) throw Object.assign(new Error("Xero token encryption is not configured"), { status: 503 });
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, usages);
}
__name(xeroCryptoKey, "xeroCryptoKey");
async function encryptXeroSecret(value2, settings) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await xeroCryptoKey(settings, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(value2 || "")));
  return { iv: base64UrlEncode(iv), ciphertext: base64UrlEncode(new Uint8Array(ciphertext)) };
}
__name(encryptXeroSecret, "encryptXeroSecret");
async function decryptXeroSecret(ciphertext, iv, settings) {
  try {
    const key = await xeroCryptoKey(settings, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64UrlDecode(iv) }, key, base64UrlDecode(ciphertext));
    return new TextDecoder().decode(plaintext);
  } catch (_) {
    throw Object.assign(new Error("Stored Xero token cannot be decrypted"), { status: 503 });
  }
}
__name(decryptXeroSecret, "decryptXeroSecret");
function xeroCookieState(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)gmt_xero_oauth_state=([^;]+)/);
  if (!match) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch (_) {
    return "";
  }
}
__name(xeroCookieState, "xeroCookieState");
function xeroOAuthStateMatches(state, cookieState) {
  return Boolean(state) && (!cookieState || constantTimeEqual(state, cookieState));
}
__name(xeroOAuthStateMatches, "xeroOAuthStateMatches");
function xeroStateCookie(value2, maxAge = 600) {
  return `gmt_xero_oauth_state=${encodeURIComponent(value2 || "")}; Max-Age=${maxAge}; Path=/api/xero; HttpOnly; Secure; SameSite=None`;
}
__name(xeroStateCookie, "xeroStateCookie");
function xeroBasicAuth(settings) {
  return `Basic ${btoa(`${settings.clientId}:${settings.clientSecret}`)}`;
}
__name(xeroBasicAuth, "xeroBasicAuth");
function xeroApiHeaders(accessToken, tenantId = "") {
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${accessToken}`
  };
  if (tenantId) headers["xero-tenant-id"] = tenantId;
  return headers;
}
__name(xeroApiHeaders, "xeroApiHeaders");
function xeroErrorMessage(body, fallback) {
  if (!body) return fallback;
  if (typeof body === "string") return text2(body, fallback, 500);
  const message = body.Message || body.message || body.error_description || body.error;
  return text2(message, fallback, 500);
}
__name(xeroErrorMessage, "xeroErrorMessage");
function xeroInvoiceProjection(invoice) {
  const contact = invoice && invoice.Contact && typeof invoice.Contact === "object" ? invoice.Contact : {};
  const total = Number(invoice?.Total);
  const amountDue = Number(invoice?.AmountDue);
  const status = text2(invoice?.Status, "", 80).toUpperCase();
  const sent = invoice?.SentToContact === true;
  const paid = status === "PAID" || Number.isFinite(amountDue) && amountDue <= 0 && Number(invoice?.AmountPaid) > 0;
  const deleted = status === "DELETED";
  const displayStatus = deleted ? "Deleted" : status === "DRAFT" ? "Draft" : status === "VOIDED" ? "Voided" : paid ? "Paid" : sent ? "Sent" : "Unpaid";
  return {
    invoice_id: text2(invoice?.InvoiceID, "", 100),
    invoice_number: text2(invoice?.InvoiceNumber, "", 255),
    status,
    display_status: displayStatus,
    delivery_status: deleted ? "Deleted" : sent ? "Sent" : "Unsent",
    payment_status: deleted || status === "VOIDED" ? "Not applicable" : paid ? "Paid" : Number(invoice?.AmountPaid) > 0 ? "Part-paid" : "Unpaid",
    sent_to_contact: sent,
    type: text2(invoice?.Type, "", 40),
    contact_name: text2(contact?.Name, "", 500),
    date: text2(invoice?.DateString || invoice?.Date, "", 80),
    due_date: text2(invoice?.DueDateString || invoice?.DueDate, "", 80),
    total: Number.isFinite(total) ? total : null,
    amount_due: Number.isFinite(amountDue) ? amountDue : null,
    currency: text2(invoice?.CurrencyCode, "", 20),
    url: httpUrl(invoice?.Url, 2e3)
  };
}
__name(xeroInvoiceProjection, "xeroInvoiceProjection");
function xeroInvoiceDeliveryStatus(invoice) {
  return String(invoice?.Status || "").toUpperCase() === "DELETED" ? "Deleted" : invoice?.SentToContact === true ? "Sent" : "Unsent";
}
__name(xeroInvoiceDeliveryStatus, "xeroInvoiceDeliveryStatus");
function xeroInvoicePaymentStatus(invoice) {
  const status = String(invoice?.Status || "").toUpperCase();
  if (status === "DELETED" || status === "VOIDED") return "Not applicable";
  if (status === "PAID" || Number(invoice?.AmountDue) <= 0 && Number(invoice?.AmountPaid) > 0) return "Paid";
  if (Number(invoice?.AmountPaid) > 0) return "Part-paid";
  return "Unpaid";
}
__name(xeroInvoicePaymentStatus, "xeroInvoicePaymentStatus");
function xeroInvoiceMutationPolicy(invoice) {
  const status = String(invoice?.Status || "").toUpperCase();
  const amountPaid = Number(invoice?.AmountPaid) || 0;
  const eligible = amountPaid <= 0 && ["DRAFT", "AUTHORISED"].includes(status);
  return {
    canEdit: status === "DRAFT" && amountPaid <= 0,
    canSend: ["DRAFT", "AUTHORISED"].includes(status) && invoice?.SentToContact !== true && amountPaid <= 0,
    canDelete: eligible,
    deleteAction: status === "AUTHORISED" ? "void" : "delete"
  };
}
__name(xeroInvoiceMutationPolicy, "xeroInvoiceMutationPolicy");
function xeroInvoicePayload(input, invoiceId = "") {
  const body = input && typeof input === "object" ? input : {};
  const contactId = text2(body.contactId || body.contact_id, "", 100);
  const date = text2(body.date, "", 10);
  const dueDate = text2(body.dueDate || body.due_date, "", 10);
  const invoiceNumber = text2(body.invoiceNumber || body.invoice_number, "", 255);
  const reference = text2(body.reference, "", 255);
  const lineAmountTypes = ["Exclusive", "Inclusive", "NoTax"].includes(body.lineAmountTypes) ? body.lineAmountTypes : "Exclusive";
  const supplied = Array.isArray(body.lineItems) ? body.lineItems : Array.isArray(body.line_items) ? body.line_items : [];
  if (!contactId) throw Object.assign(new Error("Choose a Xero customer before saving the invoice"), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw Object.assign(new Error("Invoice and due dates must use YYYY-MM-DD"), { status: 400 });
  if (!supplied.length || supplied.length > 100) throw Object.assign(new Error("An invoice must have between 1 and 100 line items"), { status: 400 });
  const LineItems = supplied.map((item) => {
    const quantity = Number(item?.quantity);
    const unitAmount = Number(item?.unitAmount ?? item?.unit_amount);
    const description = text2(item?.description, "", 4e3);
    const accountCode = text2(item?.accountCode || item?.account_code, "", 40);
    const taxType = text2(item?.taxType || item?.tax_type, "", 80);
    if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitAmount) || unitAmount < 0 || !accountCode || !taxType) {
      throw Object.assign(new Error("Each invoice line needs a description, positive quantity, valid unit price, account code, and tax type"), { status: 400 });
    }
    return { Description: description, Quantity: quantity, UnitAmount: unitAmount, AccountCode: accountCode, TaxType: taxType };
  });
  const invoice = { Type: "ACCREC", Contact: { ContactID: contactId }, Date: date, LineAmountTypes: lineAmountTypes, LineItems };
  if (dueDate) invoice.DueDate = dueDate;
  if (invoiceNumber) invoice.InvoiceNumber = invoiceNumber;
  if (reference) invoice.Reference = reference;
  if (invoiceId) invoice.InvoiceID = text2(invoiceId, "", 100);
  else invoice.Status = "DRAFT";
  return invoice;
}
__name(xeroInvoicePayload, "xeroInvoicePayload");
function xeroTokenExpiry(expiresIn) {
  const seconds = Math.max(60, Number(expiresIn) || 1800);
  return new Date(Date.now() + seconds * 1e3).toISOString();
}
__name(xeroTokenExpiry, "xeroTokenExpiry");
function base64ByteLength(value2) {
  const candidate = String(value2 || "");
  if (!candidate || candidate.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(candidate)) return -1;
  const padding = candidate.endsWith("==") ? 2 : candidate.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(candidate.length * 3 / 4) - padding);
}
__name(base64ByteLength, "base64ByteLength");
function safeAttachmentName(value2) {
  const name = text2(value2, "", 220);
  if (!name || /[\\/\u0000-\u001f\u007f]/.test(name) || name === "." || name === "..") return "";
  return name;
}
__name(safeAttachmentName, "safeAttachmentName");
function attachmentType(fieldName, fileName, contentType) {
  if (!ATTACHMENT_FIELDS.has(fieldName)) return "";
  const extension = String(fileName || "").toLowerCase().split(".").pop();
  const allowed = {
    attachment_record: ["json"],
    attachment: ["xlsx"],
    attachment_csv: ["csv"],
    attachment_calendar_sync: ["json"]
  };
  if (!allowed[fieldName]?.includes(extension)) return "";
  const expected = {
    json: "application/json",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    csv: "text/csv"
  }[extension];
  const supplied = text2(contentType, "", 160).toLowerCase();
  return !supplied || supplied === expected || extension === "json" && supplied === "text/json" ? expected : "";
}
__name(attachmentType, "attachmentType");
function adminTestRecord(record, payload = null) {
  const body = payload || payloadObject(record || {});
  const candidates = [
    record?.employee_upn,
    record?.employee_email,
    record?.employeeEmail,
    body?.employee_upn,
    body?.employeeEmail,
    body?.employee_email,
    body?.employeeName,
    record?.employee_name,
    record?.title,
    record?.Title,
    body?.title,
    body?.Title
  ].map((value2) => text2(value2, "", 320).toLowerCase());
  return candidates.some((value2) => /\bacc\.gmtelect(?:@|$)/i.test(value2) || /^(?:amanda|amanda\s+bb)$/i.test(value2));
}
__name(adminTestRecord, "adminTestRecord");
function syntheticRecord(record, payload = null) {
  const body = payload || payloadObject(record || {});
  const title = text2(record?.title || record?.Title || body?.title || body?.Title, "", 500);
  return adminTestRecord(record, body) || body && body.testMode === true || /^TEST(?:[\s_-]|$)/i.test(text2(record?.employee_name, "", 240)) || /^TEST(?:[\s_-]|$)/i.test(text2(body?.employeeName, "", 240)) || /\b(?:flow\s+test|flow\s+validation|historical\s+backfill|archive\s+(?:backfill|real)|test\s+(?:route|external))\b/i.test(title);
}
__name(syntheticRecord, "syntheticRecord");
function hours(value2) {
  const numeric = Number(value2);
  return Number.isFinite(numeric) ? (numeric / 60).toFixed(2) : "0.00";
}
__name(hours, "hours");
function dispatchSettings(env) {
  const configuredHour = Number(env.DISPATCH_HOUR);
  return {
    enabled: /^(1|true|yes|on)$/i.test(String(env.DISPATCH_ENABLED || "")),
    weekday: text2(env.DISPATCH_WEEKDAY, "Friday", 20).toLowerCase(),
    hour: Number.isFinite(configuredHour) ? Math.max(0, Math.min(23, configuredHour)) : 18,
    timeZone: text2(env.DISPATCH_TIMEZONE, "Europe/London", 80)
  };
}
__name(dispatchSettings, "dispatchSettings");
function localTimeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return {
    weekday: String(parts.find((part) => part.type === "weekday")?.value || "").toLowerCase(),
    hour: Number(parts.find((part) => part.type === "hour")?.value || -1)
  };
}
__name(localTimeParts, "localTimeParts");
function monthKeyInTimeZone(date = /* @__PURE__ */ new Date(), timeZone = "Europe/London") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = String(parts.find((part) => part.type === "year")?.value || "");
  const month = String(parts.find((part) => part.type === "month")?.value || "");
  return year && month ? `${year}-${month}` : "";
}
__name(monthKeyInTimeZone, "monthKeyInTimeZone");
function recordMonthKey(value2, timeZone = "Europe/London") {
  const candidate = text2(value2, "", 80);
  if (!candidate) return "";
  const prefix = candidate.match(/^(\d{4})-(\d{2})/);
  if (prefix) return `${prefix[1]}-${prefix[2]}`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? "" : monthKeyInTimeZone(parsed, timeZone);
}
__name(recordMonthKey, "recordMonthKey");
function defaultPayPeriods() {
  return import_pay_periods.default;
}
__name(defaultPayPeriods, "defaultPayPeriods");
async function loadPayPeriods(env) {
  const result = await env.DB.prepare("SELECT month_key AS monthKey, start_date AS startDate FROM pay_month_start_settings ORDER BY month_key").all();
  return defaultPayPeriods().createPayPeriods(result.results || []);
}
__name(loadPayPeriods, "loadPayPeriods");
function londonDateKey(nowDate = /* @__PURE__ */ new Date(), timeZone = "Europe/London") {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(nowDate);
  const value2 = /* @__PURE__ */ __name((kind) => String(parts.find((part) => part.type === kind)?.value || ""), "value");
  return `${value2("year")}-${value2("month")}-${value2("day")}`;
}
__name(londonDateKey, "londonDateKey");
function payCycleKeyForDate(value2, payPeriods2 = defaultPayPeriods()) {
  return payPeriods2 && typeof payPeriods2.payMonthKeyForDate === "function" ? payPeriods2.payMonthKeyForDate(value2) : "";
}
__name(payCycleKeyForDate, "payCycleKeyForDate");
function payMonthForPayload(payload, fallbackDate, payPeriods2 = defaultPayPeriods()) {
  const dailyRows = [payload?.rows, payload?.dailyRows, payload?.daily_rows, payload?.gmtDailyRows].find(Array.isArray) || [];
  const firstDailyDate = dailyRows.map((row) => text2(row?.date, "", 10)).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort()[0];
  return payCycleKeyForDate(firstDailyDate || fallbackDate, payPeriods2);
}
__name(payMonthForPayload, "payMonthForPayload");
function editablePayCycleKeys(nowDate = /* @__PURE__ */ new Date(), timeZone = "Europe/London", payPeriods2 = defaultPayPeriods()) {
  const today = londonDateKey(nowDate, timeZone);
  const current = payCycleKeyForDate(today, payPeriods2);
  const previous = payPeriods2 && typeof payPeriods2.previousPayMonthKey === "function" ? payPeriods2.previousPayMonthKey(current) : "";
  return [current, previous].filter(Boolean);
}
__name(editablePayCycleKeys, "editablePayCycleKeys");
function currentPayCycleKeys(nowDate = /* @__PURE__ */ new Date(), timeZone = "Europe/London", payPeriods2 = defaultPayPeriods()) {
  const current = payCycleKeyForDate(londonDateKey(nowDate, timeZone), payPeriods2);
  return current ? [current] : [];
}
__name(currentPayCycleKeys, "currentPayCycleKeys");
function isCurrentPayMonthRecord(row, timeZone = "Europe/London", nowDate = /* @__PURE__ */ new Date(), payPeriods2 = defaultPayPeriods()) {
  if (!row) return false;
  const payload = payloadObject(row);
  const declared = text2(payload.payMonth || payload.pay_month, "", 7);
  const dates = Array.isArray(payload.rows) ? payload.rows.map((entry) => text2(entry?.date, "", 10)).filter(Boolean) : [];
  const dateMonth = payCycleKeyForDate(dates[0] || row.record_date || row.start_date || row.end_date, payPeriods2);
  const month = row.action === "pay_month_correction" && /^\d{4}-\d{2}$/.test(declared) ? declared : dateMonth || declared;
  return editablePayCycleKeys(nowDate, timeZone, payPeriods2).includes(month);
}
__name(isCurrentPayMonthRecord, "isCurrentPayMonthRecord");
function validatePayMonthCorrection(body, nowDate = /* @__PURE__ */ new Date(), payPeriods2 = defaultPayPeriods(), identity = null) {
  const payload = body?.payload && typeof body.payload === "object" ? body.payload : {};
  const month = text2(payload.payMonth, "", 7);
  const editableMonths = identity?.isSubmissionAdmin === true ? [month] : identity?.isAdmin === true && identity?.isTimesheetViewer === true ? editablePayCycleKeys(nowDate, "Europe/London", payPeriods2) : currentPayCycleKeys(nowDate, "Europe/London", payPeriods2);
  if (!/^\d{4}-\d{2}$/.test(month) || !editableMonths.includes(month)) {
    throw Object.assign(new Error(identity?.isSubmissionAdmin === true ? "Choose a valid pay month for the record being corrected." : "Only the current pay month can be edited."), { status: 409 });
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const deletedDays = Array.isArray(payload.deletedDays) ? payload.deletedDays : [];
  if (rows.length > 80 || deletedDays.length > 80) throw Object.assign(new Error("Too many pay-month dates"), { status: 400 });
  const seen = /* @__PURE__ */ new Set();
  [...rows.map((row) => row?.date), ...deletedDays].forEach((date) => {
    const key = text2(date, "", 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || payCycleKeyForDate(key, payPeriods2) !== month) {
      throw Object.assign(new Error("Every corrected date must belong to the selected pay month"), { status: 400 });
    }
    if (seen.has(key)) throw Object.assign(new Error("Each corrected date must be unique"), { status: 400 });
    seen.add(key);
  });
  validateNoFutureWork("timesheets", "pay_month_correction", payload, nowDate);
  return month;
}
__name(validatePayMonthCorrection, "validatePayMonthCorrection");
function validateNoFutureWork(kind, action, payload, nowDate = /* @__PURE__ */ new Date()) {
  if (kind !== "timesheets" && kind !== "clock") return;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(nowDate);
  const value2 = /* @__PURE__ */ __name((type) => String(parts.find((part) => part.type === type)?.value || ""), "value");
  const today = `${value2("year")}-${value2("month")}-${value2("day")}`;
  const nowMinutes = Number(value2("hour")) * 60 + Number(value2("minute"));
  if (kind === "clock") {
    const actionKey = String(action || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const dailyActions = /* @__PURE__ */ new Set(["clock_in", "lunch_start", "lunch_end", "clock_out", "absent", "full_day"]);
    for (const [field, maxLength] of [["location", 240], ["note", 1e3]]) {
      const fieldValue = payload[field];
      if (fieldValue !== void 0 && fieldValue !== null && typeof fieldValue !== "string") {
        throw Object.assign(new Error(`Clock ${field} must be text.`), { status: 400 });
      }
      if (String(fieldValue || "").length > maxLength) {
        throw Object.assign(new Error(`Clock ${field} must be ${maxLength} characters or fewer.`), { status: 400 });
      }
    }
    const eventDate = String(payload.date || payload.recordDate || "").slice(0, 10);
    if (dailyActions.has(actionKey)) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(eventDate);
      const date = match && new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      if (!date || date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
        throw Object.assign(new Error("A valid clock date is required."), { status: 400 });
      }
    }
    if (eventDate > today && actionKey !== "absent") {
      throw Object.assign(new Error("Future clock and worked-time entries are not permitted."), { status: 400 });
    }
    if (actionKey === "absent" || !dailyActions.has(actionKey)) return;
    const minutesFor = /* @__PURE__ */ __name((input) => {
      const match = /^(\d{2}):(\d{2})$/.exec(String(input || ""));
      if (!match) return null;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
    }, "minutesFor");
    const futureTime = /* @__PURE__ */ __name((minutes) => eventDate === today && minutes > nowMinutes, "futureTime");
    if (actionKey === "full_day") {
      const start = minutesFor(payload.dayStart);
      const finishValue = minutesFor(payload.dayFinish);
      const lunchStartValue = minutesFor(payload.lunchStart);
      const lunchEndValue = minutesFor(payload.lunchEnd);
      if (start === null || finishValue === null) {
        throw Object.assign(new Error("Enter valid start and finish times for the full day."), { status: 400 });
      }
      if (lunchStartValue === null !== (lunchEndValue === null)) {
        throw Object.assign(new Error("Enter both valid lunch times, or leave both blank."), { status: 400 });
      }
      const finish = finishValue <= start ? finishValue + 1440 : finishValue;
      if (lunchStartValue !== null && (lunchEndValue <= lunchStartValue || lunchStartValue < start || lunchEndValue > finish)) {
        throw Object.assign(new Error("Lunch must fall within the recorded working day."), { status: 400 });
      }
      if (futureTime(finish)) {
        throw Object.assign(new Error("Future clock times are not permitted."), { status: 400 });
      }
      return;
    }
    const eventMinutes = minutesFor(payload.time);
    if (eventMinutes === null) {
      throw Object.assign(new Error("Enter a valid clock time in 24-hour format."), { status: 400 });
    }
    if (futureTime(eventMinutes)) {
      throw Object.assign(new Error("Future clock times are not permitted."), { status: 400 });
    }
    return;
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.dailyRows) ? payload.dailyRows : [];
  for (const row of rows) {
    const date = String(row?.date || "").slice(0, 10);
    const absence = String(row?.absenceStatus || row?.absenceReason || row?.absence || "NA").trim().toLowerCase();
    if (date > today && !["sick", "holiday", "absent", "un-paid"].includes(absence)) {
      throw Object.assign(new Error("Future dates can only be marked absent, sick, holiday or Un-Paid; worked time cannot be entered early."), { status: 400 });
    }
  }
}
__name(validateNoFutureWork, "validateNoFutureWork");
var isCurrentMonthRecord = isCurrentPayMonthRecord;
function shouldDispatchNow(date = /* @__PURE__ */ new Date(), env = {}) {
  const settings = dispatchSettings(env);
  if (!settings.enabled) return false;
  const local = localTimeParts(date, settings.timeZone);
  return local.weekday === settings.weekday && local.hour === settings.hour;
}
__name(shouldDispatchNow, "shouldDispatchNow");
function canonicalKind(value2) {
  const normalized = text2(value2).toLowerCase().replace(/[_\s]+/g, "-");
  if (normalized === "clock-in" || normalized === "clock-out" || normalized === "clock-event" || normalized === "clock-record" || normalized === "lunch-start" || normalized === "lunch-end" || normalized === "absence" || normalized === "full-day") return "clock";
  if (normalized === "jobcard" || normalized === "job-card") return "job-cards";
  if (normalized === "estimate" || normalized === "quote") return "estimates";
  if (normalized === "calendar-request" || normalized === "calendar-event") return "calendar";
  if (normalized === "task" || normalized === "task-request") return "tasks";
  if (normalized === "enquiry" || normalized === "inquiry" || normalized === "customer-enquiry" || normalized === "customer-inquiry" || normalized === "contact") return "enquiries";
  if (normalized === "audit-submission") return "audit";
  if (normalized === "clock") return "clock";
  if (normalized === "timesheet" || normalized === "timesheets" || !normalized) return "timesheets";
  return normalized;
}
__name(canonicalKind, "canonicalKind");
function isoOrBlank(value2) {
  const candidate = text2(value2, "", 80);
  if (!candidate) return "";
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? candidate.slice(0, 80) : candidate;
}
__name(isoOrBlank, "isoOrBlank");
function safePayloadValue(value2, depth = 0) {
  if (depth > 4 || value2 === void 0) return void 0;
  if (value2 === null || typeof value2 === "boolean") return value2;
  if (typeof value2 === "number") return Number.isFinite(value2) ? value2 : 0;
  if (typeof value2 === "string") return text2(value2, "", 3e3);
  if (Array.isArray(value2)) return value2.slice(0, 80).map((item) => safePayloadValue(item, depth + 1)).filter((item) => item !== void 0);
  if (typeof value2 === "object") {
    const result = {};
    Object.keys(value2).slice(0, 100).forEach((key) => {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,80}$/.test(key) && !SAFE_PAYROLL_ROW_KEYS.has(key)) return;
      if (key === "__proto__" || key === "constructor" || key === "prototype") return;
      const safeValue = safePayloadValue(value2[key], depth + 1);
      if (safeValue !== void 0) result[key] = safeValue;
    });
    return result;
  }
  return void 0;
}
__name(safePayloadValue, "safePayloadValue");
function parsePayload(body) {
  const payload = body && typeof body.payload === "object" && !Array.isArray(body.payload) ? body.payload : body;
  const safe = {};
  const keys = ["schemaVersion", "employeeName", "employeeEmail", "employeeUpn", "testMode", "notificationEmail", "weekStart", "weekEnd", "cycleStart", "cycleEnd", "payrollFriday", "recordDate", "date", "time", "action", "actionLabel", "status", "absenceReason", "startTime", "finishTime", "lunchStart", "lunchEnd", "dayStart", "dayFinish", "workedHours", "basicHours", "ot15Hours", "ot20Hours", "weightedHours", "note", "location", "row", "hours", "number", "dateOfEstimate", "attention", "company", "email", "validity", "preparedBy", "vatRate", "reference", "opening", "terms", "items", "subtotal", "vat", "total", "jobReference", "client", "site", "engineer", "plannedDate", "description", "cardType", "jobStatus", "jobRevision", "previousRecordId", "invoiceNumber", "xeroReference", "xeroInvoiceId", "xeroInvoiceStatus", "xeroInvoiceUrl", "xeroInvoiceTotal", "xeroInvoiceAmountDue", "xeroInvoiceCurrency", "xeroLastSyncedAt", "jobEmailUrl", "jobEmailMessageId", "updateReason", "accountNotes", "title", "assignee", "due", "priority", "owner", "type", "notes", "rows", "dailyRows", "daily_rows", "gmtDailyRows", "totals", "weighted", "absenceRanges", "calendarSync", "calendarSyncPayload", "gmtCalendarSyncPayload", "enquiryId", "customerName", "customerEmail", "customerPhone", "requestType", "message", "conversationUrl", "conversationId", "threadId", "messages", "replyTo", "inboxStatus", "mailbox", "payMonth", "deletedDays", "editNote", "editedBy", "editedAt"];
  for (const key of keys) {
    if (payload[key] !== void 0) safe[key] = safePayloadValue(payload[key]);
  }
  return safe;
}
__name(parsePayload, "parsePayload");
function validatePortalRequestMutation(body, existing = null, identity = null) {
  const request = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const payload = request.payload && typeof request.payload === "object" && !Array.isArray(request.payload) ? request.payload : {};
  const kind = canonicalKind(request.kind || request.type || existing?.kind || "");
  const existingKind = existing ? canonicalKind(existing.kind) : "";
  const requestKind = ["calendar", "tasks"].includes(kind) || ["calendar", "tasks"].includes(existingKind);
  if (!requestKind) return;
  if (existing && existingKind !== kind) {
    throw Object.assign(new Error("A request cannot change category"), { status: 409 });
  }
  const action = text2(request.action || request.gmtAction || "", "", 100).toLowerCase();
  const expectedAction = existing ? "update_request" : "create_request";
  if (action !== expectedAction) {
    throw Object.assign(new Error("Portal request action is not permitted"), { status: 400 });
  }
  const hasRequestedStatus = Object.hasOwn(request, "status") || Object.hasOwn(payload, "status");
  const requestedStatus = text2(request.status ?? payload.status ?? "", "", 100).toLowerCase();
  if (hasRequestedStatus) {
    const cancellationAllowed = Boolean(existing) && kind === "calendar" && requestedStatus === "cancelled" && ["pending approval", "submitted", "saved"].includes(text2(existing.status, "", 100).toLowerCase()) && Boolean(identity?.oid) && identity.oid === existing.owner_oid;
    const allowed = requestedStatus === "pending approval" || cancellationAllowed;
    if (!allowed) throw Object.assign(new Error("Request status is controlled by Microsoft 365"), { status: 403 });
  }
  if (existing) {
    const currentStatus = text2(existing.status, "", 100).toLowerCase();
    if (!["pending approval", "submitted", "saved"].includes(currentStatus)) {
      throw Object.assign(new Error("Only pending requests can be edited or cancelled"), { status: 409 });
    }
  }
}
__name(validatePortalRequestMutation, "validatePortalRequestMutation");
function validatePortalRequestDeletion(existing) {
  if (["calendar", "tasks"].includes(canonicalKind(existing?.kind))) {
    throw Object.assign(new Error("Calendar and task requests cannot be deleted through the portal"), { status: 409 });
  }
}
__name(validatePortalRequestDeletion, "validatePortalRequestDeletion");
function normaliseUnpaidTimesheetPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const rowKeys = ["rows", "dailyRows", "daily_rows", "gmtDailyRows"];
  const summaryRowsKey = rowKeys.find((key) => Array.isArray(payload[key]));
  const reported = { worked: 0, basic: 0, ot15: 0, ot20: 0, weighted: 0, count: 0 };
  const numeric = /* @__PURE__ */ __name((row, keys) => {
    for (const key of keys) {
      const value2 = Number(row?.[key]);
      if (row?.[key] !== void 0 && row?.[key] !== null && row?.[key] !== "" && Number.isFinite(value2)) return value2;
    }
    return null;
  }, "numeric");
  const zeroRow = /* @__PURE__ */ __name((source, collectSummary) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) return source;
    const absence = String(source.absenceStatus || source.absence_status || source.absenceReason || source.absence_reason || source.absence || source["Absence reason"] || "").trim();
    if (!/^un-paid$/i.test(absence)) return source;
    const row = { ...source };
    const workedMinutes = numeric(source, ["workedActual", "workedMinutes", "worked_minutes", "totalMinutes", "total_minutes", "Total minutes", "Worked minutes"]);
    const workedHours = numeric(source, ["workedHours", "worked_hours", "hours", "totalHours", "total_hours", "Total hours", "Worked hours"]);
    if (row.reportedWorkedMinutes === void 0 && (workedMinutes !== null || workedHours !== null)) row.reportedWorkedMinutes = workedMinutes !== null ? workedMinutes : workedHours * 60;
    if (row.reportedWorkedHours === void 0 && (workedHours !== null || workedMinutes !== null)) row.reportedWorkedHours = workedHours !== null ? workedHours : workedMinutes / 60;
    const basicMinutes = numeric(source, ["appliedBasic", "applied_basic", "basic", "basicMinutes", "basic_minutes", "Basic minutes"]);
    const basicHours = numeric(source, ["basicHours", "basic_hours", "Basic hours"]);
    const ot15Minutes = numeric(source, ["appliedOt15", "applied_ot15", "ot15", "ot15Minutes", "ot15_minutes", "OT x1.5 minutes"]);
    const ot15Hours = numeric(source, ["ot15Hours", "ot15_hours", "overtime15Hours"]);
    const ot20Minutes = numeric(source, ["appliedOt20", "applied_ot20", "ot20", "ot20Minutes", "ot20_minutes", "OT x2.0 minutes"]);
    const ot20Hours = numeric(source, ["ot20Hours", "ot20_hours", "overtime20Hours"]);
    const rowWeighted = numeric(source, ["weightedHours", "weighted_hours", "Weighted hours"]);
    if (collectSummary) {
      reported.worked += workedMinutes !== null ? workedMinutes : workedHours !== null ? workedHours * 60 : 0;
      reported.basic += basicMinutes !== null ? basicMinutes : (basicHours || 0) * 60;
      reported.ot15 += ot15Minutes !== null ? ot15Minutes : (ot15Hours || 0) * 60;
      reported.ot20 += ot20Minutes !== null ? ot20Minutes : (ot20Hours || 0) * 60;
      reported.weighted += rowWeighted !== null ? rowWeighted : (basicHours !== null ? basicHours : (basicMinutes || 0) / 60) + 1.5 * (ot15Hours !== null ? ot15Hours : (ot15Minutes || 0) / 60) + 2 * (ot20Hours !== null ? ot20Hours : (ot20Minutes || 0) / 60);
      reported.count += 1;
    }
    if (row.reportedWorkedMinutes === void 0) row.reportedWorkedMinutes = row.reportedWorkedMinutes ?? (workedMinutes !== null ? workedMinutes : workedHours !== null ? workedHours * 60 : null);
    if (row.reportedWorkedHours === void 0) row.reportedWorkedHours = row.reportedWorkedHours ?? (workedHours !== null ? workedHours : workedMinutes !== null ? workedMinutes / 60 : null);
    Object.assign(row, {
      workedMinutes: 0,
      worked_minutes: 0,
      workedHours: 0,
      worked_hours: 0,
      workedActual: 0,
      total: 0,
      totalMinutes: 0,
      total_minutes: 0,
      totalHours: 0,
      total_hours: 0,
      basic: 0,
      basicMinutes: 0,
      basic_minutes: 0,
      basicHours: 0,
      basic_hours: 0,
      appliedBasic: 0,
      applied_basic: 0,
      ot15: 0,
      ot15Minutes: 0,
      ot15_minutes: 0,
      ot15Hours: 0,
      ot15_hours: 0,
      appliedOt15: 0,
      applied_ot15: 0,
      ot20: 0,
      ot20Minutes: 0,
      ot20_minutes: 0,
      ot20Hours: 0,
      ot20_hours: 0,
      appliedOt20: 0,
      applied_ot20: 0,
      appliedTotal: 0,
      weighted_hours: 0,
      weightedHours: 0,
      calculationSource: "unpaid absence"
    });
    ["worked_minutes", "worked_hours", "total_minutes", "total_hours", "basic_minutes", "basic_hours", "ot15_minutes", "ot15_hours", "ot20_minutes", "ot20_hours", "weighted_hours", "applied_basic", "applied_ot15", "applied_ot20", "totalMinutes", "Worked minutes", "Worked hours", "Total minutes", "Total hours", "Basic minutes", "Basic hours", "OT x1.5 minutes", "OT x1.5 hours", "OT x2.0 minutes", "OT x2.0 hours", "Weighted hours"].forEach((key) => {
      if (Object.hasOwn(source, key)) row[key] = 0;
    });
    return row;
  }, "zeroRow");
  rowKeys.forEach((key) => {
    if (Array.isArray(payload[key])) payload[key] = payload[key].map((row) => zeroRow(row, key === summaryRowsKey));
  });
  if (!reported.count) return payload;
  const subtract = /* @__PURE__ */ __name((object, key, amount) => {
    if (Object.hasOwn(object, key) && Number.isFinite(Number(object[key]))) object[key] = Math.max(0, Number(object[key]) - amount);
  }, "subtract");
  const subtractGroup = /* @__PURE__ */ __name((object, keys, amount) => keys.forEach((key) => subtract(object, key, amount)), "subtractGroup");
  if (payload.totals && typeof payload.totals === "object") {
    subtractGroup(payload.totals, ["workedActual", "total", "workedMinutes", "worked_minutes", "totalMinutes", "total_minutes"], reported.worked);
    subtractGroup(payload.totals, ["basic", "basicMinutes", "basic_minutes", "appliedBasic", "applied_basic"], reported.basic);
    subtractGroup(payload.totals, ["ot15", "ot15Minutes", "ot15_minutes", "appliedOt15", "applied_ot15"], reported.ot15);
    subtractGroup(payload.totals, ["ot20", "ot20Minutes", "ot20_minutes", "appliedOt20", "applied_ot20"], reported.ot20);
    subtractGroup(payload.totals, ["workedHours", "worked_hours", "totalHours", "total_hours", "Worked hours", "Total hours"], reported.worked / 60);
    subtractGroup(payload.totals, ["basicHours", "basic_hours", "Basic hours"], reported.basic / 60);
    subtractGroup(payload.totals, ["ot15Hours", "ot15_hours", "OT x1.5 hours"], reported.ot15 / 60);
    subtractGroup(payload.totals, ["ot20Hours", "ot20_hours", "OT x2.0 hours"], reported.ot20 / 60);
    subtract(payload.totals, "weightedHours", reported.weighted);
    subtract(payload.totals, "weighted_hours", reported.weighted);
    payload.totals.absent = Math.max(Number(payload.totals.absent) || 0, reported.count);
    payload.totals.unpaid = Math.max(Number(payload.totals.unpaid) || 0, reported.count);
  }
  if (Object.hasOwn(payload, "weightedHours") && Number.isFinite(Number(payload.weightedHours))) payload.weightedHours = Math.max(0, Number(payload.weightedHours) - reported.weighted);
  [["workedHours", "worked_hours"], ["basicHours", "basic_hours"], ["ot15Hours", "ot15_hours"], ["ot20Hours", "ot20_hours"]].forEach((keys, index) => keys.forEach((key) => subtract(payload, key, [reported.worked, reported.basic, reported.ot15, reported.ot20][index] / 60)));
  const events = payload.calendarSync && Array.isArray(payload.calendarSync.events) ? payload.calendarSync.events : [];
  events.forEach((event) => {
    if (!event || typeof event !== "object" || !/timesheet/i.test(String(event.type || event.title || ""))) return;
    subtract(event, "workedHours", reported.worked / 60);
    subtract(event, "basicHours", reported.basic / 60);
    subtract(event, "ot15Hours", reported.ot15 / 60);
    subtract(event, "ot20Hours", reported.ot20 / 60);
  });
  return payload;
}
__name(normaliseUnpaidTimesheetPayload, "normaliseUnpaidTimesheetPayload");
function normaliseInput(body, identity, existing = null, env = null, payPeriods2 = defaultPayPeriods()) {
  const payload = parsePayload(body);
  const kind = canonicalKind(body.kind || body.type || payload.kind || existing?.kind);
  if (!ALLOWED_KINDS.has(kind)) throw Object.assign(new Error("Record category is not supported"), { status: 400 });
  const recordId = text2(body.recordId || body.sourceRecordId || body.source_record_id || body.gmt_record_id, "", MAX_RECORD_ID2);
  if (!recordId) throw Object.assign(new Error("A stable record ID is required"), { status: 400 });
  if (!/^[A-Za-z0-9][A-Za-z0-9._|:/-]*$/.test(recordId)) throw Object.assign(new Error("Record ID contains unsupported characters"), { status: 400 });
  const submittedAt = isoOrBlank(body.submittedAt || body.submitted_at || payload.submittedAt) || existing && existing.submitted_at || now();
  const updatedAt = isoOrBlank(body.updatedAt || body.updated_at || payload.updatedAt) || now();
  const requestedEmployeeName = text2(body.employeeName || body.employee_name || payload.employeeName, "", 240);
  const requestedTestMode = body.testMode === true || payload.testMode === true || /^(true|1|yes)$/i.test(String(body.testMode || payload.testMode || "").trim());
  const syntheticTestName = /^TEST(?:[\s_-]|$)/i.test(requestedEmployeeName);
  const action = text2(body.action || body.gmtAction || payload.action || (kind === "clock" ? "clock_event" : "submission"), "submission", 100);
  validateNoFutureWork(kind, action, payload);
  if (kind === "timesheets") normaliseUnpaidTimesheetPayload(payload);
  if (kind === "timesheets" && action !== "pay_month_correction") {
    const computedPayMonth = payMonthForPayload(payload, payload.weekStart || body.weekStart || body.startDate || body.start_date, payPeriods2);
    if (computedPayMonth) payload.payMonth = computedPayMonth;
  }
  const correctionOnBehalf = kind === "timesheets" && action === "pay_month_correction" && body.editMode === true && (identity.isAdmin || identity.isSubmissionAdmin) && !existing;
  const requestedUpn = text2(body.employeeEmail || body.employee_upn, "", 320).toLowerCase();
  const rosterTarget = correctionOnBehalf ? directoryEntryFor(staffDirectory(env || {}), requestedEmployeeName, requestedUpn) : null;
  const historicalTarget = correctionOnBehalf && !rosterTarget && requestedEmployeeName && /@(gmt-services\.co\.uk|gmtelectservsltd\.onmicrosoft\.com)$/i.test(requestedUpn) ? { name: requestedEmployeeName, upn: requestedUpn } : null;
  const target = rosterTarget || historicalTarget;
  if (correctionOnBehalf && (!target || !target.upn)) throw Object.assign(new Error("Employee must have a verified GMT address or match the approved staff roster"), { status: 400 });
  const employeeName = existing?.action === "pay_month_correction" && existing?.employee_name ? existing.employee_name : syntheticTestName ? requestedEmployeeName : target?.name || identity.name || requestedEmployeeName || identity.upn;
  const status = text2(body.status || payload.status || existing?.status || (kind === "calendar" || kind === "tasks" ? "Pending approval" : "Submitted"), "Submitted", 100);
  const startDate = isoOrBlank(body.startDate || body.start_date || payload.weekStart || body.weekStart);
  const endDate = isoOrBlank(body.endDate || body.end_date || payload.weekEnd || body.weekEnd);
  const recordDate = isoOrBlank(body.recordDate || body.record_date || payload.recordDate || payload.date || body.date);
  const privilegedEdit = Boolean(existing && (identity.isAdmin || identity.isSubmissionAdmin || identity.isOperationsAdmin && existing.kind !== "timesheets" && existing.kind !== "clock" || existing.kind === "job-cards" && identity.isJobCardAdmin));
  return {
    recordId,
    ownerOid: privilegedEdit || existing?.action === "pay_month_correction" ? existing.owner_oid : identity.oid,
    ownerUpn: privilegedEdit || existing?.action === "pay_month_correction" ? existing.owner_upn : target?.upn || identity.upn,
    employeeName,
    kind,
    action,
    status,
    startDate,
    endDate,
    recordDate,
    submittedAt,
    updatedAt,
    issue: text2(body.issue || payload.issue, "", 1e3),
    payloadJson: JSON.stringify(payload)
  };
}
__name(normaliseInput, "normaliseInput");
function payloadObject(row) {
  try {
    const parsed = JSON.parse(row.payload_json || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}
__name(payloadObject, "payloadObject");
function estimateIndexStore(env) {
  if (!env.DB) throw Object.assign(new Error("Protected storage is not configured"), { status: 503 });
  return createEstimateIndexStore(env.DB);
}
__name(estimateIndexStore, "estimateIndexStore");
async function upsertEstimateIndex(env, identity, input) {
  requireXeroAdmin(identity);
  return estimateIndexStore(env).upsert(input);
}
__name(upsertEstimateIndex, "upsertEstimateIndex");
async function listEstimateIndex(env, identity, query = {}) {
  if (!identity) throw Object.assign(new Error("Authentication required"), { status: 401 });
  return estimateIndexStore(env).list(query.limit || 500);
}
__name(listEstimateIndex, "listEstimateIndex");
async function estimateIndexUpsertEndpoint(request, env, identity, origin) {
  const body = await readJson(request);
  const row = await upsertEstimateIndex(env, identity, body);
  return json({ ok: true, estimate: row }, 200, origin || "");
}
__name(estimateIndexUpsertEndpoint, "estimateIndexUpsertEndpoint");
async function estimateIndexListEndpoint(request, env, identity, origin) {
  const url = new URL(request.url);
  const estimates = await listEstimateIndex(env, identity, { limit: url.searchParams.get("limit") || 500 });
  const projected = await Promise.all(estimates.map(async (estimate) => {
    const sourceRecordId = estimate.source === "email" ? await emailEstimatePortalRecordId(estimate.canonical_id) : estimate.canonical_id;
    const { sharepoint_url: _sharepointUrl, attachment_url: _attachmentUrl, ...safe } = estimate;
    return { ...safe, source_record_id: sourceRecordId };
  }));
  return json({ estimates: projected }, 200, origin || "");
}
__name(estimateIndexListEndpoint, "estimateIndexListEndpoint");
async function emailEstimatePortalRecordId(canonicalId) {
  const key = text2(canonicalId, "", 2e3);
  if (!key) throw new Error("Archived estimate identity is missing");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)));
  const suffix = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `email-estimate:${suffix}`;
}
__name(emailEstimatePortalRecordId, "emailEstimatePortalRecordId");
async function upsertEmailEstimatePortalRecord(env, archive, input) {
  if (!archive?.canonical_id) throw Object.assign(new Error("Archived estimate identity is missing"), { status: 500 });
  const recordId = await emailEstimatePortalRecordId(archive.canonical_id);
  const sentAt = text2(input.sent_at || input.sentAt || input.received_at || input.receivedAt, "", 80);
  const date = sentAt.slice(0, 10);
  const number = text2(input.estimate_number || input.estimateNumber, "", 160);
  const company = text2(input.client || input.customer || input.company, "", 500);
  const customerEmail = text2(input.client_email || input.customer_email || input.customerEmail, "", 320).toLowerCase();
  const payload = {
    number,
    estimateNumber: number,
    date,
    company,
    clientCompany: company,
    email: customerEmail,
    clientEmail: customerEmail,
    attention: text2(input.attention, "", 240),
    reference: text2(input.reference, "", 300),
    subject: text2(input.subject, "", 500),
    archiveMessageId: archive.id,
    archiveSource: "email"
  };
  const timestamp = now();
  const existing = await env.DB.prepare("SELECT record_id FROM records WHERE record_id = ?").bind(recordId).first();
  const result = await env.DB.prepare(`INSERT INTO records
    (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date,
     record_date, submitted_at, updated_at, issue, payload_json, source_message_key)
    VALUES (?, 'shared-estimate-archive', ?, 'GMT Estimate Archive', 'estimates', 'email_archive', 'Submitted', ?, ?, ?, ?, ?, '', ?, ?)
    ON CONFLICT(record_id) DO UPDATE SET owner_upn=excluded.owner_upn, employee_name=excluded.employee_name,
      status=excluded.status, record_date=excluded.record_date, submitted_at=excluded.submitted_at,
      updated_at=excluded.updated_at, payload_json=excluded.payload_json, source_message_key=excluded.source_message_key`).bind(
    recordId,
    text2(input.mailbox, "", 320).toLowerCase(),
    date || null,
    date || null,
    date || null,
    sentAt || timestamp,
    timestamp,
    JSON.stringify(payload),
    archive.canonical_id
  ).run();
  await upsertEstimateAssociation(env, archive.id, {
    target_kind: "estimate",
    target_id: recordId,
    target_reference: number,
    relationship: "represents-estimate",
    confidence: 1,
    state: "confirmed",
    provenance_kind: "app-link",
    evidence: { field: "portal_record.archiveMessageId", record_id: recordId }
  });
  return { record_id: recordId, created: !existing, updated: Boolean(existing && result?.success !== false) };
}
__name(upsertEmailEstimatePortalRecord, "upsertEmailEstimatePortalRecord");
async function estimateArchiveIngestEndpoint(request, env, origin) {
  const configuredKey = text2(env.ESTIMATE_MAIL_INGEST_KEY, "", 1e3);
  if (!configuredKey) throw Object.assign(new Error("Estimate archive ingestion is not configured"), { status: 503 });
  const suppliedKey = request.headers.get("X-GMT-Archive-Key") || "";
  if (!constantTimeEqual(suppliedKey, configuredKey)) throw Object.assign(new Error("Estimate archive key is invalid"), { status: 401 });
  const body = await readJson(request);
  const mailbox = text2(body.mailbox || body.source_mailbox, "", 320).toLowerCase();
  const allowedMailboxes = /* @__PURE__ */ new Set(["info@gmt-services.co.uk", "accounts@gmt-services.co.uk"]);
  if (!allowedMailboxes.has(mailbox)) throw Object.assign(new Error("Estimate mail archive is restricted to approved GMT mailboxes"), { status: 403 });
  const outlookMessageId = text2(body.outlook_message_id || body.outlookMessageId, "", 2e3);
  if (!outlookMessageId) throw Object.assign(new Error("outlook_message_id is required"), { status: 400 });
  const internetMessageId = text2(body.internet_message_id || body.internetMessageId, "", 1e3);
  const canonicalId = internetMessageId ? `email:${internetMessageId}` : `email:${mailbox}:${outlookMessageId}`;
  const emlItemId = text2(body.sharepoint_eml_item_id || body.sharepointEmlItemId, "", 500);
  if (!emlItemId) throw Object.assign(new Error("sharepoint_eml_item_id is required before an email can be indexed"), { status: 400 });
  const attachmentRows = Array.isArray(body.attachments) ? body.attachments : [];
  if (attachmentRows.length > 50) throw Object.assign(new Error("Estimate archive contains too many attachments"), { status: 413 });
  let totalAttachmentBytes = 0;
  const attachments = attachmentRows.map((attachment) => {
    const sourceAttachmentId = text2(attachment?.source_attachment_id || attachment?.sourceAttachmentId || attachment?.id, "", 1e3);
    const itemId = text2(attachment?.sharepoint_item_id || attachment?.sharepointItemId, "", 500);
    const fileName = archiveFilename(attachment?.file_name || attachment?.fileName);
    const sizeBytes = Math.max(0, Number.parseInt(attachment?.size_bytes || attachment?.sizeBytes, 10) || 0);
    if (!sourceAttachmentId || !itemId) throw Object.assign(new Error("Each archived attachment requires source and SharePoint identifiers"), { status: 400 });
    totalAttachmentBytes += sizeBytes;
    if (sizeBytes > 20 * 1024 * 1024 || totalAttachmentBytes > 100 * 1024 * 1024) throw Object.assign(new Error("Estimate archive attachments exceed the supported size"), { status: 413 });
    return { sourceAttachmentId, itemId, fileName, sizeBytes, mimeType: text2(attachment?.mime_type || attachment?.mimeType, "application/octet-stream", 120), sha256: text2(attachment?.sha256, "", 128) };
  });
  const associationRows = Array.isArray(body.associations) ? body.associations : [];
  if (associationRows.length > 100) throw Object.assign(new Error("Estimate archive contains too many associations"), { status: 413 });
  for (const association of associationRows) {
    if (!association || typeof association !== "object" || Array.isArray(association)) throw Object.assign(new Error("association is invalid"), { status: 400 });
    const targetKind = text2(association.target_kind || association.targetKind, "", 32);
    const targetId = text2(association.target_id || association.targetId, "", 300);
    const confidence = Number(association.confidence);
    const provenanceKind = text2(association.provenance_kind || association.provenanceKind, "", 40);
    const state = text2(association.state, "candidate", 24);
    if (!["estimate", "job-card", "invoice"].includes(targetKind) || !targetId || !["candidate", "confirmed", "needs-review", "rejected"].includes(state) || !["exact-reference", "conversation-id", "shared-customer-date", "manual-review", "app-link"].includes(provenanceKind) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw Object.assign(new Error("association is invalid"), { status: 400 });
    }
  }
  const archiveInput = normalizeEstimateArchiveRecord({
    ...body,
    id: void 0,
    canonical_id: canonicalId,
    source_kind: "email",
    source_message_id: outlookMessageId,
    internet_message_id: internetMessageId,
    mailbox,
    classification_state: body.classification_state || body.classificationState || "candidate",
    sender_email: body.sender_email || body.senderEmail || mailbox,
    recipient_emails: body.recipient_emails || body.recipientEmails || [],
    customer: body.client || body.customer || "",
    estimate_number: body.estimate_number || body.estimateNumber || "",
    sharepoint_eml_item_id: emlItemId,
    sharepoint_manifest_item_id: body.sharepoint_manifest_item_id || body.sharepointManifestItemId || "",
    provenance: body.provenance || { source: "power-automate-estimate-index", mailbox, source_message_id: outlookMessageId }
  });
  const estimate = await estimateIndexStore(env).upsert({
    ...body,
    canonical_id: canonicalId,
    mailbox,
    internet_message_id: internetMessageId,
    mailbox_message_id: outlookMessageId,
    // Message IDs are mailbox-local. Keep source IDs in estimate_mail_sources,
    // where they are uniquely scoped to their mailbox.
    outlook_message_id: "",
    sharepoint_url: "",
    attachment_url: "",
    source: "email"
  });
  const archive = await upsertEstimateArchive(env, { ...archiveInput, provenance: JSON.parse(archiveInput.provenance_json) });
  const savedAssociations = await deriveArchiveAssociations(env, archive.id, {
    estimateNumber: archiveInput.estimate_number,
    reference: archiveInput.reference,
    invoiceNumber: text2(body.invoice_number || body.invoiceNumber, "", 500)
  });
  for (const association of associationRows) savedAssociations.push(await upsertEstimateAssociation(env, archive.id, association));
  for (const attachment of attachments) {
    await env.DB.prepare(`INSERT INTO archive_attachments
      (id, message_id, source_attachment_id, file_name, mime_type, size_bytes, sha256, sharepoint_item_id, provenance_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id, source_attachment_id) DO UPDATE SET
        file_name=excluded.file_name, mime_type=excluded.mime_type, size_bytes=excluded.size_bytes,
        sha256=excluded.sha256, sharepoint_item_id=excluded.sharepoint_item_id, provenance_json=excluded.provenance_json`).bind(
      crypto.randomUUID(),
      archive.id,
      attachment.sourceAttachmentId,
      attachment.fileName,
      attachment.mimeType,
      attachment.sizeBytes,
      attachment.sha256,
      attachment.itemId,
      JSON.stringify({ source: "power-automate-estimate-index", mailbox })
    ).run();
  }
  const portalRecord = body.portal_record === true && archiveInput.classification_state === "confirmed" ? await upsertEmailEstimatePortalRecord(env, { ...archive, canonical_id: canonicalId }, { ...body, mailbox }) : null;
  return json({ ok: true, estimate, archive, portal_record: portalRecord, associations: publicArchiveAssociations(savedAssociations) }, 200, origin || "");
}
__name(estimateArchiveIngestEndpoint, "estimateArchiveIngestEndpoint");
async function sendClientEstimateEndpoint(request, env, identity, origin) {
  if (!identity?.isAdmin) throw Object.assign(new Error("Client estimate delivery is restricted to portal administrators"), { status: 403 });
  const flowToken = await authenticateFlowToken(request, env, identity);
  const flowUrl = text2(env.ESTIMATE_SEND_FLOW_URL, "", 3e3);
  if (!flowUrl) throw Object.assign(new Error("The approved Accounts estimate-send flow is not configured"), { status: 503 });
  let parsedUrl;
  try {
    parsedUrl = new URL(flowUrl);
  } catch (_) {
    throw Object.assign(new Error("The approved Accounts estimate-send flow is not configured"), { status: 503 });
  }
  if (parsedUrl.protocol !== "https:" || !/(?:\.environment\.api\.powerplatform\.com|\.logic\.azure\.com)$/i.test(parsedUrl.hostname)) {
    throw Object.assign(new Error("The approved Accounts estimate-send flow has an invalid destination"), { status: 503 });
  }
  const body = await readJson(request);
  const recordId = text2(body.recordId || body.record_id, "", MAX_RECORD_ID2);
  const recipient = text2(body.to || body.recipient, "", 320).toLowerCase();
  if (!recordId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw Object.assign(new Error("Estimate record and client email are required"), { status: 400 });
  const existing = await env.DB.prepare("SELECT * FROM records WHERE record_id = ?").bind(recordId).first();
  if (!existing || existing.kind !== "estimates" || existing.owner_oid !== identity.oid) throw Object.assign(new Error("Estimate record not found"), { status: 404 });
  const currentStatus = String(existing.status || "").toLowerCase();
  if (["sent to client", "sending to client", "delivery status needs review"].includes(currentStatus)) throw Object.assign(new Error("This estimate is already sending, sent, or awaiting Accounts review"), { status: 409 });
  const archive = await env.DB.prepare(`SELECT id FROM archive_messages WHERE source_kind='app'
    AND json_extract(provenance_json, '$.source_record_id') = ? LIMIT 1`).bind(recordId).first();
  if (!archive) throw Object.assign(new Error("Archive the estimate in the shared folder before sending"), { status: 409 });
  const estimate = body.estimate && typeof body.estimate === "object" && !Array.isArray(body.estimate) ? body.estimate : {};
  const contentBase64 = String(body.contentBase64 || body.content_base64 || "");
  if (!contentBase64 || contentBase64.length > 145e4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contentBase64)) throw Object.assign(new Error("Estimate attachment is missing or too large"), { status: 400 });
  const fileName = archiveFilename(body.fileName || body.file_name || `${estimate.number || "GMT-estimate"}.doc`);
  const contentType = text2(body.contentType || body.content_type, "application/msword", 120).replace(/[\r\n;]/g, "");
  const submittedAt = now();
  const sendPayload = {
    idempotencyKey: recordId,
    recordId,
    to: recipient,
    bcc: "accounts@gmt-services.co.uk",
    subject: `[GMT] Estimate ${text2(estimate.number, "", 160)} | ${text2(estimate.company, "", 500)}`,
    message: `Please find attached estimate ${text2(estimate.number, "", 160)}.`,
    number: text2(estimate.number, "", 160),
    date: text2(estimate.date, "", 80),
    company: text2(estimate.company, "", 500),
    attention: text2(estimate.attention, "", 500),
    reference: text2(estimate.reference, "", 500),
    total: Number(estimate.total) || 0,
    fileName,
    contentType,
    contentBase64,
    requestedAt: submittedAt
  };
  await env.DB.prepare(`INSERT INTO record_versions (record_id, owner_oid, payload_json, changed_at, changed_by_oid)
    VALUES (?, ?, ?, ?, ?)`).bind(existing.record_id, existing.owner_oid, JSON.stringify({
    employee_name: existing.employee_name,
    kind: existing.kind,
    action: existing.action,
    status: existing.status,
    start_date: existing.start_date,
    end_date: existing.end_date,
    record_date: existing.record_date,
    submitted_at: existing.submitted_at,
    updated_at: existing.updated_at,
    issue: existing.issue,
    payload: payloadObject(existing)
  }), submittedAt, identity.oid).run();
  const claim = await env.DB.prepare(`UPDATE records SET status='Sending to client', issue='', updated_at=?
    WHERE record_id=? AND owner_oid=? AND lower(status) NOT IN ('sent to client','sending to client','delivery status needs review')`).bind(submittedAt, recordId, identity.oid).run();
  if (!(claim.meta?.changes > 0)) throw Object.assign(new Error("This estimate is already sending, sent, or awaiting Accounts review"), { status: 409 });
  let response;
  try {
    response = await fetch(flowUrl, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(9e4),
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${flowToken}` },
      body: JSON.stringify(sendPayload)
    });
  } catch (_) {
    await env.DB.prepare(`UPDATE records SET status='Delivery status needs review', issue=?, updated_at=? WHERE record_id=? AND owner_oid=?`).bind("The Accounts send flow did not return a delivery result; check its run history before retrying.", now(), recordId, identity.oid).run();
    throw Object.assign(new Error("The Accounts send flow did not return a delivery result. Check its run history before retrying."), { status: 502 });
  }
  if (response.status >= 300 && response.status < 400) {
    await env.DB.prepare(`UPDATE records SET status='Delivery status needs review', issue=?, updated_at=? WHERE record_id=? AND owner_oid=?`).bind("The Accounts send flow returned an unexpected redirect; verify delivery in run history.", now(), recordId, identity.oid).run();
    throw Object.assign(new Error("The Accounts send flow returned an unexpected redirect. Check its run history before retrying."), { status: 502 });
  }
  const responseText = await response.text();
  let result = null;
  try {
    result = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
  }
  if (!response.ok || result?.success !== true) {
    const message = text2(result?.message, "The Accounts send flow did not confirm delivery. Check its run history before retrying.", 500);
    await env.DB.prepare(`UPDATE records SET status='Delivery status needs review', issue=?, updated_at=? WHERE record_id=? AND owner_oid=?`).bind(message, now(), recordId, identity.oid).run();
    throw Object.assign(new Error(message), { status: 502 });
  }
  const sentAt = text2(result.sentAt || result.sent_at, now(), 80);
  const claimedRecord = await env.DB.prepare("SELECT * FROM records WHERE record_id = ?").bind(recordId).first();
  const next = normaliseInput({
    recordId,
    kind: "estimates",
    action: claimedRecord.action || "client_send",
    status: "Sent to client",
    issue: "",
    submittedAt: existing.submitted_at,
    updatedAt: sentAt,
    recordDate: existing.record_date,
    payload: payloadObject(claimedRecord)
  }, identity, claimedRecord, env);
  await saveRecord(env, next, identity, claimedRecord);
  try {
    await estimateIndexStore(env).upsert({
      canonical_id: recordId,
      estimate_number: text2(estimate.number, "", 500),
      client: text2(estimate.company, "", 1e3),
      client_email: recipient,
      reference: text2(estimate.reference, "", 500),
      estimate_date: text2(estimate.date, "", 80),
      source: "app",
      correlation_status: "ready"
    });
  } catch (_) {
  }
  return json({ ok: true, status: "Sent to client", sent_at: sentAt, archive_id: archive.id }, 200, origin || "");
}
__name(sendClientEstimateEndpoint, "sendClientEstimateEndpoint");
function correlationToken(value2) {
  return text2(value2, "", 500).trim().toLocaleLowerCase().replace(/\s+/g, " ");
}
__name(correlationToken, "correlationToken");
function publicArchiveAssociations(associations) {
  return associations.map((association) => association.target_kind === "invoice" ? (({ target_id: _privateTargetId, ...safe }) => safe)(association) : association);
}
__name(publicArchiveAssociations, "publicArchiveAssociations");
async function deriveArchiveAssociations(env, archiveId, { estimateNumber = "", reference = "", invoiceNumber = "", sourceRecordId = "" } = {}) {
  const parsedById = /* @__PURE__ */ new Map();
  const loadExact = /* @__PURE__ */ __name(async (kind, value2, fields) => {
    const token = correlationToken(value2);
    if (!token) return [];
    const jsonMatches = fields.map((field) => `lower(trim(CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.${field}'), '') ELSE '' END)) = ?`);
    const sql = `SELECT record_id, kind, record_date, payload_json FROM records
      WHERE kind = ? AND status <> 'Deleted' AND (lower(trim(record_id)) = ? OR ${jsonMatches.join(" OR ")})`;
    const result = await env.DB.prepare(sql).bind(kind, token, ...fields.map(() => token)).all();
    return result.results || [];
  }, "loadExact");
  try {
    if (sourceRecordId) {
      const source = await env.DB.prepare(`SELECT record_id, kind, record_date, payload_json FROM records
        WHERE record_id = ? AND kind = 'estimates' AND status <> 'Deleted'`).bind(sourceRecordId).first();
      if (source) parsedById.set(source.record_id, source);
    }
    for (const row of await loadExact("job-cards", reference, ["jobReference", "job_reference", "reference"])) parsedById.set(row.record_id, row);
    for (const row of await loadExact("estimates", estimateNumber, ["estimateNumber", "number"])) parsedById.set(row.record_id, row);
    for (const row of await loadExact("job-cards", invoiceNumber, ["invoiceNumber", "xeroInvoiceNumber", "xeroReference"])) parsedById.set(row.record_id, row);
  } catch (_) {
    return [];
  }
  const parsed = [...parsedById.values()].map((row) => {
    let payload = {};
    try {
      payload = JSON.parse(row.payload_json || "{}");
    } catch (_) {
    }
    return { ...row, payload };
  });
  const saved = [];
  if (sourceRecordId) {
    const source = parsed.find((row) => row.record_id === sourceRecordId && row.kind === "estimates");
    if (source) saved.push(await upsertEstimateAssociation(env, archiveId, {
      target_kind: "estimate",
      target_id: source.record_id,
      target_reference: text2(source.payload.estimateNumber || source.payload.number || estimateNumber, "", 500),
      relationship: "created-from",
      confidence: 1,
      state: "confirmed",
      provenance_kind: "app-link",
      evidence: { field: "source_record_id", record_id: source.record_id }
    }));
  }
  const exactReference = correlationToken(reference);
  if (exactReference) {
    const matches = parsed.filter((row) => row.kind === "job-cards" && [row.record_id, row.payload.jobReference, row.payload.job_reference, row.payload.reference].some((value2) => correlationToken(value2) === exactReference));
    for (const row of matches) saved.push(await upsertEstimateAssociation(env, archiveId, {
      target_kind: "job-card",
      target_id: row.record_id,
      target_reference: text2(row.payload.jobReference || row.payload.reference || row.record_id, "", 500),
      relationship: "supports",
      confidence: matches.length === 1 ? 1 : 0.5,
      state: matches.length === 1 ? "confirmed" : "needs-review",
      provenance_kind: "exact-reference",
      evidence: { field: "reference", value: text2(reference, "", 500) }
    }));
  }
  const estimateToken = correlationToken(estimateNumber);
  if (estimateToken) {
    const matches = parsed.filter((row) => row.kind === "estimates" && [row.record_id, row.payload.estimateNumber, row.payload.number].some((value2) => correlationToken(value2) === estimateToken));
    for (const row of matches) saved.push(await upsertEstimateAssociation(env, archiveId, {
      target_kind: "estimate",
      target_id: row.record_id,
      target_reference: text2(row.payload.estimateNumber || row.payload.number || row.record_id, "", 500),
      relationship: "same-estimate",
      confidence: matches.length === 1 ? 1 : 0.5,
      state: matches.length === 1 ? "confirmed" : "needs-review",
      provenance_kind: "exact-reference",
      evidence: { field: "estimate_number", value: text2(estimateNumber, "", 500) }
    }));
  }
  const invoiceToken = correlationToken(invoiceNumber);
  if (invoiceToken) {
    const matches = parsed.filter((row) => row.kind === "job-cards" && row.payload.xeroInvoiceId && [row.payload.invoiceNumber, row.payload.xeroInvoiceNumber, row.payload.xeroReference].some((value2) => correlationToken(value2) === invoiceToken));
    for (const row of matches) saved.push(await upsertEstimateAssociation(env, archiveId, {
      target_kind: "invoice",
      target_id: text2(row.payload.xeroInvoiceId, "", 300),
      target_reference: text2(row.payload.invoiceNumber || row.payload.xeroInvoiceNumber || row.payload.xeroReference, "", 500),
      relationship: "billed-as",
      confidence: matches.length === 1 ? 1 : 0.5,
      state: matches.length === 1 ? "confirmed" : "needs-review",
      provenance_kind: "exact-reference",
      evidence: { field: "invoice_number", value: text2(invoiceNumber, "", 500) }
    }));
  }
  return saved;
}
__name(deriveArchiveAssociations, "deriveArchiveAssociations");
function archiveFilename(value2) {
  return text2(value2, "estimate-file", 180).replace(/[\\/\r\n"<>:|?*\u0000-\u001f]/g, "_").replace(/^\.+$/, "file") || "estimate-file";
}
__name(archiveFilename, "archiveFilename");
async function sharePointGraphToken(env) {
  const tenant = text2(env.ENTRA_TENANT_ID, "", 120);
  const clientId = text2(env.SHAREPOINT_GRAPH_CLIENT_ID, "", 120);
  const clientSecret = text2(env.SHAREPOINT_GRAPH_CLIENT_SECRET, "", 4e3);
  if (!tenant || !clientId || !clientSecret || !text2(env.SHAREPOINT_SITE_ID) || !text2(env.SHAREPOINT_DRIVE_ID)) {
    throw Object.assign(new Error("Shared archive content access is not configured"), { status: 503 });
  }
  const cacheKey = `${tenant}:${clientId}`;
  const cached = SHAREPOINT_TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 6e4) return cached.token;
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "https://graph.microsoft.com/.default" })
  });
  if (!response.ok) throw Object.assign(new Error("Shared archive content authentication failed"), { status: 503 });
  const token = await response.json();
  if (!token.access_token) throw Object.assign(new Error("Shared archive content authentication failed"), { status: 503 });
  const lifetime = Math.max(120, Number(token.expires_in) || 3600);
  SHAREPOINT_TOKEN_CACHE.set(cacheKey, { token: token.access_token, expiresAt: Date.now() + lifetime * 1e3 });
  return token.access_token;
}
__name(sharePointGraphToken, "sharePointGraphToken");
async function graphSharePointRequest(env, path, init = {}) {
  const token = await sharePointGraphToken(env);
  const response = await fetch(`https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(text2(env.SHAREPOINT_SITE_ID, "", 500))}/drives/${encodeURIComponent(text2(env.SHAREPOINT_DRIVE_ID, "", 500))}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...init.headers || {} }
  });
  return response;
}
__name(graphSharePointRequest, "graphSharePointRequest");
function requireJobCardArchiveAdmin(identity) {
  if (!identity?.isAdmin && !identity?.isJobCardAdmin) throw Object.assign(new Error("Scanned job-card archive changes are restricted to Accounts"), { status: 403 });
}
__name(requireJobCardArchiveAdmin, "requireJobCardArchiveAdmin");
function encodeDrivePath(path) {
  return String(path).split("/").map((part) => encodeURIComponent(part)).join("/");
}
__name(encodeDrivePath, "encodeDrivePath");
async function ensureSharePointFolder(env, folderPath) {
  const siteId = text2(env.SHAREPOINT_SITE_ID, "", 500);
  const driveId = text2(env.SHAREPOINT_DRIVE_ID, "", 500);
  let current = "";
  for (const segment of String(folderPath).split("/").filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    const cacheKey = `${siteId}:${driveId}:${current}`;
    if (SHAREPOINT_FOLDER_CACHE.has(cacheKey)) continue;
    const path = `/root:/${encodeDrivePath(current)}`;
    let response = await graphSharePointRequest(env, path);
    if (response.status === 404) {
      const parent = current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : "";
      const childrenPath = parent ? `/root:/${encodeDrivePath(parent)}:/children` : "/root/children";
      response = await graphSharePointRequest(env, childrenPath, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ name: segment, folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
      });
      if (response.status === 409) response = await graphSharePointRequest(env, path);
    }
    if (!response.ok) throw Object.assign(new Error("SharePoint job-card archive folders could not be prepared"), { status: 503 });
    let item;
    try {
      item = await response.json();
    } catch (_) {
      item = null;
    }
    if (!item?.id || !item.folder) throw Object.assign(new Error("SharePoint job-card archive folder could not be verified"), { status: 503 });
    SHAREPOINT_FOLDER_CACHE.add(cacheKey);
  }
}
__name(ensureSharePointFolder, "ensureSharePointFolder");
function jobCardSessionId(value2) {
  const id = text2(value2, "", 80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Object.assign(new Error("Job-card upload session was not found"), { status: 404 });
  return id;
}
__name(jobCardSessionId, "jobCardSessionId");
async function jobCardBatchStartEndpoint(request, env, identity, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const result = await startJobCardBatch(env, body, identity);
  await ensureSharePointFolder(env, `JobCards/Source Batches/${result.batchId}`);
  await ensureSharePointFolder(env, "JobCards/Records");
  return json({ ok: true, ...result }, result.duplicate ? 200 : 201, origin || "");
}
__name(jobCardBatchStartEndpoint, "jobCardBatchStartEndpoint");
async function jobCardBatchStatusEndpoint(env, identity, batchId, origin) {
  requireJobCardArchiveAdmin(identity);
  return json(await jobCardBatchStatus(env, batchId), 200, origin || "");
}
__name(jobCardBatchStatusEndpoint, "jobCardBatchStatusEndpoint");
async function jobCardUploadSessionEndpoint(request, env, identity, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const purpose = text2(body.purpose, "", 32);
  if (!["source-batch", "job-card-page"].includes(purpose)) throw Object.assign(new Error("Upload purpose is invalid"), { status: 400 });
  const batch = await getJobCardBatch(env, body.batchId);
  let sourceFile = "";
  let recordId = null;
  let pageCount = 0;
  let sizeBytes = 0;
  let sha256 = "";
  let quickXorHash = "";
  let expectedPath = "";
  let manifestEntry = null;
  if (purpose === "source-batch") {
    sourceFile = text2(body.fileName, "", 180);
    const expected = batch.sources.find((source) => source.fileName === sourceFile);
    const candidate = {
      fileName: sourceFile,
      pageCount: Number(body.pageCount),
      sizeBytes: Number(body.sizeBytes),
      sha256: text2(body.sha256, "", 64).toLowerCase(),
      quickXorHash: text2(body.quickXorHash, "", 80)
    };
    if (!expected || JSON.stringify(candidate) !== JSON.stringify(expected)) throw Object.assign(new Error("Source PDF does not match the registered batch inventory"), { status: 409 });
    const existing = await env.DB.prepare("SELECT sharepoint_item_id FROM job_card_source_files WHERE batch_id=? AND source_file=?").bind(batch.batch_id, sourceFile).first();
    if (batch.status !== "uploading" && !existing) throw Object.assign(new Error("The source batch is already complete"), { status: 409 });
    sizeBytes = candidate.sizeBytes;
    sha256 = candidate.sha256;
    quickXorHash = candidate.quickXorHash;
    pageCount = candidate.pageCount;
    expectedPath = `JobCards/Source Batches/${batch.batch_id}/${sourceFile}`;
  } else {
    if (!["source-complete", "pages-complete"].includes(batch.status)) throw Object.assign(new Error("Upload all original source PDFs before adding page records"), { status: 409 });
    manifestEntry = await normalizeJobCardEntry({ ...body.manifestEntry, batchId: batch.batch_id });
    const source = batch.sources.find((item) => item.fileName === manifestEntry.sourceFile);
    const uploadedSource = await env.DB.prepare("SELECT sha256, quick_xor_hash FROM job_card_source_files WHERE batch_id=? AND source_file=?").bind(batch.batch_id, manifestEntry.sourceFile).first();
    if (!source || !uploadedSource || source.sha256 !== manifestEntry.sourceSha256 || source.quickXorHash !== manifestEntry.sourceQuickXorHash || manifestEntry.sourcePage > source.pageCount) {
      throw Object.assign(new Error("Job-card page does not match a completed source PDF"), { status: 409 });
    }
    recordId = manifestEntry.recordId;
    sourceFile = manifestEntry.sourceFile;
    sizeBytes = manifestEntry.sizeBytes;
    sha256 = manifestEntry.sha256;
    quickXorHash = manifestEntry.quickXorHash;
    pageCount = manifestEntry.sourcePage;
    expectedPath = `JobCards/Records/${recordId}.pdf`;
  }
  const graphPath = `/root:/${encodeDrivePath(expectedPath)}:/createUploadSession`;
  const graphResponse = await graphSharePointRequest(env, graphPath, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } })
  });
  if (!graphResponse.ok) throw Object.assign(new Error("SharePoint could not create the job-card upload session"), { status: 503 });
  const graphSession = await graphResponse.json();
  const uploadUrl = text2(graphSession.uploadUrl, "", 5e3);
  const expirationDateTime = text2(graphSession.expirationDateTime, "", 80);
  if (!uploadUrl || !/^https:\/\//i.test(uploadUrl) || !Number.isFinite(Date.parse(expirationDateTime))) {
    throw Object.assign(new Error("SharePoint returned an invalid upload session"), { status: 503 });
  }
  const sessionId = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO job_card_upload_sessions
    (session_id, purpose, batch_id, record_id, source_file, size_bytes, expected_sha256,
     expected_quick_xor_hash, expected_path, page_count, manifest_entry_json, actor_oid, actor_upn, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    sessionId,
    purpose,
    batch.batch_id,
    recordId,
    sourceFile,
    sizeBytes,
    sha256,
    quickXorHash,
    expectedPath,
    pageCount,
    manifestEntry ? JSON.stringify(manifestEntry) : null,
    identity.oid,
    identity.upn,
    expirationDateTime
  ).run();
  return json({ sessionId, uploadUrl, expirationDateTime }, 201, origin || "");
}
__name(jobCardUploadSessionEndpoint, "jobCardUploadSessionEndpoint");
async function jobCardSessionForCompletion(env, sessionId) {
  const row = await env.DB.prepare("SELECT * FROM job_card_upload_sessions WHERE session_id=?").bind(sessionId).first();
  if (!row) throw Object.assign(new Error("Job-card upload session was not found"), { status: 404 });
  if (row.status === "complete") return row;
  if (row.status === "expired" || Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare(`UPDATE job_card_upload_sessions SET status='expired', expected_path=NULL,
      manifest_entry_json=NULL, completed_at=? WHERE session_id=?`).bind((/* @__PURE__ */ new Date()).toISOString(), sessionId).run();
    throw Object.assign(new Error("Job-card upload session expired; create a new session to retry"), { status: 410 });
  }
  if (!row.expected_path || !row.expected_sha256 || !row.expected_quick_xor_hash) throw Object.assign(new Error("Job-card upload session is incomplete"), { status: 409 });
  return row;
}
__name(jobCardSessionForCompletion, "jobCardSessionForCompletion");
async function graphCompletedJobCardFile(env, session) {
  const response = await graphSharePointRequest(env, `/root:/${encodeDrivePath(session.expected_path)}`);
  if (!response.ok) throw Object.assign(new Error(response.status === 404 ? "SharePoint upload has not completed" : "SharePoint upload could not be verified"), { status: response.status === 404 ? 409 : 503 });
  const item = await response.json();
  if (!item.id || Number(item.size) !== Number(session.size_bytes) || item.file?.hashes?.quickXorHash !== session.expected_quick_xor_hash) {
    throw Object.assign(new Error("SharePoint file size or QuickXorHash does not match the local manifest"), { status: 409 });
  }
  return item;
}
__name(graphCompletedJobCardFile, "graphCompletedJobCardFile");
async function clearJobCardUploadSession(env, sessionId) {
  await env.DB.prepare(`UPDATE job_card_upload_sessions SET status='complete', expected_path=NULL,
    manifest_entry_json=NULL, completed_at=? WHERE session_id=?`).bind((/* @__PURE__ */ new Date()).toISOString(), sessionId).run();
}
__name(clearJobCardUploadSession, "clearJobCardUploadSession");
async function jobCardBatchCompleteEndpoint(request, env, identity, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const sessionId = jobCardSessionId(body.sessionId);
  const session = await jobCardSessionForCompletion(env, sessionId);
  if (session.purpose !== "source-batch") throw Object.assign(new Error("Upload session is not an original source PDF"), { status: 400 });
  const batch = await getJobCardBatch(env, session.batch_id);
  if (session.status !== "complete") {
    const item = await graphCompletedJobCardFile(env, session);
    if (item.name && item.name !== session.source_file) throw Object.assign(new Error("SharePoint file name does not match the source inventory"), { status: 409 });
    const source = batch.sources.find((entry) => entry.fileName === session.source_file);
    if (!source) throw Object.assign(new Error("Original source is not part of the registered batch"), { status: 409 });
    await upsertJobCardSourceFile(env, batch.batch_id, source, item, identity);
    await clearJobCardUploadSession(env, sessionId);
  }
  const latest = await getJobCardBatch(env, session.batch_id);
  const sourceCount = Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM job_card_source_files WHERE batch_id=?").bind(batch.batch_id).first())?.count) || 0;
  return json({ ok: true, batchId: latest.batch_id, status: latest.status, uploadedSourceCount: sourceCount }, 200, origin || "");
}
__name(jobCardBatchCompleteEndpoint, "jobCardBatchCompleteEndpoint");
async function jobCardImportEndpoint(request, env, identity, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const sessionId = jobCardSessionId(body.sessionId);
  const session = await jobCardSessionForCompletion(env, sessionId);
  if (session.purpose !== "job-card-page") throw Object.assign(new Error("Upload session is not a job-card page"), { status: 400 });
  if (session.status === "complete") {
    const existing = await getJobCardArchiveRecord(env, session.record_id);
    return json({ ok: true, recordId: existing.record_id, reviewState: existing.review_state, duplicate: true }, 200, origin || "");
  }
  const item = await graphCompletedJobCardFile(env, session);
  if (item.name && item.name !== `${session.record_id}.pdf`) throw Object.assign(new Error("SharePoint filename does not match the job-card record ID"), { status: 409 });
  let manifestEntry;
  try {
    manifestEntry = JSON.parse(session.manifest_entry_json || "{}");
  } catch (_) {
    throw Object.assign(new Error("Job-card upload session manifest is invalid"), { status: 500 });
  }
  const before = await env.DB.prepare("SELECT record_id FROM job_card_archive WHERE record_id=?").bind(session.record_id).first();
  const saved = await upsertJobCardArchive(env, {
    manifestEntry,
    sharepointItemId: item.id,
    sharepointPath: session.expected_path
  }, identity);
  const batch = await getJobCardBatch(env, session.batch_id);
  const importedCount = Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM job_card_archive WHERE batch_id=?").bind(session.batch_id).first())?.count) || 0;
  if (importedCount >= batch.page_count) {
    await env.DB.prepare("UPDATE job_card_import_batches SET status='pages-complete', updated_at=CURRENT_TIMESTAMP WHERE batch_id=?").bind(session.batch_id).run();
  }
  await clearJobCardUploadSession(env, sessionId);
  return json({ ok: true, recordId: saved.recordId, reviewState: saved.reviewState, duplicate: Boolean(before) }, before ? 200 : 201, origin || "");
}
__name(jobCardImportEndpoint, "jobCardImportEndpoint");
function projectJobCardArchive(row) {
  let candidates = {};
  let confirmedFields = {};
  try {
    candidates = JSON.parse(row.candidates_json || "{}");
  } catch (_) {
  }
  try {
    confirmedFields = JSON.parse(row.confirmed_json || "{}");
  } catch (_) {
  }
  return {
    record_id: row.record_id,
    batch_id: row.batch_id,
    source_file: row.source_file,
    source_page: row.source_page,
    card_type: row.card_type,
    ocr_text: row.ocr_text,
    mean_ocr_confidence: row.mean_ocr_confidence,
    candidates,
    confirmed_fields: confirmedFields,
    review_state: row.review_state,
    review_note: row.review_note || "",
    reviewed_at: row.reviewed_at || null
  };
}
__name(projectJobCardArchive, "projectJobCardArchive");
async function listJobCardArchiveEndpoint(request, env, identity, origin) {
  if (!canViewAllRecords(identity, "job-cards")) throw Object.assign(new Error("Job-card archive access is not permitted"), { status: 403 });
  const url = new URL(request.url);
  const result = await queryJobCardArchive(env, {
    q: url.searchParams.get("q"),
    cardType: url.searchParams.get("cardType"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit")
  });
  return json(result, 200, origin || "");
}
__name(listJobCardArchiveEndpoint, "listJobCardArchiveEndpoint");
async function jobCardArchiveDetailEndpoint(env, identity, recordId, origin) {
  if (!canViewAllRecords(identity, "job-cards")) throw Object.assign(new Error("Job-card archive access is not permitted"), { status: 403 });
  const row = await getJobCardArchiveRecord(env, recordId);
  return json({ record: projectJobCardArchive(row) }, 200, origin || "");
}
__name(jobCardArchiveDetailEndpoint, "jobCardArchiveDetailEndpoint");
async function jobCardArchiveReviewEndpoint(request, env, identity, recordId, origin) {
  requireJobCardArchiveAdmin(identity);
  const body = await readJson(request);
  const result = await reviewJobCardArchive(env, recordId, body, identity);
  return json({ ok: true, ...result }, 200, origin || "");
}
__name(jobCardArchiveReviewEndpoint, "jobCardArchiveReviewEndpoint");
async function jobCardArchiveContentEndpoint(env, identity, recordId, origin) {
  if (!canViewAllRecords(identity, "job-cards")) throw Object.assign(new Error("Job-card archive access is not permitted"), { status: 403 });
  const row = await getJobCardArchiveRecord(env, recordId);
  const response = await graphSharePointRequest(env, `/items/${encodeURIComponent(row.sharepoint_item_id)}/content`);
  if (!response.ok) throw Object.assign(new Error("Archived job-card content could not be retrieved"), { status: response.status === 404 ? 404 : 503 });
  return new Response(response.body, { status: 200, headers: {
    "content-type": "application/pdf",
    "content-length": String(row.size_bytes),
    "content-disposition": `inline; filename="${row.record_id}.pdf"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-frame-options": "SAMEORIGIN",
    ...origin ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : {}
  } });
}
__name(jobCardArchiveContentEndpoint, "jobCardArchiveContentEndpoint");
async function jobCardRecordForAttachment(env, identity, recordId, { write = false } = {}) {
  const row = await env.DB.prepare("SELECT * FROM records WHERE record_id=?").bind(recordId).first();
  if (!row) throw Object.assign(new Error("Record not found"), { status: 404 });
  if (row.kind !== "job-cards") throw Object.assign(new Error("Attachments are only available for job cards"), { status: 400 });
  if (row.status === "Deleted") throw Object.assign(new Error("Record has been deleted"), { status: 410 });
  if (write && row.action === "archive_import") throw Object.assign(new Error("Scanned job-card records are managed through Accounts review"), { status: 409 });
  const permitted = write ? canAccessRecord(identity, row) : canReadHistoryRecord(identity, row);
  if (!permitted) throw Object.assign(new Error("Record access is not permitted"), { status: 403 });
  return row;
}
__name(jobCardRecordForAttachment, "jobCardRecordForAttachment");
async function jobCardAttachmentStartEndpoint(request, env, identity, recordId, origin) {
  const record = await jobCardRecordForAttachment(env, identity, recordId, { write: true });
  const metadata = normalizeJobCardAttachmentMetadata(await readJson(request));
  const existing = await findCompletedJobCardAttachment(env, record.record_id, metadata);
  if (existing) {
    await cleanupDuplicateJobCardAttachmentObjectsForTarget(env, existing.attachment_id);
    return json({ attachment: (await listJobCardAttachments(env, record.record_id)).find((item) => item.attachment_id === existing.attachment_id), duplicate: true }, 200, origin || "");
  }
  const attachmentId = crypto.randomUUID();
  const safeRecordFolder = /^[A-Za-z0-9_-]{1,180}$/.test(record.record_id) ? record.record_id : `record-${await sha256Base64Url(record.record_id)}`;
  const expectedPath = `JobCards/Attachments/${safeRecordFolder}/${attachmentId}-${metadata.fileName}`;
  const expirationDateTime = new Date(Date.now() + 30 * 60 * 1e3).toISOString();
  const reserved = await reserveJobCardAttachmentUploadSession(env, {
    attachmentId,
    recordId: record.record_id,
    metadata,
    expectedPath,
    expiresAt: expirationDateTime,
    actor: identity
  });
  if (!reserved) throw Object.assign(new Error("A job-card revision can have at most 10 attachments and 100 MiB total"), { status: 413 });
  return json({ attachmentId, expirationDateTime }, 201, origin || "");
}
__name(jobCardAttachmentStartEndpoint, "jobCardAttachmentStartEndpoint");
async function uploadJobCardAttachmentToSharePoint(env, session, bytes) {
  const expectedName = `${session.attachment_id}-${session.file_name}`;
  const path = `/root:/${encodeDrivePath(session.expected_path)}`;
  const existingResponse = await graphSharePointRequest(env, path);
  if (existingResponse.ok) {
    let existing;
    try {
      existing = await existingResponse.json();
    } catch (_) {
      existing = null;
    }
    if (!existing?.id || !existing.file || existing.name !== expectedName) {
      throw Object.assign(new Error("SharePoint attachment path is occupied by an unexpected item"), { status: 409 });
    }
    const cleanup = await graphSharePointRequest(env, `/items/${encodeURIComponent(existing.id)}`, { method: "DELETE" });
    if (!cleanup.ok && cleanup.status !== 404) throw Object.assign(new Error("SharePoint could not clear a prior incomplete attachment"), { status: 503 });
  } else if (existingResponse.status !== 404) {
    throw Object.assign(new Error("SharePoint could not verify the attachment destination"), { status: 503 });
  }
  const createResponse = await graphSharePointRequest(env, `${path}:/createUploadSession`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ item: { name: expectedName, "@microsoft.graph.conflictBehavior": "fail" } })
  });
  if (!createResponse.ok) throw Object.assign(new Error("SharePoint could not create the job-card attachment upload session"), { status: 503 });
  let graphSession;
  try {
    graphSession = await createResponse.json();
  } catch (_) {
    graphSession = null;
  }
  const uploadUrl = text2(graphSession?.uploadUrl, "", 5e3);
  const expiresAt = text2(graphSession?.expirationDateTime, "", 80);
  if (!uploadUrl || !/^https:\/\//i.test(uploadUrl) || !Number.isFinite(Date.parse(expiresAt))) {
    throw Object.assign(new Error("SharePoint returned an invalid attachment upload session"), { status: 503 });
  }
  try {
    const chunkBytes = 10 * 1024 * 1024;
    let item = null;
    for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
      const end = Math.min(offset + chunkBytes, bytes.byteLength);
      const chunk = bytes.slice(offset, end);
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${offset}-${end - 1}/${bytes.byteLength}`,
          "Content-Type": "application/octet-stream"
        },
        body: chunk
      });
      if (!response.ok) throw Object.assign(new Error("SharePoint could not store the job-card attachment"), { status: 503 });
      if (end === bytes.byteLength) {
        try {
          item = await response.json();
        } catch (_) {
          item = null;
        }
      }
    }
    if (!item?.id) throw Object.assign(new Error("SharePoint did not confirm the uploaded attachment"), { status: 503 });
    return item;
  } catch (error) {
    try {
      await fetch(uploadUrl, { method: "DELETE" });
    } catch (_) {
    }
    throw error;
  }
}
__name(uploadJobCardAttachmentToSharePoint, "uploadJobCardAttachmentToSharePoint");
async function deleteGraphSharePointItem(env, itemId) {
  const response = await graphSharePointRequest(env, `/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
  return response.ok || response.status === 404;
}
__name(deleteGraphSharePointItem, "deleteGraphSharePointItem");
async function cleanupDuplicateJobCardAttachmentObject(env, session) {
  const itemId = text2(session?.orphan_item_id, "", 500);
  if (!itemId) return;
  if (!await deleteGraphSharePointItem(env, itemId)) {
    throw Object.assign(new Error("SharePoint could not remove the duplicate attachment object"), { status: 503 });
  }
  await env.DB.prepare(`UPDATE job_card_attachment_upload_sessions SET orphan_item_id=NULL
    WHERE attachment_id=? AND status='duplicate' AND orphan_item_id=?`).bind(session.attachment_id, itemId).run();
}
__name(cleanupDuplicateJobCardAttachmentObject, "cleanupDuplicateJobCardAttachmentObject");
async function cleanupDuplicateJobCardAttachmentObjectsForTarget(env, targetAttachmentId) {
  const result = await env.DB.prepare(`SELECT attachment_id, orphan_item_id FROM job_card_attachment_upload_sessions
    WHERE duplicate_of=? AND status='duplicate' AND orphan_item_id IS NOT NULL`).bind(targetAttachmentId).all();
  for (const session of result.results || []) await cleanupDuplicateJobCardAttachmentObject(env, session);
}
__name(cleanupDuplicateJobCardAttachmentObjectsForTarget, "cleanupDuplicateJobCardAttachmentObjectsForTarget");
async function jobCardAttachmentUploadEndpoint(request, env, identity, recordId, attachmentId, origin) {
  const record = await jobCardRecordForAttachment(env, identity, recordId, { write: true });
  const session = await getJobCardAttachmentUploadSession(env, record.record_id, attachmentId);
  if (session.status === "complete" || session.status === "duplicate") {
    if (session.status === "duplicate") await cleanupDuplicateJobCardAttachmentObject(env, session);
    const completed = await completeJobCardAttachmentUpload(env, session, null);
    const attachment2 = (await listJobCardAttachments(env, record.record_id)).find((item2) => item2.attachment_id === completed.attachment.attachment_id);
    return json({ ok: true, attachment: attachment2, duplicate: completed.duplicate }, 200, origin || "");
  }
  if (session.status !== "uploading") throw Object.assign(new Error("Attachment upload session is no longer active"), { status: 410 });
  if (Date.parse(session.expires_at) <= Date.now()) {
    await expireJobCardAttachmentUploadSession(env, session.attachment_id);
    throw Object.assign(new Error("Attachment upload session expired; select the file again to retry"), { status: 410 });
  }
  if (!session.expected_path) throw Object.assign(new Error("Attachment upload session is incomplete"), { status: 409 });
  const bytes = await readJobCardAttachmentBytes(request, session);
  const folderPath = session.expected_path.split("/").slice(0, -1).join("/");
  await ensureSharePointFolder(env, folderPath);
  const item = await uploadJobCardAttachmentToSharePoint(env, session, bytes);
  let result;
  try {
    result = await completeJobCardAttachmentUpload(env, session, item);
  } catch (error) {
    if (Number(error?.status) === 409 && item?.id) {
      if (await deleteGraphSharePointItem(env, item.id)) await expireJobCardAttachmentUploadSession(env, session.attachment_id);
    }
    throw error;
  }
  if (result.duplicate) {
    const duplicateSession = await getJobCardAttachmentUploadSession(env, record.record_id, session.attachment_id);
    await cleanupDuplicateJobCardAttachmentObject(env, duplicateSession);
  }
  const attachment = (await listJobCardAttachments(env, record.record_id)).find((entry) => entry.attachment_id === result.attachment.attachment_id);
  return json({ ok: true, attachment, duplicate: result.duplicate }, 200, origin || "");
}
__name(jobCardAttachmentUploadEndpoint, "jobCardAttachmentUploadEndpoint");
async function jobCardAttachmentCompleteEndpoint(env, identity, recordId, attachmentId, origin) {
  const record = await jobCardRecordForAttachment(env, identity, recordId, { write: true });
  const session = await getJobCardAttachmentUploadSession(env, record.record_id, attachmentId);
  if (session.status === "complete" || session.status === "duplicate") {
    if (session.status === "duplicate") await cleanupDuplicateJobCardAttachmentObject(env, session);
    const completed = await completeJobCardAttachmentUpload(env, session, null);
    return json({ ok: true, attachment: (await listJobCardAttachments(env, record.record_id)).find((item) => item.attachment_id === completed.attachment.attachment_id), duplicate: completed.duplicate }, 200, origin || "");
  }
  if (session.status === "uploading" && Date.parse(session.expires_at) <= Date.now()) {
    await expireJobCardAttachmentUploadSession(env, session.attachment_id);
    throw Object.assign(new Error("Attachment upload session expired; select the file again to retry"), { status: 410 });
  }
  if (session.status === "uploading") {
    throw Object.assign(new Error("Upload the file through the authenticated content route before completing the attachment"), { status: 409 });
  }
  throw Object.assign(new Error("Attachment upload session is no longer active"), { status: 410 });
}
__name(jobCardAttachmentCompleteEndpoint, "jobCardAttachmentCompleteEndpoint");
async function jobCardAttachmentContentEndpoint(env, identity, recordId, attachmentId, origin) {
  const record = await jobCardRecordForAttachment(env, identity, recordId);
  const attachment = await getJobCardAttachment(env, record.record_id, attachmentId);
  const response = await graphSharePointRequest(env, `/items/${encodeURIComponent(attachment.sharepoint_item_id)}/content`);
  if (!response.ok) throw Object.assign(new Error("Job-card attachment could not be retrieved"), { status: response.status === 404 ? 404 : 503 });
  const filename = encodeURIComponent(attachment.file_name).replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase());
  return new Response(response.body, { status: 200, headers: {
    "content-type": attachment.content_type,
    "content-length": String(attachment.size_bytes),
    "content-disposition": `inline; filename*=UTF-8''${filename}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-frame-options": "SAMEORIGIN",
    ...origin ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : {}
  } });
}
__name(jobCardAttachmentContentEndpoint, "jobCardAttachmentContentEndpoint");
async function graphFileBytes(response, limit = 20 * 1024 * 1024) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw Object.assign(new Error("Archived file is too large to retrieve"), { status: 413 });
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw Object.assign(new Error("Archived file is too large to retrieve"), { status: 413 });
    }
    chunks.push(part.value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
__name(graphFileBytes, "graphFileBytes");
async function listEstimateArchiveEndpoint(request, env, origin) {
  const url = new URL(request.url);
  const result = await queryEstimateArchive(env, {
    q: url.searchParams.get("q"),
    estimateNumber: url.searchParams.get("estimateNumber"),
    customer: url.searchParams.get("customer"),
    email: url.searchParams.get("email"),
    reference: url.searchParams.get("reference"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    state: url.searchParams.get("state"),
    relatedJobId: url.searchParams.get("relatedJobId"),
    relatedInvoice: url.searchParams.get("relatedInvoice"),
    cursor: url.searchParams.get("cursor"),
    limit: url.searchParams.get("limit")
  });
  return json(result, 200, origin || "");
}
__name(listEstimateArchiveEndpoint, "listEstimateArchiveEndpoint");
async function estimateArchiveDetailEndpoint(env, origin, archiveId) {
  const row = await env.DB.prepare(`SELECT id, canonical_id, source_kind, classification_state, message_direction,
    mailbox, sender_email, recipient_emails,
    subject, customer_display AS customer, customer_email, estimate_number, reference, sent_at,
    received_at
    FROM archive_messages WHERE id = ?`).bind(archiveId).first();
  if (!row) throw Object.assign(new Error("Archive message not found"), { status: 404 });
  const conversationId = await env.DB.prepare("SELECT conversation_id FROM archive_messages WHERE id = ?").bind(archiveId).first();
  const attachments = await env.DB.prepare(`SELECT id, source_attachment_id, file_name, mime_type,
    size_bytes, sha256 FROM archive_attachments WHERE message_id = ? ORDER BY created_at, id`).bind(archiveId).all();
  const associations = await env.DB.prepare(`SELECT id, target_kind, target_id, target_reference,
    relationship, confidence, state, provenance_kind, evidence_json, created_by, created_at, updated_at
    FROM archive_associations WHERE message_id = ? ORDER BY created_at, id`).bind(archiveId).all();
  let recipients = [];
  try {
    recipients = JSON.parse(row.recipient_emails || "[]");
  } catch (_) {
  }
  let sourceCopies = [];
  try {
    const sources = await env.DB.prepare(`SELECT DISTINCT mailbox FROM estimate_mail_sources WHERE canonical_id = ? ORDER BY mailbox`).bind(row.canonical_id).all();
    sourceCopies = (sources.results || []).map((source) => ({ mailbox: source.mailbox }));
  } catch (_) {
    sourceCopies = [];
  }
  let conversation = [];
  if (conversationId?.conversation_id) {
    const result = await env.DB.prepare(`SELECT id, source_kind, classification_state, message_direction,
      mailbox, subject, sender_email, sent_at, received_at FROM archive_messages WHERE conversation_id = ?
      ORDER BY COALESCE(NULLIF(sent_at, ''), received_at), id LIMIT 500`).bind(conversationId.conversation_id).all();
    conversation = result.results || [];
  }
  const relatedThreads = await env.DB.prepare(`SELECT DISTINCT m.id, m.source_kind, m.classification_state, m.message_direction,
      m.mailbox, m.subject, m.sender_email, m.sent_at, m.received_at
    FROM archive_associations base
    JOIN archive_associations related ON related.target_kind=base.target_kind AND related.target_id=base.target_id
    JOIN archive_messages m ON m.id=related.message_id
    WHERE base.message_id=? AND base.state='confirmed' AND base.target_kind IN ('job-card','estimate')
      AND related.state='confirmed' AND m.id<>?
    ORDER BY COALESCE(NULLIF(m.sent_at,''),m.received_at),m.id LIMIT 500`).bind(archiveId, archiveId).all();
  if (relatedThreads.results?.length) {
    const seen = new Set(conversation.map((item) => item.id));
    for (const item of relatedThreads.results) if (!seen.has(item.id)) {
      conversation.push(item);
      seen.add(item.id);
    }
    conversation.sort((a, b) => String(a.sent_at || a.received_at).localeCompare(String(b.sent_at || b.received_at)) || a.id.localeCompare(b.id));
  }
  if (conversation.length) {
    const placeholders = conversation.map(() => "?").join(",");
    const threadFiles = await env.DB.prepare(`SELECT id, message_id, file_name, mime_type, size_bytes FROM archive_attachments WHERE message_id IN (${placeholders}) ORDER BY created_at, id`).bind(...conversation.map((item) => item.id)).all();
    const filesByMessage = /* @__PURE__ */ new Map();
    for (const item of threadFiles.results || []) {
      const values = filesByMessage.get(item.message_id) || [];
      values.push({ id: item.id, file_name: item.file_name, mime_type: item.mime_type, size_bytes: item.size_bytes });
      filesByMessage.set(item.message_id, values);
    }
    conversation = conversation.map((item) => ({ ...item, attachments: filesByMessage.get(item.id) || [] }));
  }
  const safeAttachments = (attachments.results || []).map(({ id, file_name, mime_type, size_bytes }) => ({ id, file_name, mime_type, size_bytes }));
  const safeAssociations = (associations.results || []).map(({ target_kind, target_id, target_reference, relationship, confidence, state }) => ({
    target_kind,
    target_reference,
    relationship,
    confidence,
    state,
    ...target_kind === "job-card" || target_kind === "estimate" ? { target_id } : {}
  }));
  const { canonical_id: _canonicalId, ...safeMessage } = row;
  return json({ message: { ...safeMessage, recipient_emails: Array.isArray(recipients) ? recipients : [] }, sourceCopies, attachments: safeAttachments, associations: safeAssociations, conversation }, 200, origin || "");
}
__name(estimateArchiveDetailEndpoint, "estimateArchiveDetailEndpoint");
async function estimateArchiveContentEndpoint(env, archiveId, contentId, origin = "") {
  let file;
  if (contentId === "eml") {
    const row = await env.DB.prepare(`SELECT sharepoint_eml_item_id AS item_id, 'message.eml' AS file_name,
      'message/rfc822' AS mime_type FROM archive_messages WHERE id = ?`).bind(archiveId).first();
    if (!row || !row.item_id) throw Object.assign(new Error("Archived message content is not available"), { status: 404 });
    file = row;
  } else {
    file = await env.DB.prepare(`SELECT a.sharepoint_item_id AS item_id, a.file_name, a.mime_type
      FROM archive_attachments a WHERE a.id = ? AND a.message_id = ?`).bind(contentId, archiveId).first();
    if (!file || !file.item_id) throw Object.assign(new Error("Archived attachment is not available"), { status: 404 });
  }
  const response = await graphSharePointRequest(env, `/items/${encodeURIComponent(file.item_id)}/content`);
  if (!response.ok) throw Object.assign(new Error("Archived content could not be retrieved"), { status: response.status === 404 ? 404 : 503 });
  const bytes = await graphFileBytes(response);
  const name = archiveFilename(file.file_name);
  const mime = contentId === "eml" || /(?:text\/html|application\/xhtml)/i.test(file.mime_type || "") ? contentId === "eml" ? "message/rfc822" : "application/octet-stream" : text2(file.mime_type, "application/octet-stream", 120).replace(/[\r\n;]/g, "");
  return new Response(bytes, { status: 200, headers: {
    "content-type": mime,
    "content-length": String(bytes.byteLength),
    "content-disposition": `attachment; filename="${name}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-frame-options": "DENY",
    ...origin ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", vary: "Origin" } : {}
  } });
}
__name(estimateArchiveContentEndpoint, "estimateArchiveContentEndpoint");
async function createAppEstimateEndpoint(request, env, identity, origin) {
  const body = await readJson(request);
  const fileName = archiveFilename(body.fileName || body.file_name);
  const contentType = text2(body.contentType || body.content_type, "application/pdf", 120).replace(/[\r\n;]/g, "");
  const base64 = String(body.contentBase64 || body.content_base64 || "");
  if (!base64 || base64.length > 145e4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw Object.assign(new Error("Estimate document is missing or too large"), { status: 400 });
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  if (!bytes.byteLength || bytes.byteLength > 1e6) throw Object.assign(new Error("Estimate document is missing or too large"), { status: 400 });
  const sourceRecordId = text2(body.source_record_id || body.sourceRecordId, "", 240);
  if (!sourceRecordId) throw Object.assign(new Error("source_record_id is required for idempotent estimate filing"), { status: 400 });
  const sourceRecord = await env.DB.prepare("SELECT record_id, owner_oid, kind FROM records WHERE record_id = ?").bind(sourceRecordId).first();
  if (!sourceRecord || sourceRecord.kind !== "estimates" || sourceRecord.owner_oid !== identity.oid) {
    throw Object.assign(new Error("Estimate record not found"), { status: 404 });
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const contentHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const identityBytes = new TextEncoder().encode(`${sourceRecordId}\0${contentHash}`);
  const recipients = body.recipient_emails || body.recipientEmails || body.to || [];
  const metadataFingerprint = JSON.stringify({
    estimate_number: text2(body.estimate_number || body.estimateNumber, "", 500),
    customer: text2(body.customer || body.client || body.client_company, "", 1e3),
    customer_email: text2(body.customer_email || body.customerEmail || body.client_email, "", 320).toLowerCase(),
    reference: text2(body.reference || body.job_reference, "", 500),
    subject: text2(body.subject, "", 1e3),
    mailbox: text2(body.mailbox || body.source_mailbox, "", 320).toLowerCase(),
    recipient_emails: (Array.isArray(recipients) ? recipients : String(recipients).split(/[;,\s]+/)).map((value2) => text2(value2, "", 320).toLowerCase()).filter(Boolean).sort(),
    message_direction: text2(body.message_direction || body.direction, "", 16),
    conversation_id: text2(body.conversation_id || body.conversationId, "", 1e3),
    sent_at: text2(body.sent_at || body.sentAt, "", 80),
    received_at: text2(body.received_at || body.receivedAt, "", 80)
  });
  const identityDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${new TextDecoder().decode(identityBytes)}\0${metadataFingerprint}`)));
  const documentId = [...identityDigest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const canonicalId = `app:${documentId}`;
  const existing = await env.DB.prepare(`SELECT m.id, a.id AS attachment_id FROM archive_messages m
    LEFT JOIN archive_attachments a ON a.message_id=m.id AND a.source_attachment_id=?
    WHERE m.canonical_id=? LIMIT 1`).bind(documentId, canonicalId).first();
  if (existing?.id && existing?.attachment_id) return json({ ok: true, id: existing.id, attachment_id: existing.attachment_id, duplicate: true }, 200, origin || "");
  const archiveInput = normalizeEstimateArchiveRecord({
    ...body,
    id: documentId,
    canonical_id: canonicalId,
    source_kind: "app",
    source_message_id: documentId,
    classification_state: "confirmed",
    sender_email: identity.upn,
    sent_at: text2(body.sent_at || body.sentAt, now(), 80),
    received_at: text2(body.received_at || body.receivedAt, now(), 80),
    content_sha256: contentHash,
    provenance: { source: "portal-app", source_record_id: sourceRecordId, created_by_oid: identity.oid, created_by_upn: identity.upn }
  });
  const extension = fileName.match(/\.[A-Za-z0-9]{1,12}$/)?.[0] || "";
  const path = `/root:/Estimates/Sent%20from%20Portal/${contentHash}${encodeURIComponent(extension)}:/content`;
  const uploaded = await graphSharePointRequest(env, path, { method: "PUT", headers: { "content-type": contentType }, body: bytes });
  if (!uploaded.ok) throw Object.assign(new Error("Estimate document could not be archived"), { status: 503 });
  const item = await uploaded.json();
  const saved = await upsertEstimateArchive(env, { ...archiveInput, sharepoint_manifest_item_id: text2(item.id, "", 500), provenance: JSON.parse(archiveInput.provenance_json) });
  const savedAssociations = await deriveArchiveAssociations(env, saved.id, {
    sourceRecordId,
    estimateNumber: archiveInput.estimate_number,
    reference: archiveInput.reference,
    invoiceNumber: text2(body.invoice_number || body.invoiceNumber, "", 500)
  });
  const attachmentId = existing?.attachment_id || crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO archive_attachments
    (id, message_id, source_attachment_id, file_name, mime_type, size_bytes, sha256, sharepoint_item_id, provenance_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id, source_attachment_id) DO UPDATE SET
      file_name=excluded.file_name, mime_type=excluded.mime_type, size_bytes=excluded.size_bytes,
      sha256=excluded.sha256, sharepoint_item_id=excluded.sharepoint_item_id, provenance_json=excluded.provenance_json`).bind(attachmentId, saved.id, documentId, fileName, contentType, bytes.byteLength, contentHash, text2(item.id, "", 500), JSON.stringify({ source: "portal-app", source_record_id: sourceRecordId, created_by_oid: identity.oid })).run();
  return json({ ok: true, id: saved.id, attachment_id: attachmentId, associations: publicArchiveAssociations(savedAssociations) }, 201, origin || "");
}
__name(createAppEstimateEndpoint, "createAppEstimateEndpoint");
function estimateProjection(row, payload) {
  const items = Array.isArray(payload.items) ? payload.items.slice(0, 80).map((item) => ({
    description: text2(item && item.description, "", 500),
    quantity: Number(item && item.quantity) || 0,
    unit: Number(item && (item.unit ?? item.unitPrice)) || 0
  })).filter((item) => item.description) : [];
  return {
    estimate_number: text2(payload.number || payload.estimateNumber || row.record_id, "", 160),
    estimate_date: text2(payload.date || payload.dateOfEstimate || row.record_date, "", 80),
    client_company: text2(payload.company || payload.clientCompany, "", 500),
    client_contact: text2(payload.attention || payload.clientContact, "", 500),
    client_email: text2(payload.email || payload.clientEmail, "", 500),
    validity: text2(payload.validity, "30", 80),
    prepared_by: text2(payload.preparedBy, "", 240),
    vat_rate: Number(payload.vatRate) || 0,
    reference: text2(payload.reference, "", 500),
    opening: text2(payload.opening, "", 3e3),
    terms: text2(payload.terms, "", 3e3),
    items,
    subtotal: Number(payload.subtotal) || 0,
    vat: Number(payload.vat) || 0,
    total: Number(payload.total) || 0
  };
}
__name(estimateProjection, "estimateProjection");
function jobProjection(row, payload) {
  return {
    job_ref: text2(payload.jobReference || payload.ref || row.record_id, "", 180),
    client: text2(payload.client || payload.company, "", 500),
    site: text2(payload.site || payload.siteAddress, "", 1e3),
    engineer: text2(payload.engineer || payload.assignedEngineer, "", 240),
    planned_date: text2(payload.plannedDate || payload.date || row.record_date, "", 80),
    description: text2(payload.description, "", 3e3),
    card_type: text2(payload.cardType, "EC", 20).toUpperCase() === "MTA" ? "MTA" : "EC",
    job_status: text2(payload.jobStatus || payload.status, row.status || "Received", 100),
    job_revision: Math.max(1, Number(payload.jobRevision || payload.revision || 1) || 1),
    previous_record_id: text2(payload.previousRecordId, "", MAX_RECORD_ID2),
    invoice_number: text2(payload.invoiceNumber, "", 180),
    xero_reference: text2(payload.xeroReference, "", 240),
    xero_invoice_id: text2(payload.xeroInvoiceId, "", 100),
    xero_invoice_status: text2(payload.xeroInvoiceStatus, "", 80),
    xero_invoice_url: httpUrl(payload.xeroInvoiceUrl),
    xero_invoice_total: Number.isFinite(Number(payload.xeroInvoiceTotal)) ? Number(payload.xeroInvoiceTotal) : null,
    xero_invoice_amount_due: Number.isFinite(Number(payload.xeroInvoiceAmountDue)) ? Number(payload.xeroInvoiceAmountDue) : null,
    xero_invoice_currency: text2(payload.xeroInvoiceCurrency, "", 20),
    xero_last_synced_at: text2(payload.xeroLastSyncedAt, "", 80),
    job_email_url: httpUrl(payload.jobEmailUrl),
    job_email_message_id: text2(payload.jobEmailMessageId, "", 500),
    update_reason: text2(payload.updateReason, "", 1e3),
    account_notes: text2(payload.accountNotes, "", 2e3)
  };
}
__name(jobProjection, "jobProjection");
function taskProjection(row, payload) {
  return {
    task_title: text2(payload.title, "", 500),
    job_reference: text2(payload.jobReference, "", 180),
    assignee: text2(payload.assignee, "", 240),
    due_date: text2(payload.due, "", 80),
    priority: text2(payload.priority, "Normal", 40)
  };
}
__name(taskProjection, "taskProjection");
function calendarProjection(row, payload) {
  return {
    event_title: text2(payload.title, "", 500),
    event_date: text2(payload.date || row.record_date, "", 80),
    event_type: text2(payload.type, "General", 80),
    owner: text2(payload.owner, "", 240),
    notes: text2(payload.notes, "", 3e3)
  };
}
__name(calendarProjection, "calendarProjection");
function enquiryMessages(payload) {
  const raw = Array.isArray(payload.messages) ? payload.messages : [];
  return raw.slice(-100).map((message) => {
    const item = message && typeof message === "object" ? message : { body: message };
    return {
      id: text2(item.id || item.messageId, "", 180),
      direction: text2(item.direction, "inbound", 40).toLowerCase() === "outbound" ? "outbound" : "inbound",
      author: text2(item.author || item.from || item.sender, "", 240),
      body: text2(item.body || item.message || item.text, "", 3e3),
      at: text2(item.at || item.sentAt || item.receivedAt || item.timestamp, "", 100),
      subject: text2(item.subject, "", 500)
    };
  }).filter((message) => message.body || message.subject);
}
__name(enquiryMessages, "enquiryMessages");
function enquiryProjection(row, payload) {
  return {
    enquiry_id: text2(payload.enquiryId || payload.enquiry_id || row.record_id, "", MAX_RECORD_ID2),
    customer_name: text2(payload.customerName || payload.name, "", 500),
    customer_email: text2(payload.customerEmail || payload.email, "", 500),
    customer_phone: text2(payload.customerPhone || payload.phone, "", 120),
    request_type: text2(payload.requestType || payload.request_type, "General enquiry", 120),
    message: text2(payload.message, "", 3e3),
    conversation_url: httpUrl(payload.conversationUrl || payload.emailThreadUrl || payload.jobEmailUrl),
    conversation_id: text2(payload.conversationId || payload.threadId || payload.emailMessageId, "", 500),
    thread_id: text2(payload.threadId || payload.conversationId, "", 500),
    inbox_status: text2(payload.inboxStatus || payload.mailboxStatus, "Awaiting inbox synchronisation", 120),
    mailbox: text2(payload.mailbox, "GMT enquiries inbox", 240),
    reply_to: text2(payload.replyTo || payload.customerEmail || payload.email, "", 500),
    messages: enquiryMessages(payload)
  };
}
__name(enquiryProjection, "enquiryProjection");
function projectRow(row, includeDetails = true, env = null, payPeriods2 = defaultPayPeriods()) {
  const rawPayload = payloadObject(row);
  const payload = rawPayload && typeof rawPayload === "object" ? { ...rawPayload } : {};
  const result = {
    kind: row.kind,
    employee_name: row.employee_name,
    employee_upn: row.owner_upn,
    start_date: row.start_date || "",
    end_date: row.end_date || "",
    record_date: row.record_date || "",
    action: row.action,
    status: row.status,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    issue: row.issue || "",
    source_record_id: row.record_id,
    can_edit: row.kind === "timesheets" && isCurrentPayMonthRecord(row, "Europe/London", /* @__PURE__ */ new Date(), payPeriods2),
    source: "portal-d1",
    synthetic: syntheticRecord(row, payload)
  };
  const sourceAttachmentIds = (() => {
    try {
      const parsed = JSON.parse(row.source_attachment_ids || "[]");
      return Array.isArray(parsed) ? parsed.slice(0, 200).map((value2) => text2(value2, "", 160)).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  })();
  if (row.reconciliation_key || row.source_message_key || row.source_variant_status || sourceAttachmentIds.length) {
    result.reconciliation = {
      key: text2(row.reconciliation_key, "", 500),
      source_message_key: text2(row.source_message_key, "", 500),
      source_attachment_ids: sourceAttachmentIds,
      variant_status: text2(row.source_variant_status, "", 80),
      reconciled_at: text2(row.reconciled_at, "", 100)
    };
  }
  const directory = env ? staffDirectory(env) : [];
  const directoryEntry = directoryEntryFor(directory, row.employee_name, row.owner_upn) || directoryEntryFor(historicalEmployeeAliases(env), row.employee_name, row.owner_upn);
  if (directory.length && ["timesheets", "clock"].includes(row.kind) && !directoryEntry) result.synthetic = true;
  const scheduleWeekdays = Array.isArray(payload.scheduleWeekdays) ? payload.scheduleWeekdays.map((day) => Number(day)).filter((day) => day >= 1 && day <= 7) : directoryEntry?.workdays || [];
  if (scheduleWeekdays.length) {
    result.schedule_weekdays = scheduleWeekdays;
    result.schedule_label = scheduleWeekdays.map((day) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day % 7]).join(", ");
  }
  if (row.dispatch_status) {
    result.dispatch = {
      status: row.dispatch_status,
      attempts: Number(row.dispatch_attempts || 0),
      queued_at: row.dispatch_queued_at || "",
      sent_at: row.dispatch_last_sent_at || "",
      error: row.dispatch_last_error || ""
    };
  }
  if (!includeDetails) return result;
  if (row.kind === "timesheets" || row.kind === "clock") {
    const rawRows = Array.isArray(payload.rows) ? payload.rows : Array.isArray(payload.dailyRows) ? payload.dailyRows : Array.isArray(payload.daily_rows) ? payload.daily_rows : [];
    const aligned = rawRows.length ? preserveOriginalDailyDates(rawRows) : { rows: rawRows, issue: "" };
    if (row.action === "pay_month_correction" && !rawRows.length) result.payload = payload;
    if (rawRows.length) {
      payload.rows = safePayloadValue(aligned.rows);
      result.payload = payload;
      result.daily_rows_count = aligned.rows.length;
      result.daily_dates = aligned.rows.map((item) => upstreamDateKey(item?.date)).filter(Boolean).filter((date, index, values) => values.indexOf(date) === index);
    }
    if (aligned.issue) {
      result.date_correction_issue = aligned.issue;
      result.issue = [result.issue, aligned.issue].filter(Boolean).join(" \xB7 ");
    }
  }
  if (row.kind === "estimates") Object.assign(result, estimateProjection(row, payload));
  if (row.kind === "job-cards") Object.assign(result, jobProjection(row, payload));
  if (row.kind === "tasks") Object.assign(result, taskProjection(row, payload));
  if (row.kind === "calendar") Object.assign(result, calendarProjection(row, payload));
  if (row.kind === "enquiries") Object.assign(result, enquiryProjection(row, payload));
  return result;
}
__name(projectRow, "projectRow");
function staffDirectory(env) {
  const raw = text2(env.STAFF_DIRECTORY_JSON, "", 3e4);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = /* @__PURE__ */ new Set();
    return parsed.map((entry) => {
      if (typeof entry === "string") return { name: text2(entry, "", 240), upn: "", workdays: [] };
      const rawWorkdays = entry?.workdays || entry?.scheduledWeekdays || entry?.scheduled_weekdays || [];
      const workdays = Array.isArray(rawWorkdays) ? rawWorkdays.map((day) => {
        if (typeof day === "number" || /^\d+$/.test(String(day))) return Number(day);
        const names = { sun: 7, sunday: 7, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
        return names[String(day || "").trim().toLowerCase()] || 0;
      }).filter((day, index, values) => day >= 1 && day <= 7 && values.indexOf(day) === index) : [];
      return {
        name: text2(entry?.name || entry?.displayName || entry?.employee_name, "", 240),
        upn: text2(entry?.upn || entry?.email || entry?.employee_upn, "", 320).toLowerCase(),
        workdays
      };
    }).filter((entry) => {
      const key = entry.upn || entry.name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (_) {
    return [];
  }
}
__name(staffDirectory, "staffDirectory");
function historicalEmployeeAliases(env) {
  return staffDirectory({ STAFF_DIRECTORY_JSON: env?.HISTORICAL_EMPLOYEE_ALIASES_JSON });
}
__name(historicalEmployeeAliases, "historicalEmployeeAliases");
function upstreamValue(row, keys) {
  for (const key of keys) {
    if (row && row[key] !== void 0 && row[key] !== null && String(row[key]).trim()) return upstreamScalar(row[key]);
  }
  return "";
}
__name(upstreamValue, "upstreamValue");
function upstreamScalar(value2) {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) return value2;
  for (const key of ["value", "Value", "displayValue", "DisplayValue", "displayName", "DisplayName", "email", "Email", "name", "Name"]) {
    if (value2[key] !== void 0 && value2[key] !== null && String(value2[key]).trim()) return value2[key];
  }
  return value2;
}
__name(upstreamScalar, "upstreamScalar");
function parseUpstreamCsv(value2) {
  const lines = String(value2 || "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2 || !/^status\s*,/i.test(lines[0])) return null;
  function cells(line) {
    const output = [];
    let current = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else quoted = !quoted;
      } else if (character === "," && !quoted) {
        output.push(current.trim());
        current = "";
      } else current += character;
    }
    output.push(current.trim());
    return output;
  }
  __name(cells, "cells");
  const headers = cells(lines[0]).map((heading) => heading.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return lines.slice(1, 81).map((line) => {
    const values = cells(line);
    const fields = {};
    headers.forEach((heading, index) => {
      fields[heading] = values[index] || "";
    });
    return {
      date: fields.date || "",
      start: fields.start || "",
      finish: fields.finish || "",
      break: fields.break || "",
      absenceReason: fields.absencereason || "",
      workedHours: fields.workedhours || "",
      basicHours: fields.basichours || "",
      ot15Hours: fields.ot15hours || "",
      ot20Hours: fields.ot20hours || "",
      status: fields.status || "",
      category: fields.category || "",
      weekStart: fields.weekstart || "",
      weekEnd: fields.weekend || "",
      payMonth: fields.paymonth || "",
      note: fields.note || ""
    };
  }).filter((row) => row.date || row.start || row.finish || row.absenceReason);
}
__name(parseUpstreamCsv, "parseUpstreamCsv");
function parseUpstreamJson(value2) {
  if (value2 && typeof value2 === "object") return value2;
  const raw = text2(value2, "", 12e4).trim();
  if (!raw) return null;
  const csvRows = parseUpstreamCsv(raw);
  if (csvRows) return csvRows;
  if (/^[\[{]/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch (_) {
    }
  }
  const compact = raw.replace(/\s+/g, "");
  if (compact.length < 8 || compact.length % 4 === 1 || !/^[A-Za-z0-9+/_=-]+$/.test(compact)) return null;
  try {
    const decoded = atob(compact.replace(/-/g, "+").replace(/_/g, "/"));
    const trimmed = decoded.trim();
    if (!/^[\[{]/.test(trimmed)) return null;
    return JSON.parse(trimmed);
  } catch (_) {
    return null;
  }
}
__name(parseUpstreamJson, "parseUpstreamJson");
function upstreamObjectValue(value2, keys) {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) return void 0;
  const actualKeys = Object.keys(value2);
  for (const wanted of keys.map((key) => String(key).toLowerCase())) {
    const actual = actualKeys.find((key) => key.toLowerCase() === wanted);
    if (actual) return upstreamScalar(value2[actual]);
  }
  return void 0;
}
__name(upstreamObjectValue, "upstreamObjectValue");
var UPSTREAM_DAILY_ROW_KEYS = [
  "rows",
  "daily_rows",
  "dailyRows",
  "records",
  "values",
  "data",
  "items",
  "entries",
  "dayRows",
  "daily",
  "timesheet",
  "timesheets",
  "attachments",
  "files",
  "file",
  "attachment",
  "attachment_content",
  "attachmentContent",
  "attachment_contents",
  "attachmentContents",
  "file_content",
  "fileContent",
  "file_contents",
  "fileContents",
  "calendarSync",
  "calendar_sync",
  "calendarSyncPayload",
  "calendar_sync_payload"
];
var UPSTREAM_DAILY_ENVELOPE_KEYS = [
  "payload",
  "body",
  "result",
  "response",
  "content",
  "value",
  "item",
  "fields",
  "properties",
  "contentBytes",
  "contentBase64",
  "base64",
  "attachmentContent"
];
var UPSTREAM_DAILY_VALUE_KEYS = [
  "date",
  "record_date",
  "recordDate",
  "workDate",
  "day",
  "startTime",
  "start",
  "clockIn",
  "clock_in",
  "finishTime",
  "finish",
  "clockOut",
  "clock_out",
  "absenceReason",
  "absenceStatus",
  "workedMinutes",
  "worked_minutes",
  "workedHours",
  "worked_hours",
  "hours",
  "totalHours",
  "basicHours",
  "basic_hours",
  "ot15Hours",
  "ot15_hours",
  "ot20Hours",
  "ot20_hours",
  "lunchMinutes",
  "lunch_minutes",
  "breakMinutes",
  "break_minutes",
  "break",
  "action",
  "clockAction",
  "clock_action",
  "time",
  "timestamp"
];
function upstreamLooksLikeDailyRow(value2) {
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) return false;
  return UPSTREAM_DAILY_VALUE_KEYS.some((key) => {
    const item = upstreamObjectValue(value2, [key]);
    return item !== "" && item !== null && item !== void 0;
  });
}
__name(upstreamLooksLikeDailyRow, "upstreamLooksLikeDailyRow");
function collectUpstreamDailyRows(value2, depth = 0, seen = /* @__PURE__ */ new Set()) {
  if (depth > 8) return [];
  const parsed = parseUpstreamJson(value2);
  if (!parsed) return [];
  if (Array.isArray(parsed)) {
    const rows = [];
    parsed.forEach((item) => {
      const nested = collectUpstreamDailyRows(item, depth + 1, seen);
      if (nested.length) rows.push(...nested);
      else if (upstreamLooksLikeDailyRow(item)) rows.push(item);
    });
    return rows.slice(0, 80);
  }
  if (typeof parsed !== "object") return [];
  if (seen.has(parsed)) return [];
  seen.add(parsed);
  for (const key of UPSTREAM_DAILY_ROW_KEYS) {
    const nestedValue = upstreamObjectValue(parsed, [key]);
    if (nestedValue === "" || nestedValue === null || nestedValue === void 0) continue;
    const rows = collectUpstreamDailyRows(nestedValue, depth + 1, seen);
    if (rows.length) return rows.slice(0, 80);
  }
  if (upstreamLooksLikeDailyRow(parsed)) return [parsed];
  for (const key of UPSTREAM_DAILY_ENVELOPE_KEYS) {
    const nestedValue = upstreamObjectValue(parsed, [key]);
    if (nestedValue === "" || nestedValue === null || nestedValue === void 0) continue;
    const rows = collectUpstreamDailyRows(nestedValue, depth + 1, seen);
    if (rows.length) return rows.slice(0, 80);
  }
  return [];
}
__name(collectUpstreamDailyRows, "collectUpstreamDailyRows");
function upstreamDailyRows(value2) {
  const rows = collectUpstreamDailyRows(value2);
  const seen = /* @__PURE__ */ new Set();
  return rows.filter((row) => {
    const signature = [
      upstreamObjectValue(row, ["recordId", "record_id", "sourceRecordId", "source_record_id"]),
      upstreamObjectValue(row, ["submissionId", "submission_id"]),
      upstreamObjectValue(row, ["date", "record_date", "recordDate", "Date", "workDate"]),
      upstreamObjectValue(row, ["start", "startTime", "start_time", "clockIn", "clock_in"]),
      upstreamObjectValue(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out"]),
      upstreamObjectValue(row, ["lunchMinutes", "lunch_minutes", "breakMinutes", "break_minutes", "break"]),
      upstreamObjectValue(row, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence"]),
      upstreamObjectValue(row, ["workedMinutes", "worked_minutes", "workedHours", "worked_hours", "hours", "totalHours"]),
      upstreamObjectValue(row, ["note", "notes", "description", "Note"]),
      upstreamObjectValue(row, ["submittedAt", "submitted_at", "Submitted At"])
    ].map((item) => text2(item, "", 500)).join("|");
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}
__name(upstreamDailyRows, "upstreamDailyRows");
function preserveOriginalDailyDates(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  let restored = 0;
  const dated = sourceRows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const date = upstreamDateKey(upstreamObjectValue(row, ["date", "record_date", "recordDate", "Date", "workDate"]));
    const sourceDate = upstreamDateKey(upstreamObjectValue(row, ["sourceDate", "source_date", "originalDate", "original_date"]));
    if (!sourceDate || sourceDate === date) return row;
    restored += 1;
    return { ...row, date: sourceDate, legacyAlignedDate: date || void 0 };
  });
  return {
    rows: dated,
    issue: restored ? `${restored} daily Date value(s) restored from the original source; previous week-aligned dates are retained for audit.` : ""
  };
}
__name(preserveOriginalDailyDates, "preserveOriginalDailyDates");
function upstreamPayloadAndRows(row) {
  const candidates = [
    "payload",
    "payload_json",
    "payloadJson",
    "record_json",
    "recordJson",
    "Record JSON",
    "attachment_record",
    "attachmentRecord",
    "record_attachment",
    "recordAttachment",
    "attachment_content",
    "attachmentContent",
    "attachment_contents",
    "attachmentContents",
    "file_content",
    "fileContent",
    "file_contents",
    "fileContents",
    "daily_rows",
    "dailyRows",
    "rows",
    "Rows",
    "record",
    "Record",
    "issue",
    "Issue",
    "body_json",
    "bodyJson",
    "json_content",
    "jsonContent",
    "gmt_payload",
    "gmt_daily_rows",
    "daily_rows_json",
    "dailyRowsJson",
    "gmt_calendar_sync_payload",
    "calendarSyncPayload",
    "calendar_sync_payload",
    "calendarSync",
    "calendar_sync"
  ];
  for (const key of candidates) {
    const value2 = upstreamObjectValue(row, [key]);
    if (value2 === "" || value2 === null || value2 === void 0) continue;
    const parsed = parseUpstreamJson(value2);
    const rows = upstreamDailyRows(parsed);
    if (rows.length) return { payload: parsed, rows };
  }
  const directRows = upstreamDailyRows(row);
  return directRows.length ? { payload: row, rows: directRows } : { payload: null, rows: [] };
}
__name(upstreamPayloadAndRows, "upstreamPayloadAndRows");
function numericUpstreamValue(value2) {
  if (value2 === null || value2 === void 0 || value2 === "") return null;
  const number = Number(value2);
  return Number.isFinite(number) ? number : null;
}
__name(numericUpstreamValue, "numericUpstreamValue");
function upstreamWeekday(value2) {
  const match = String(value2 || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return 0;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  if (Number.isNaN(date.getTime())) return 0;
  const day = date.getUTCDay();
  return day === 0 ? 7 : day;
}
__name(upstreamWeekday, "upstreamWeekday");
function upstreamDateKey(value2) {
  const match = String(value2 || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
__name(upstreamDateKey, "upstreamDateKey");
function upstreamDailyWindow(startDate, endDate, rows) {
  const dates = (Array.isArray(rows) ? rows : []).map((row) => upstreamDateKey(row?.date)).filter(Boolean).sort();
  if (!dates.length) return null;
  const declaredStart = upstreamDateKey(startDate);
  const declaredEnd = upstreamDateKey(endDate);
  if (!declaredStart || !declaredEnd) return null;
  const insideDeclaredWindow = dates.filter((date) => date >= declaredStart && date <= declaredEnd).length;
  if (insideDeclaredWindow || dates[dates.length - 1] > datePlusDays(dates[0], 6)) return null;
  const first = dates[0];
  const weekday = upstreamWeekday(first);
  const effectiveStart = datePlusDays(first, -(weekday ? weekday - 1 : 0));
  return effectiveStart ? {
    start: effectiveStart,
    end: datePlusDays(effectiveStart, 6),
    first,
    last: dates[dates.length - 1]
  } : null;
}
__name(upstreamDailyWindow, "upstreamDailyWindow");
function upstreamBreakMinutes(value2) {
  const number = numericUpstreamValue(value2);
  if (number !== null) return number;
  const raw = text2(value2, "", 80).trim().toLowerCase();
  if (!raw) return null;
  if (/^(?:no\s*break|none|not[- ]?taken|no)$/.test(raw)) return 0;
  const hours2 = raw.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  const minutes = raw.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/);
  if (!hours2 && !minutes) return null;
  return (hours2 ? Number(hours2[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
}
__name(upstreamBreakMinutes, "upstreamBreakMinutes");
function upstreamTimeMinutes(value2) {
  if (value2 === null || value2 === void 0 || value2 === "") return null;
  const raw = String(value2).trim().toLowerCase();
  const iso = raw.match(/(?:t|\s)(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:z|[+-]\d{2}:?\d{2})?$/i);
  const match = iso || raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;
  if (!iso && match[3]) {
    if (hour < 1 || hour > 12) return null;
    if (match[3] === "pm" && hour < 12) hour += 12;
    if (match[3] === "am" && hour === 12) hour = 0;
  }
  return hour >= 0 && hour <= 23 ? hour * 60 + minute : null;
}
__name(upstreamTimeMinutes, "upstreamTimeMinutes");
function breakMinutesFromNote(value2) {
  const raw = text2(value2, "", 3e3);
  const match = raw.match(/\bbreak\s*:\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return /hours?|hrs?|h/i.test(match[2]) ? amount * 60 : amount;
}
__name(breakMinutesFromNote, "breakMinutesFromNote");
function booleanUpstreamValue(value2) {
  if (typeof value2 === "boolean") return value2;
  if (value2 === null || value2 === void 0 || value2 === "") return null;
  if (/^(true|yes|y|1|taken|added)$/i.test(String(value2).trim())) return true;
  if (/^(false|no|no\s*break|n|0|none|not[- ]?taken|na)$/i.test(String(value2).trim())) return false;
  return null;
}
__name(booleanUpstreamValue, "booleanUpstreamValue");
function normaliseUpstreamDailyRow(row, defaults = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const explicitDate = upstreamObjectValue(row, ["date", "record_date", "recordDate", "Date", "workDate", "day"]);
  const date = text2(explicitDate || (defaults.allowRecordDate ? defaults.date : ""), "", 80);
  const sourceDate = text2(upstreamObjectValue(row, ["sourceDate", "source_date", "originalDate", "original_date"]), "", 80);
  const legacyAlignedDate = text2(upstreamObjectValue(row, ["legacyAlignedDate"]), "", 80);
  const start = text2(upstreamObjectValue(row, ["start", "startTime", "start_time", "clockIn", "clock_in", "dayStart", "day_start", "Start"]), "", 40);
  const finish = text2(upstreamObjectValue(row, ["finish", "finishTime", "finish_time", "clockOut", "clock_out", "dayFinish", "day_finish", "Finish"]), "", 40);
  const lunchStart = text2(upstreamObjectValue(row, ["lunchStart", "lunch_start", "breakStart", "break_start", "Lunch start"]), "", 40);
  const lunchEnd = text2(upstreamObjectValue(row, ["lunchEnd", "lunch_end", "breakEnd", "break_end", "Lunch end"]), "", 40);
  const note = text2(upstreamObjectValue(row, ["description", "note", "notes", "Note"]), "", 3e3);
  const rawLunch = upstreamObjectValue(row, ["lunchMinutes", "lunch_minutes", "breakMinutes", "break_minutes", "break", "Break"]);
  const lunchMinutes = upstreamBreakMinutes(rawLunch) ?? breakMinutesFromNote(note) ?? (upstreamTimeMinutes(lunchStart) !== null && upstreamTimeMinutes(lunchEnd) !== null ? Math.max(0, upstreamTimeMinutes(lunchEnd) - upstreamTimeMinutes(lunchStart)) : null);
  const lunchHad = booleanUpstreamValue(upstreamObjectValue(row, ["lunchHad", "lunch_had", "breakTaken", "break_taken", "hadBreak"]));
  const absenceStatus = text2(upstreamObjectValue(row, ["absenceStatus", "absence_status", "absenceReason", "absence_reason", "absence", "Absence reason"]), "NA", 160);
  const unpaidAbsence = /^un-paid$/i.test(absenceStatus.trim());
  const status = text2(upstreamObjectValue(row, ["status", "Status"]), defaults.status || "Recorded", 120);
  const rowSubmittedAt = text2(upstreamObjectValue(row, ["submittedAt", "submitted_at", "Submitted At"]), defaults.submittedAt || "", 100);
  const sourceRecordId = text2(upstreamObjectValue(row, ["recordId", "record_id", "sourceRecordId", "source_record_id"]), "", MAX_RECORD_ID2);
  let breakStatus = text2(upstreamObjectValue(row, ["breakStatus", "break_status", "Break"]), "", 80);
  if (/^(?:no\s*break|none|not[- ]?taken|no|0)$/i.test(breakStatus)) breakStatus = "not-taken";
  else if (/^(?:yes|taken|added)$/i.test(breakStatus) || /\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/i.test(breakStatus)) breakStatus = "added";
  breakStatus = breakStatus || (lunchHad === false ? "not-taken" : "") || (lunchHad === true ? "added" : "") || (lunchMinutes !== null && lunchMinutes > 0 ? "added" : "") || (/break:\s*(?:no break|none|not taken)/i.test(note) ? "not-taken" : "");
  const reportedWorkedHours = numericUpstreamValue(upstreamObjectValue(row, ["workedHours", "worked_hours", "hours", "totalHours", "Worked hours"]));
  const basicHours = numericUpstreamValue(upstreamObjectValue(row, ["basicHours", "basic_hours", "Basic hours"]));
  const ot15Hours = numericUpstreamValue(upstreamObjectValue(row, ["ot15Hours", "ot15_hours", "overtime15Hours", "OT x1.5 hours"]));
  const ot20Hours = numericUpstreamValue(upstreamObjectValue(row, ["ot20Hours", "ot20_hours", "overtime20Hours", "OT x2.0 hours"]));
  const reportedWorkedMinutes = numericUpstreamValue(upstreamObjectValue(row, ["workedMinutes", "worked_minutes", "Worked minutes"])) ?? (reportedWorkedHours !== null ? reportedWorkedHours * 60 : null);
  const startMinutes = upstreamTimeMinutes(start);
  const finishMinutes = upstreamTimeMinutes(finish);
  let workedMinutes = null;
  let calculationSource = "unavailable";
  const validationIssues = [];
  if (!date) validationIssues.push("Date missing");
  if (unpaidAbsence) {
    workedMinutes = 0;
    calculationSource = "unpaid absence";
  } else if (!/^(?:na|n\/a|none|no absence|not applicable)$/i.test(absenceStatus.trim())) {
    workedMinutes = reportedWorkedMinutes === null ? 0 : reportedWorkedMinutes;
    calculationSource = reportedWorkedMinutes === null ? "absence" : "reported absence total";
  } else if (startMinutes !== null && finishMinutes !== null) {
    if (finishMinutes > startMinutes) {
      workedMinutes = Math.max(0, finishMinutes - startMinutes - (lunchMinutes || 0));
      calculationSource = "clock interval";
    } else if (finishMinutes === startMinutes) {
      validationIssues.push("Clock in and clock out are the same time");
      calculationSource = "invalid clock interval";
    } else {
      validationIssues.push("Finish is earlier than clock in");
      calculationSource = "invalid clock interval";
    }
  } else {
    if (startMinutes === null) validationIssues.push("Clock in missing");
    if (finishMinutes === null) validationIssues.push("Clock out missing");
  }
  const result = {
    recordId: sourceRecordId || (defaults.sourceRecordId && date ? `${defaults.sourceRecordId}|${date}` : defaults.sourceRecordId || ""),
    submissionId: text2(upstreamObjectValue(row, ["submissionId", "submission_id"]), defaults.sourceRecordId || "", MAX_RECORD_ID2),
    date,
    sourceDate: sourceDate && sourceDate !== date ? sourceDate : "",
    legacyAlignedDate,
    action: text2(upstreamObjectValue(row, ["action", "Action"]), defaults.action || "submission", 100),
    status,
    absenceStatus,
    start,
    finish,
    lunchStart,
    lunchEnd,
    lunchMinutes,
    lunchHad,
    breakStatus,
    workedMinutes,
    workedHours: workedMinutes !== null ? workedMinutes / 60 : null,
    reportedWorkedHours,
    reportedWorkedMinutes,
    calculationSource,
    basicHours: unpaidAbsence ? 0 : basicHours,
    ot15Hours: unpaidAbsence ? 0 : ot15Hours,
    ot20Hours: unpaidAbsence ? 0 : ot20Hours,
    weightedHours: unpaidAbsence ? 0 : numericUpstreamValue(upstreamObjectValue(row, ["weightedHours", "weighted_hours"])),
    location: text2(upstreamObjectValue(row, ["location", "site", "Location / site"]), "", 500),
    note,
    submittedAt: rowSubmittedAt,
    source: "microsoft-365",
    validationIssues
  };
  const scheduledWeekdays = Array.isArray(defaults.scheduleWeekdays) ? defaults.scheduleWeekdays.map((day) => Number(day)).filter((day) => day >= 1 && day <= 7) : [];
  if (scheduledWeekdays.length && date) {
    const weekday = upstreamWeekday(date);
    result.scheduled = scheduledWeekdays.includes(weekday);
    if (!result.scheduled) result.scheduleIssue = "Outside configured work schedule";
  }
  return safePayloadValue(result);
}
__name(normaliseUpstreamDailyRow, "normaliseUpstreamDailyRow");
function datePlusDays(value2, days) {
  const match = String(value2 || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0), 12));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}
__name(datePlusDays, "datePlusDays");
function historyTitleDetails(value2) {
  let title = text2(value2, "", 600);
  if (!title) return { name: "", weekStart: "" };
  title = title.replace(/^\s*(?:fw|fwd|re):\s*/i, "");
  title = title.replace(/^.*?\[GMT\]\[TIMESHEET\]\[SUBMISSION\]\s*/i, "");
  const week = title.match(/\bWeek\s+(\d{4}-\d{2}-\d{2})\b/i);
  const name = title.split(/\s*\|\s*Week\b/i)[0].split(/\s*\|\s*/)[0].replace(/^\s*[:|-]\s*/, "").trim();
  return { name: text2(name, "", 240), weekStart: week ? week[1] : "" };
}
__name(historyTitleDetails, "historyTitleDetails");
function directoryEntryFor(directory, name, upn) {
  const candidateUpn = text2(upn, "", 320).toLowerCase();
  const candidateName = text2(name, "", 240).trim().toLowerCase();
  const compactName = candidateName.replace(/[^a-z0-9]+/g, "");
  if (candidateUpn) {
    const exact = directory.find((entry) => entry.upn && candidateUpn === entry.upn);
    if (exact || directory.some((entry) => entry.upn)) return exact || null;
  }
  return directory.find((entry) => {
    if (!candidateName || !entry.name) return false;
    const directoryName = entry.name.trim().toLowerCase();
    const compactDirectoryName = directoryName.replace(/[^a-z0-9]+/g, "");
    return candidateName === directoryName || compactName === compactDirectoryName;
  }) || null;
}
__name(directoryEntryFor, "directoryEntryFor");
async function readSharePointHistory(env, identity) {
  const site = text2(env.SHAREPOINT_SITE_ID, "", 500);
  const list = text2(env.SHAREPOINT_TIMESHEET_LIST_ID, "", 120);
  if (!site || !/^[a-z0-9-]+$/i.test(list)) throw new Error("SharePoint history is not configured");
  const expectedPath = `/v1.0/sites/${encodeURIComponent(site)}/lists/${encodeURIComponent(list)}/items`;
  let historyStage = "authentication";
  try {
    const token = await sharePointGraphToken(env);
    let url = `https://graph.microsoft.com${expectedPath}?$expand=fields&$top=100`;
    const visited = /* @__PURE__ */ new Set();
    const records = [];
    const mayViewAll = identity?.isSubmissionAdmin === true || identity?.isTimesheetViewer === true;
    for (let page = 0; url; page += 1) {
      historyStage = "continuation";
      if (page >= 100 || visited.has(url)) throw new Error("SharePoint history pagination is incomplete");
      let parsed;
      try {
        parsed = new URL(url);
      } catch (_) {
        throw new Error("Invalid SharePoint history continuation");
      }
      if (parsed.protocol !== "https:" || parsed.host !== "graph.microsoft.com" || parsed.username || parsed.password || parsed.hash || decodeURIComponent(parsed.pathname) !== decodeURIComponent(expectedPath)) {
        throw new Error("Invalid SharePoint history continuation");
      }
      visited.add(url);
      historyStage = "request";
      const response = await fetch(url, { redirect: "manual", headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      if (!response.ok) throw Object.assign(new Error(`SharePoint history is unavailable (HTTP ${response.status})`), { status: 503, publicMessage: `SharePoint history is unavailable (HTTP ${response.status})` });
      historyStage = "response";
      const body = await response.json();
      if (!body || !Array.isArray(body.value)) throw new Error("Invalid SharePoint history response");
      historyStage = "mapping";
      for (const item of body.value) {
        const fields = item?.fields;
        if (!fields || typeof fields !== "object" || Array.isArray(fields)) continue;
        let owner = text2(fields.Employee_x0020_Email || fields.EmployeeEmail || fields.employee_email, "", 320).toLowerCase();
        if (!mayViewAll) {
          const name = text2(fields.EmployeeName || fields.employee_name, "", 240).toLowerCase();
          if (!owner && name) {
            const matches = [...staffDirectory(env), ...historicalEmployeeAliases(env)].filter((entry) => entry.name.toLowerCase() === name && entry.upn).map((entry) => entry.upn);
            const unique = [...new Set(matches)];
            if (unique.length === 1) owner = unique[0];
          }
          if (!owner || owner !== text2(identity?.upn, "", 320).toLowerCase()) continue;
          const source = upstreamPayloadAndRows(fields);
          const embedded = source.payload && typeof source.payload === "object" && !Array.isArray(source.payload) ? source.payload : {};
          const ownerValues = [embedded.employeeEmail, embedded.employee_email, ...(source.rows || []).flatMap((row) => [row?.employeeEmail, row?.employee_email])].filter(Boolean);
          if (ownerValues.some((value2) => text2(value2, "", 320).toLowerCase() !== owner)) continue;
          const nameValues = [embedded.employeeName, embedded.employee_name, ...(source.rows || []).flatMap((row) => [row?.employeeName, row?.employee_name])].filter(Boolean);
          if (name && nameValues.some((value2) => text2(value2, "", 240).toLowerCase() !== name)) continue;
        }
        const mapped = normaliseUpstreamRecord(fields, identity, env);
        if (!mapped || mapped.synthetic || !canReadHistoryRecord(identity, mapped)) continue;
        if (!mayViewAll && !upstreamEmployeeClaimsAgree(fields, mapped)) continue;
        if (!mayViewAll && mapped.payload) mapped.payload = { rows: mapped.payload.rows || [] };
        records.push(mapped);
      }
      const next = body["@odata.nextLink"];
      if (next !== void 0 && next !== null && typeof next !== "string") throw new Error("Invalid SharePoint history continuation");
      url = next || "";
    }
    return { records, pages: visited.size };
  } catch (error) {
    if (error && typeof error === "object") error.historyStage = historyStage;
    throw error;
  }
}
__name(readSharePointHistory, "readSharePointHistory");
function normaliseUpstreamRecord(row, identity, env) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const nested = ["fields", "Fields", "item", "Item", "properties", "Properties"].map((key) => row[key]).filter((value2) => value2 && typeof value2 === "object" && !Array.isArray(value2)).reduce((merged2, value2) => Object.assign(merged2, value2), {});
  row = Object.keys(nested).length ? { ...nested, ...row } : row;
  const title = upstreamValue(row, ["title", "Title", "subject", "Subject"]);
  const titleDetails = historyTitleDetails(title);
  const directory = staffDirectory(env);
  const explicitName = upstreamValue(row, ["employee_name", "employeeName", "EmployeeName", "Employee Name", "employee", "Employee", "gmt_employee"]);
  const explicitEmail = upstreamValue(row, ["employee_upn", "employeeUpn", "employeeEmail", "employee_email", "EmployeeEmail", "Employee Email", "Employee_x0020_Email", "email", "Email", "gmt_employee_upn"]);
  const initialName = text2(explicitName || titleDetails.name, "", 240);
  const initialEmail = text2(explicitEmail, "", 320).toLowerCase();
  const directoryEntry = directoryEntryFor(directory, initialName, initialEmail) || directoryEntryFor(historicalEmployeeAliases(env), initialName, initialEmail);
  const viewerHasImplicitIdentity = identity.isAdmin || identity.isTimesheetViewer || identity.isSubmissionAdmin;
  const employeeName = text2(directoryEntry?.name || initialName || (viewerHasImplicitIdentity ? "" : identity.name || identity.upn), "", 240);
  const employeeUpn = text2(directoryEntry?.upn || initialEmail || (viewerHasImplicitIdentity ? "" : identity.upn), "", 320).toLowerCase();
  if (!employeeName && !employeeUpn) return null;
  const titleKind = /\[(?:CLOCK|DAY)\]/i.test(String(title || "")) ? "clock" : "";
  const rawKind = text2(upstreamValue(row, ["kind", "category", "record_type", "recordType", "action", "gmt_type"]) || titleKind || "timesheets", "timesheets", 120).toLowerCase().replace(/[\s_]+/g, "-");
  const kind = rawKind === "submission" || rawKind === "weekly-submission" || rawKind === "timesheet" ? "timesheets" : canonicalKind(rawKind);
  const sourceData = kind === "timesheets" || kind === "clock" ? upstreamPayloadAndRows(row) : { payload: null, rows: [] };
  const firstDailyRow = sourceData.rows[0] || null;
  const embeddedSourceRecordId = text2(
    upstreamObjectValue(sourceData.payload, ["submissionId", "submission_id", "sourceRecordId", "source_record_id", "recordId", "record_id"]) || upstreamObjectValue(firstDailyRow, ["submissionId", "submission_id", "sourceRecordId", "source_record_id", "recordId", "record_id"]),
    "",
    MAX_RECORD_ID2
  );
  const firstDailyDate = text2(upstreamObjectValue(firstDailyRow, ["date", "record_date", "recordDate", "Date", "workDate", "day"]), "", 80);
  let startDate = text2(upstreamValue(row, ["start_date", "startDate", "weekStart", "WeekStart", "Week Start", "Week_x0020_Start", "gmt_week_start"]) || titleDetails.weekStart || firstDailyDate, "", 80);
  let endDate = text2(upstreamValue(row, ["end_date", "endDate", "weekEnd", "WeekEnd", "Week End", "Week_x0020_End", "gmt_week_end"]) || (kind === "clock" ? startDate : datePlusDays(startDate, 6)), "", 80);
  let recordDate = text2(upstreamValue(row, ["record_date", "recordDate", "date", "Date", "gmt_record_date"]) || firstDailyDate || startDate, "", 80);
  const declaredStartDate = startDate;
  const declaredEndDate = endDate;
  const declaredRecordDate = recordDate;
  const embeddedSubmittedAt = upstreamObjectValue(sourceData.payload, ["submittedAt", "submitted_at", "Submitted At", "Submitted_x0020_At", "gmt_submitted_at"]) || upstreamObjectValue(firstDailyRow, ["submittedAt", "submitted_at", "Submitted At", "Submitted_x0020_At", "gmt_submitted_at"]);
  const submittedAt = text2(upstreamValue(row, ["submitted_at", "submittedAt", "Submitted At", "Submitted_x0020_At", "gmt_submitted_at"]) || embeddedSubmittedAt || upstreamValue(row, ["Created", "created", "Modified", "modified"]), "", 100);
  const updatedAt = text2(upstreamValue(row, ["updated_at", "updatedAt", "Modified", "modified"]) || submittedAt, "", 100);
  const action = text2(upstreamValue(row, ["action", "Action", "category", "record_type", "gmt_action"]) || (kind === "timesheets" ? "submission" : kind === "clock" ? "clock" : "Timesheet"), "Timesheet", 100);
  const status = text2(upstreamValue(row, ["status", "Status", "Status Value", "gmt_status"]) || "Submitted", "Submitted", 100);
  const sourceRecordValue = upstreamValue(row, ["source_record_id", "sourceRecordId", "gmt_record_id", "Source Record ID", "Source_x0020_Record_x0020_ID"]) || embeddedSourceRecordId || (row.Id || row.ID || row.GUID ? `sharepoint-timesheet-${row.Id || row.ID || row.GUID}` : "");
  const fallbackRecordSeed = [kind, employeeUpn || employeeName, recordDate || startDate || title, endDate, title, updatedAt].filter(Boolean).join("|");
  const fallbackRecordId = fallbackRecordSeed ? `history-${fallbackRecordSeed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_RECORD_ID2 - 8)}` : "";
  const sourceRecordId = text2(sourceRecordValue || fallbackRecordId, "", MAX_RECORD_ID2);
  const alignedSource = preserveOriginalDailyDates(sourceData.rows);
  if (alignedSource.issue) {
    const alignedFirstDate = upstreamDateKey(alignedSource.rows[0]?.date);
    if (alignedFirstDate) recordDate = alignedFirstDate;
  }
  const rows = alignedSource.rows.map((item) => normaliseUpstreamDailyRow(item, {
    date: recordDate || startDate,
    allowRecordDate: kind === "clock",
    status: kind === "clock" ? "Recorded" : status,
    action,
    submittedAt,
    sourceRecordId,
    scheduleWeekdays: directoryEntry?.workdays || []
  })).filter(Boolean);
  const dailyWindow = kind === "timesheets" ? upstreamDailyWindow(startDate, endDate, rows) : null;
  const periodIssue = dailyWindow ? `Source week ${declaredStartDate || "not dated"} to ${declaredEndDate || "not dated"} differs from daily rows ${dailyWindow.first} to ${dailyWindow.last}; reporting uses the daily dates.` : "";
  const dailyDetailIssue = kind === "timesheets" && !rows.length ? "Daily rows were not returned by the Microsoft 365 history source; times, breaks and totals are unavailable." : "";
  if (dailyWindow) {
    startDate = dailyWindow.start;
    endDate = dailyWindow.end;
    recordDate = dailyWindow.first;
  }
  const payloadObject2 = sourceData.payload && typeof sourceData.payload === "object" && !Array.isArray(sourceData.payload) ? { ...sourceData.payload } : {};
  if (rows.length) payloadObject2.rows = rows;
  const payload = Object.keys(payloadObject2).length ? safePayloadValue(payloadObject2) : null;
  const rawIssue = upstreamValue(row, ["issue", "Issue", "gmt_issue"]);
  const parsedIssue = parseUpstreamJson(rawIssue);
  const issueValue = parsedIssue ? typeof parsedIssue === "object" && !Array.isArray(parsedIssue) ? upstreamObjectValue(parsedIssue, ["issue", "Issue", "message"]) : "" : rawIssue;
  const issue = [text2(issueValue, "", 1e3), alignedSource.issue, periodIssue, dailyDetailIssue].filter(Boolean).join(" \xB7 ");
  const mapped = {
    kind,
    employee_name: employeeName,
    employee_upn: employeeUpn,
    start_date: startDate,
    end_date: endDate,
    record_date: recordDate,
    action,
    status,
    submitted_at: submittedAt,
    updated_at: updatedAt,
    issue,
    source_record_id: sourceRecordId,
    title,
    can_edit: false,
    source: "microsoft-365",
    synthetic: false
  };
  if (payload) {
    mapped.payload = payload;
    mapped.daily_rows_count = rows.length;
    mapped.daily_dates = rows.map((item) => item.date).filter(Boolean).filter((value2, index, values) => values.indexOf(value2) === index);
  }
  if (periodIssue) {
    mapped.period_issue = periodIssue;
    mapped.declared_start_date = declaredStartDate;
    mapped.declared_end_date = declaredEndDate;
    mapped.declared_record_date = declaredRecordDate;
  }
  if (dailyDetailIssue) mapped.daily_detail_issue = dailyDetailIssue;
  if (alignedSource.issue) mapped.date_correction_issue = alignedSource.issue;
  const sourceMessageKey = text2(upstreamValue(row, ["source_message_key", "sourceMessageKey", "sourceMessageId", "source_message_id"]), "", 500);
  const sourceVariantStatus = text2(upstreamValue(row, ["source_variant_status", "sourceVariantStatus", "reconciliationStatus"]), "", 80);
  const reconciliationKey = text2(upstreamValue(row, ["reconciliation_key", "reconciliationKey"]), "", 500);
  const sourceAttachmentIds = upstreamObjectValue(row, ["source_attachment_ids", "sourceAttachmentIds"]);
  const reconciledAt = text2(upstreamValue(row, ["reconciled_at", "reconciledAt"]), "", 100);
  if (sourceMessageKey || sourceVariantStatus || reconciliationKey || sourceAttachmentIds || reconciledAt) {
    const parsedAttachmentIds = parseUpstreamJson(sourceAttachmentIds);
    mapped.reconciliation = {
      key: reconciliationKey,
      source_message_key: sourceMessageKey,
      source_attachment_ids: Array.isArray(parsedAttachmentIds) ? parsedAttachmentIds.slice(0, 200).map((value2) => text2(value2, "", 160)).filter(Boolean) : [],
      variant_status: sourceVariantStatus,
      reconciled_at: reconciledAt
    };
  }
  if (directoryEntry?.workdays?.length) {
    mapped.schedule_weekdays = directoryEntry.workdays;
    mapped.schedule_label = directoryEntry.workdays.map((day) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day % 7]).join(", ");
  }
  mapped.synthetic = syntheticRecord(mapped, row) || /^TEST(?:[\s_-]|$)/i.test(employeeName) || /\b(?:flow\s+test|flow\s+validation|historical\s+backfill|archive\s+(?:backfill|real)|test\s+(?:route|external))\b/i.test(title) || directory.length > 0 && !directoryEntry && !rows.length;
  return mapped;
}
__name(normaliseUpstreamRecord, "normaliseUpstreamRecord");
function dateKeyInTimeZone(date = /* @__PURE__ */ new Date(), timeZone = "Europe/London") {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = String(parts.find((part) => part.type === "year")?.value || "");
  const month = String(parts.find((part) => part.type === "month")?.value || "");
  const day = String(parts.find((part) => part.type === "day")?.value || "");
  return year && month && day ? `${year}-${month}-${day}` : "";
}
__name(dateKeyInTimeZone, "dateKeyInTimeZone");
function completionWeeks(monthKey, timeZone = "Europe/London", nowDate = /* @__PURE__ */ new Date()) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return [];
  const monthStart = new Date(Date.UTC(year, month - 1, 1, 12));
  const monthEnd = new Date(Date.UTC(year, month, 0, 12));
  const [todayYear, todayMonth, todayDay] = dateKeyInTimeZone(nowDate, timeZone).split("-").map(Number);
  const currentKey = todayYear && todayMonth ? `${todayYear}-${String(todayMonth).padStart(2, "0")}` : "";
  const cutoff = currentKey === monthKey ? new Date(Date.UTC(todayYear, todayMonth - 1, todayDay, 12)) : monthEnd;
  if (currentKey && monthKey > currentKey) return [];
  const mondayOffset = (monthStart.getUTCDay() + 6) % 7;
  const firstMonday = new Date(monthStart.getTime() - mondayOffset * 864e5);
  const result = [];
  for (let cursor = firstMonday; cursor <= monthEnd; cursor = new Date(cursor.getTime() + 7 * 864e5)) {
    const weekEnd = new Date(cursor.getTime() + 6 * 864e5);
    if (weekEnd < monthStart || weekEnd > cutoff) continue;
    result.push({
      start: cursor.toISOString().slice(0, 10),
      end: weekEnd.toISOString().slice(0, 10)
    });
  }
  return result;
}
__name(completionWeeks, "completionWeeks");
function timesheetRecord(row) {
  const rawKind = text2(row?.kind || row?.action, "", 120).toLowerCase().replace(/[_\s]+/g, "-");
  const kind = canonicalKind(row?.kind || row?.action || "");
  return (kind === "timesheets" || rawKind === "submission" || rawKind === "weekly-submission") && !syntheticRecord(row);
}
__name(timesheetRecord, "timesheetRecord");
function recordWeekStart(row) {
  const candidate = text2(row?.start_date || row?.record_date || row?.end_date, "", 80).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return "";
  const date = /* @__PURE__ */ new Date(`${candidate}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const offset = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - offset * 864e5).toISOString().slice(0, 10);
}
__name(recordWeekStart, "recordWeekStart");
function recordStatusIssue(row) {
  const status = text2(row?.status, "Submitted", 120).toLowerCase();
  const issue = text2(row?.issue, "", 1e3);
  if (issue) return issue;
  if (/^(draft|pending|delivery failed|failed|rejected|cancelled|test - not sent|needs review)/i.test(status)) return `Status is ${text2(row?.status, "not submitted", 120)}.`;
  return "";
}
__name(recordStatusIssue, "recordStatusIssue");
function historyRecordFingerprint(record) {
  if (!record || typeof record !== "object") return "";
  const payload = record.payload && typeof record.payload === "object" ? record.payload : {};
  const rows = Array.isArray(payload.rows) ? payload.rows.map((row) => ({
    date: row?.date || row?.record_date || row?.recordDate || "",
    start: row?.start || row?.startTime || row?.clockIn || "",
    finish: row?.finish || row?.finishTime || row?.clockOut || "",
    break: row?.lunchMinutes ?? row?.breakMinutes ?? row?.break ?? "",
    absence: row?.absenceStatus || row?.absenceReason || row?.absence || "",
    worked: row?.workedMinutes ?? row?.workedHours ?? row?.hours ?? "",
    basic: row?.basicHours ?? "",
    ot15: row?.ot15Hours ?? "",
    ot20: row?.ot20Hours ?? "",
    note: row?.note || row?.notes || ""
  })) : [];
  const kind = canonicalKind(record.kind || record.action || "timesheets");
  const employee = text2(record.employee_upn || record.employee_email || record.employee_name, "", 320).toLowerCase();
  const week = recordWeekStart(record) || text2(record.start_date || record.record_date || record.end_date, "", 80).slice(0, 10);
  return [kind, employee, week, text2(record.status, "Submitted", 120).toLowerCase(), text2(record.record_date, "", 80), text2(record.title, "", 600), JSON.stringify(rows.length ? rows : payload)].join("|");
}
__name(historyRecordFingerprint, "historyRecordFingerprint");
function historyRecordRichness(record) {
  if (!record || typeof record !== "object") return 0;
  const rows = record.payload && typeof record.payload === "object" && Array.isArray(record.payload.rows) ? record.payload.rows : [];
  const daily = Math.max(0, Number(record.daily_rows_count || rows.length || 0) || 0);
  const invalidRows = rows.filter((row) => Array.isArray(row?.validationIssues) && row.validationIssues.some((issue) => /same time|earlier than clock|clock in missing|clock out missing/i.test(String(issue)))).length;
  const validRows = Math.max(0, daily - invalidRows);
  const correctedRows = rows.filter((row) => row?.sourceDate || row?.source_date).length;
  const payload = record.payload && typeof record.payload === "object" ? 1 : 0;
  const variant = text2(record.source_variant_status || record.reconciliation?.variant_status, "", 80).toLowerCase();
  const authoritative = variant === "authoritative" ? 1 : 0;
  const metadata = ["employee_upn", "start_date", "end_date", "record_date", "submitted_at", "updated_at", "status"].reduce((score, key) => score + (text2(record[key], "", 320) ? 1 : 0), 0);
  return (authoritative ? 5e5 : 0) + (validRows === daily && daily > 0 ? 1e6 : 0) + validRows * 1e4 + daily * 100 + payload * 10 + metadata - correctedRows;
}
__name(historyRecordRichness, "historyRecordRichness");
function completionSummary(records, env, timeZone = "Europe/London", nowDate = /* @__PURE__ */ new Date()) {
  const month = monthKeyInTimeZone(nowDate, timeZone);
  const weeks = completionWeeks(month, timeZone, nowDate);
  const directory = staffDirectory(env);
  const excludedRosterUpns = csvSet(env.TIMESHEET_ROSTER_EXCLUDED_UPNS);
  const isExcludedFromExpectedRoster = /* @__PURE__ */ __name((record) => {
    const upn = text2(record.employee_upn || record.employeeEmail || record.employee_email, "", 320).toLowerCase();
    if (upn && excludedRosterUpns.has(upn)) return true;
    const name = text2(record.employee_name || record.employeeName, "", 240);
    const directoryEntry = directoryEntryFor(directory, name, upn);
    return Boolean(directoryEntry?.upn && excludedRosterUpns.has(directoryEntry.upn));
  }, "isExcludedFromExpectedRoster");
  const identities = /* @__PURE__ */ new Map();
  directory.filter((entry) => !excludedRosterUpns.has(entry.upn)).forEach((entry) => {
    identities.set(entry.upn || entry.name.toLowerCase(), { ...entry, configured: true });
  });
  records.filter(timesheetRecord).forEach((record) => {
    if (isExcludedFromExpectedRoster(record)) return;
    const upn = text2(record.employee_upn || record.employeeEmail || record.employee_email, "", 320).toLowerCase();
    const name = text2(record.employee_name || record.employeeName, "", 240);
    const key = upn || name.toLowerCase();
    if (directory.length && !directoryEntryFor(directory, name, upn)) return;
    if (!key || identities.has(key)) return;
    identities.set(key, { name, upn, configured: false });
  });
  const employees = [...identities.values()].map((employee) => {
    const employeeRecords = records.filter((record) => {
      if (!timesheetRecord(record)) return false;
      const week = recordWeekStart(record);
      if (!week || !weeks.some((entry) => entry.start === week)) return false;
      const upn = text2(record.employee_upn || record.employeeEmail || record.employee_email, "", 320).toLowerCase();
      const name = text2(record.employee_name || record.employeeName, "", 240).toLowerCase();
      return employee.upn ? upn === employee.upn : name === employee.name.toLowerCase();
    });
    const byWeek = /* @__PURE__ */ new Map();
    employeeRecords.forEach((record) => {
      const week = recordWeekStart(record);
      if (week && (!byWeek.has(week) || historyRecordRichness(record) > historyRecordRichness(byWeek.get(week)))) byWeek.set(week, record);
    });
    const completedWeeks = weeks.filter((week) => byWeek.has(week.start)).map((week) => week.start);
    const missingWeeks = weeks.filter((week) => !byWeek.has(week.start)).map((week) => `${week.start} to ${week.end}`);
    const missing = missingWeeks.map((week) => `Timesheet week ${week}`);
    employeeRecords.forEach((record) => {
      const issue = recordStatusIssue(record);
      if (issue && !missing.includes(issue)) missing.push(issue);
    });
    const scheduleWeekdays = Array.isArray(employee.workdays) ? employee.workdays : [];
    const reviewFlags = employeeRecords.reduce((count, record) => {
      const payload = record.payload && typeof record.payload === "object" ? record.payload : {};
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      return count + rows.filter((row) => row && row.scheduled !== false && row.scheduleIssue).length;
    }, 0);
    const status = !employeeRecords.length ? "missing" : missing.length || reviewFlags ? "incomplete" : "completed";
    const fingerprints = new Set(employeeRecords.map(historyRecordFingerprint).filter(Boolean));
    return {
      employee_name: employee.name || employee.upn || "Unnamed employee",
      employee_upn: employee.upn,
      configured: employee.configured,
      status,
      completed_weeks: completedWeeks,
      missing_weeks: missingWeeks,
      missing,
      submitted_records: fingerprints.size || employeeRecords.length,
      source_variants: employeeRecords.length,
      review_flags: reviewFlags,
      schedule_weekdays: scheduleWeekdays,
      schedule_label: scheduleWeekdays.map((day) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day % 7]).join(", ")
    };
  }).sort((left, right) => left.employee_name.localeCompare(right.employee_name));
  return {
    pay_month: month,
    due_weeks: weeks,
    directory_configured: directory.length > 0,
    employees,
    counts: {
      completed: employees.filter((employee) => employee.status === "completed").length,
      incomplete: employees.filter((employee) => employee.status === "incomplete").length,
      missing: employees.filter((employee) => employee.status === "missing").length
    }
  };
}
__name(completionSummary, "completionSummary");
async function verifiedUpstreamToken(request, env, identity) {
  const flowAudience = audienceValue("https://service.flow.microsoft.com/");
  const supplied = bearerToken(request, "X-GMT-Upstream-Authorization");
  const primary = identity.aud === flowAudience ? bearerToken(request) : "";
  const token = supplied || primary;
  if (!token) return { token: "", status: "flow-permission-not-configured" };
  try {
    const upstreamIdentity = await authenticateToken(token, env);
    if (upstreamIdentity.aud !== flowAudience) throw new Error("Flow token audience is not permitted");
    if (upstreamIdentity.tid !== identity.tid || upstreamIdentity.oid !== identity.oid || upstreamIdentity.upn !== identity.upn) throw new Error("Flow token identity does not match the signed-in account");
    return { token, status: "ready" };
  } catch (_) {
    return { token: "", status: "upstream-token-invalid" };
  }
}
__name(verifiedUpstreamToken, "verifiedUpstreamToken");
async function fetchUpstreamHistory(upstreamUrl, token, kind, identity) {
  const headers = { accept: "application/json", authorization: `Bearer ${token}` };
  const requestInit = { headers, cf: { cacheTtl: 0, cacheEverything: false }, signal: AbortSignal.timeout(15e3) };
  let response = await fetch(upstreamUrl, requestInit);
  if (response.status === 400 || response.status === 405) {
    response = await fetch(upstreamUrl, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        kind: kind || "all",
        scope: upstreamHistoryScope(identity),
        employeeEmail: identity.upn
      }),
      signal: AbortSignal.timeout(15e3),
      cf: { cacheTtl: 0, cacheEverything: false }
    });
  }
  return response;
}
__name(fetchUpstreamHistory, "fetchUpstreamHistory");
function upstreamHistoryScope(identity) {
  return identity && (identity.isAdmin || identity.isTimesheetViewer || identity.isSubmissionAdmin) ? "all" : "own";
}
__name(upstreamHistoryScope, "upstreamHistoryScope");
function sameRecord(a, b) {
  return a.owner_oid === b.ownerOid && a.owner_upn === b.ownerUpn && a.employee_name === b.employeeName && a.kind === b.kind && a.action === b.action && a.status === b.status && (a.start_date || "") === b.startDate && (a.end_date || "") === b.endDate && (a.record_date || "") === b.recordDate && a.issue === b.issue && a.payload_json === b.payloadJson;
}
__name(sameRecord, "sameRecord");
async function saveRecord(env, input, identity, existing = null) {
  const changed = existing && !sameRecord(existing, input);
  const writeVersion = async () => env.DB.prepare('INSERT INTO record_versions (record_id, owner_oid, payload_json, changed_at, changed_by_oid) VALUES (?, ?, ?, ?, ?)')
    .bind(existing.record_id, existing.owner_oid, JSON.stringify({
        employee_name: existing.employee_name,
        kind: existing.kind,
        action: existing.action,
        status: existing.status,
        start_date: existing.start_date,
        end_date: existing.end_date,
        record_date: existing.record_date,
        submitted_at: existing.submitted_at,
        updated_at: existing.updated_at,
        issue: existing.issue,
        payload: payloadObject(existing)
      }), now(), identity.oid).run();
  if (!existing) {
    await env.DB.prepare(`INSERT INTO records (record_id, owner_oid, owner_upn, employee_name, kind, action, status, start_date, end_date, record_date, submitted_at, updated_at, issue, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(input.recordId, input.ownerOid, input.ownerUpn, input.employeeName, input.kind, input.action, input.status, input.startDate, input.endDate, input.recordDate, input.submittedAt, input.updatedAt, input.issue, input.payloadJson).run();
    return { created: true, changed: false };
  }
  if (['calendar', 'tasks'].includes(canonicalKind(existing.kind))) {
    const result = await env.DB.prepare(`UPDATE records SET owner_upn = ?, employee_name = ?, kind = ?, action = ?, status = ?, start_date = ?, end_date = ?, record_date = ?, submitted_at = ?, updated_at = ?, issue = ?, payload_json = ? WHERE record_id = ? AND owner_oid = ? AND status = ?`)
      .bind(input.ownerUpn, input.employeeName, input.kind, input.action, input.status, input.startDate, input.endDate, input.recordDate, input.submittedAt, input.updatedAt, input.issue, input.payloadJson, input.recordId, existing.owner_oid, existing.status).run();
    if (Number(result?.meta?.changes ?? 0) < 1) {
      throw Object.assign(new Error('The request changed while it was being saved. Refresh the calendar and try again.'), { status: 409 });
    }
    if (changed) await writeVersion();
    return { created: false, changed };
  }
  if (existing.kind === 'timesheets') {
    const update=env.DB.prepare(`UPDATE records SET owner_upn=?,employee_name=?,kind=?,action=?,status=?,start_date=?,end_date=?,record_date=?,submitted_at=?,updated_at=?,issue=?,payload_json=?
      WHERE record_id=? AND owner_oid IS ? AND owner_upn IS ? AND employee_name IS ? AND kind IS ? AND action IS ? AND status IS ?
        AND start_date IS ? AND end_date IS ? AND record_date IS ? AND submitted_at IS ? AND updated_at IS ? AND issue IS ? AND payload_json IS ?
        AND (?=1 OR NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=records.record_id))`)
      .bind(input.ownerUpn,input.employeeName,input.kind,input.action,input.status,input.startDate,input.endDate,input.recordDate,input.submittedAt,input.updatedAt,input.issue,input.payloadJson,
        input.recordId,existing.owner_oid,existing.owner_upn,existing.employee_name,existing.kind,existing.action,existing.status,existing.start_date??null,existing.end_date??null,
        existing.record_date??null,existing.submitted_at,existing.updated_at,existing.issue??null,existing.payload_json,
        identity.isSubmissionAdmin === true || (identity.isAdmin === true && identity.isTimesheetViewer === true) ? 1 : 0);
    const statements=[update];
    if (changed) {
      const prior=JSON.stringify({employee_name:existing.employee_name,kind:existing.kind,action:existing.action,status:existing.status,
        start_date:existing.start_date,end_date:existing.end_date,record_date:existing.record_date,submitted_at:existing.submitted_at,
        updated_at:existing.updated_at,issue:existing.issue,payload:payloadObject(existing)});
      statements.push(env.DB.prepare('INSERT INTO record_versions (record_id,owner_oid,payload_json,changed_at,changed_by_oid) SELECT ?,?,?,?,? WHERE changes()=1')
        .bind(existing.record_id,existing.owner_oid,prior,now(),identity.oid));
    }
    const result=await env.DB.batch(statements);
    if (Number(result?.[0]?.meta?.changes || 0)<1) throw Object.assign(new Error('The timesheet changed or needs ownership review. Refresh before editing.'),{status:409});
    return {created:false,changed};
  }
  if (changed) await writeVersion();
  await env.DB.prepare(`UPDATE records SET owner_upn = ?, employee_name = ?, kind = ?, action = ?, status = ?, start_date = ?, end_date = ?, record_date = ?, submitted_at = ?, updated_at = ?, issue = ?, payload_json = ? WHERE record_id = ?`)
    .bind(input.ownerUpn, input.employeeName, input.kind, input.action, input.status, input.startDate, input.endDate, input.recordDate, input.submittedAt, input.updatedAt, input.issue, input.payloadJson, input.recordId).run();
  return { created: false, changed };
}

async function deleteRecord(env, existing, identity) {
  validatePortalRequestDeletion(existing);
  const deletableStatuses = new Set(['draft', 'pending delivery', 'delivery failed']);
  if (!identity.isAdmin && !deletableStatuses.has(String(existing.status || '').toLowerCase())) {
    throw Object.assign(new Error('Submitted records cannot be deleted'), { status: 409 });
  }
  const previousVersion = JSON.stringify({
      employee_name: existing.employee_name,
      kind: existing.kind,
      action: existing.action,
      status: existing.status,
      start_date: existing.start_date,
      end_date: existing.end_date,
      record_date: existing.record_date,
      submitted_at: existing.submitted_at,
      updated_at: existing.updated_at,
      issue: existing.issue,
      payload: payloadObject(existing)
    });
  if (existing.kind === 'timesheets') {
    // A delivery may be claimed after the route read this record. Keep the
    // source, its prior version and the queue transition in one transaction.
    const timestamp = now();
    const update = env.DB.prepare(`UPDATE records SET status='Deleted',issue=?,payload_json='{}',updated_at=?
      WHERE record_id=? AND owner_oid IS ? AND owner_upn IS ? AND employee_name IS ? AND kind IS ? AND action IS ?
        AND status IS ? AND start_date IS ? AND end_date IS ? AND record_date IS ? AND submitted_at IS ?
        AND updated_at IS ? AND issue IS ? AND payload_json IS ?
        AND (?=1 OR NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=records.record_id))
        AND NOT EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=records.record_id AND q.status NOT IN ('queued','skipped'))`)
      .bind('Deleted by ' + identity.upn,timestamp,existing.record_id,existing.owner_oid,existing.owner_upn,existing.employee_name,existing.kind,existing.action,existing.status,existing.start_date??null,existing.end_date??null,existing.record_date??null,existing.submitted_at,existing.updated_at,existing.issue??null,existing.payload_json,identity.isSubmissionAdmin === true || (identity.isAdmin === true && identity.isTimesheetViewer === true) ? 1 : 0);
    const version = env.DB.prepare('INSERT INTO record_versions (record_id,owner_oid,payload_json,changed_at,changed_by_oid) SELECT ?,?,?,?,? WHERE changes()=1')
      .bind(existing.record_id,existing.owner_oid,previousVersion,timestamp,identity.oid);
    const retire = env.DB.prepare("UPDATE dispatch_queue SET status='skipped',updated_at=?,last_error='Correction deleted before delivery.' WHERE record_id=? AND status='queued' AND changes()=1")
      .bind(timestamp,existing.record_id);
    const result = await env.DB.batch([update,version,retire]);
    if (Number(result?.[0]?.meta?.changes || 0) < 1) throw Object.assign(new Error('The timesheet changed or its workbook delivery needs review. Refresh and check its status before deleting.'), { status: 409 });
    return { deleted: true, soft_deleted: true };
  }
  await env.DB.prepare('INSERT INTO record_versions (record_id, owner_oid, payload_json, changed_at, changed_by_oid) VALUES (?, ?, ?, ?, ?)')
    .bind(existing.record_id, existing.owner_oid, previousVersion, now(), identity.oid).run();
  await env.DB.prepare("UPDATE records SET status = 'Deleted', issue = ?, payload_json = ?, updated_at = ? WHERE record_id = ?")
    .bind('Deleted by ' + identity.upn, '{}', now(), existing.record_id).run();
  return { deleted: true, soft_deleted: true };
}
__name(deleteRecord, "deleteRecord");
async function readJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY_BYTES) throw Object.assign(new Error("Request is too large"), { status: 413 });
  const textBody = await request.text();
  if (textBody.length > MAX_BODY_BYTES) throw Object.assign(new Error("Request is too large"), { status: 413 });
  try {
    const body = JSON.parse(textBody || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("JSON object expected");
    return body;
  } catch (_) {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 });
  }
}
__name(readJson, "readJson");
async function readBoundedJson(request, maximumBytes) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) throw Object.assign(new Error("Request is too large"), { status: 413 });
  const reader = request.body?.getReader();
  const chunks = [];
  let byteLength = 0;
  if (reader) {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      byteLength += part.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        throw Object.assign(new Error("Request is too large"), { status: 413 });
      }
      chunks.push(part.value);
    }
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  try {
    const value2 = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value2 || typeof value2 !== "object" || Array.isArray(value2)) throw new Error("JSON object expected");
    return value2;
  } catch (_) {
    throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 });
  }
}
__name(readBoundedJson, "readBoundedJson");
function parseQueuedAttachments(body) {
  const raw = body && Array.isArray(body.attachments) ? body.attachments : [];
  if (raw.length < 2 || raw.length > ATTACHMENT_FIELDS.size) {
    throw Object.assign(new Error("The correction must include its XLSX and CSV attachments"), { status: 400 });
  }
  const seen = /* @__PURE__ */ new Set();
  let totalBytes = 0;
  const attachments = raw.map((item) => {
    if (!item || typeof item !== "object") throw Object.assign(new Error("Invalid attachment"), { status: 400 });
    const fieldName = text2(item.fieldName || item.field_name, "", 80);
    if (!ATTACHMENT_FIELDS.has(fieldName) || seen.has(fieldName)) throw Object.assign(new Error("Unsupported or duplicate attachment field"), { status: 400 });
    seen.add(fieldName);
    const fileName = safeAttachmentName(item.fileName || item.file_name);
    const contentType = attachmentType(fieldName, fileName, item.contentType || item.content_type);
    const contentBase64 = String(item.contentBase64 || item.content_base64 || "");
    const sizeBytes = base64ByteLength(contentBase64);
    if (!fileName || !contentType || sizeBytes < 1 || sizeBytes > MAX_ATTACHMENT_BYTES2) {
      throw Object.assign(new Error("Invalid or oversized attachment"), { status: 400 });
    }
    totalBytes += sizeBytes;
    if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES2) throw Object.assign(new Error("Correction attachments are too large"), { status: 413 });
    return { fieldName, fileName, contentType, contentBase64, sizeBytes };
  });
  if (!seen.has("attachment") || !seen.has("attachment_csv")) {
    throw Object.assign(new Error("Both XLSX and CSV attachments are required"), { status: 400 });
  }
  return attachments;
}
__name(parseQueuedAttachments, "parseQueuedAttachments");
function queueRecordAttachments(env, record, body) {
  const payload = payloadObject(record);
  if (syntheticRecord(record, payload)) {
    return { queued: false, skipped: true, reason: "synthetic-test-record" };
  }
  const attachments = parseQueuedAttachments(body);
  if (record.action === "pay_month_correction" && !attachments.some((attachment) => attachment.fieldName === "attachment_record")) {
    throw Object.assign(new Error("Pay-month corrections require a dated JSON record attachment for workbook filing"), { status: 400 });
  }
  const timestamp = now();
  if (record.kind === "timesheets") {
    return (async () => {
      const guard = `EXISTS (SELECT 1 FROM records r WHERE r.record_id=? AND r.payload_json IS ? AND r.owner_oid IS ? AND r.owner_upn IS ? AND r.employee_name IS ? AND r.action IS ? AND r.start_date IS ? AND r.end_date IS ? AND r.record_date IS ? AND r.submitted_at IS ? AND r.issue IS ? AND r.updated_at IS ? AND r.status IS ? AND r.kind='timesheets')
        AND NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=?)
        AND NOT EXISTS (SELECT 1 FROM dispatch_queue q WHERE q.record_id=? AND (q.status <> 'queued' OR q.attempts<>0 OR q.last_sent_at IS NOT NULL))`;
      const args = [record.record_id,record.payload_json,record.owner_oid,record.owner_upn,record.employee_name??null,record.action??null,record.start_date??null,record.end_date??null,record.record_date??null,record.submitted_at??null,record.issue??null,record.updated_at,record.status,record.record_id,record.record_id];
      const stmts=[env.DB.prepare(`DELETE FROM record_attachments WHERE record_id=? AND ${guard}`).bind(record.record_id,...args),
        ...attachments.map(a=>env.DB.prepare(`INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at)
          SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(record.record_id,a.fieldName,a.fileName,a.contentType,a.contentBase64,a.sizeBytes,timestamp,...args)),
        env.DB.prepare(`INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at,last_sent_at,last_error)
          SELECT ?,'queued',?,?,0,?,NULL,NULL WHERE ${guard}
          ON CONFLICT(record_id) DO UPDATE SET status='queued',queued_at=excluded.queued_at,updated_at=excluded.updated_at,attempts=0,next_attempt_at=excluded.next_attempt_at,last_sent_at=NULL,last_error=NULL`).bind(record.record_id,timestamp,timestamp,timestamp,...args),
        env.DB.prepare(`UPDATE records SET status='Queued for Accounts',issue='',updated_at=? WHERE record_id=? AND ${guard}`).bind(timestamp,record.record_id,...args)];
      const result=await env.DB.batch(stmts);
      if(Number(result?.[result.length-1]?.meta?.changes||0)<1) throw Object.assign(new Error('The timesheet changed or needs ownership review.'),{status:409});
      return {queued:true,recordId:record.record_id,attachments:attachments.length,queuedAt:timestamp};
    })();
  }
  const statements = [
    env.DB.prepare("DELETE FROM record_attachments WHERE record_id = ?").bind(record.record_id),
    ...attachments.map((attachment) => env.DB.prepare(`INSERT INTO record_attachments (record_id, field_name, file_name, content_type, content_base64, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(record.record_id, attachment.fieldName, attachment.fileName, attachment.contentType, attachment.contentBase64, attachment.sizeBytes, timestamp)),
    env.DB.prepare(`INSERT INTO dispatch_queue (record_id, status, queued_at, updated_at, attempts, next_attempt_at, last_sent_at, last_error)
      VALUES (?, 'queued', ?, ?, 0, ?, NULL, NULL)
      ON CONFLICT(record_id) DO UPDATE SET status = 'queued', queued_at = excluded.queued_at,
        updated_at = excluded.updated_at, attempts = 0, next_attempt_at = excluded.next_attempt_at,
        last_sent_at = NULL, last_error = NULL`).bind(record.record_id, timestamp, timestamp, timestamp),
    env.DB.prepare("UPDATE records SET status = 'Queued for Accounts', issue = '', updated_at = ? WHERE record_id = ?").bind(timestamp, record.record_id)
  ];
  return env.DB.batch(statements).then(() => ({ queued: true, recordId: record.record_id, attachments: attachments.length, queuedAt: timestamp }));
}
__name(queueRecordAttachments, "queueRecordAttachments");
function dispatchEndpoint(env) {
  const endpoint = text2(env.FORM_SUBMIT_TIMESHEET_ENDPOINT, "", 2e3);
  if (!endpoint) return "";
  if (/^https:\/\/formsubmit\.co\/ajax\//i.test(endpoint)) return endpoint;
  if (/^https:\/\/formsubmit\.co\//i.test(endpoint)) return endpoint.replace("https://formsubmit.co/", "https://formsubmit.co/ajax/");
  return endpoint;
}
__name(dispatchEndpoint, "dispatchEndpoint");
function submissionKeyPart(value2) {
  return text2(value2, "unknown", 240).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}
__name(submissionKeyPart, "submissionKeyPart");
function decodeBase64(value2) {
  const candidate = String(value2 || "");
  const binary = atob(candidate);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
__name(decodeBase64, "decodeBase64");
function dispatchForm(record, attachments, payPeriods2 = defaultPayPeriods()) {
  const payload = payloadObject(record);
  const calendarSync = payload.calendarSync && typeof payload.calendarSync === "object" ? payload.calendarSync : {};
  const totals = payload.totals && typeof payload.totals === "object" ? payload.totals : {};
  const events = Array.isArray(calendarSync.events) ? calendarSync.events : [];
  const isSynthetic = syntheticRecord(record, payload);
  const employeeName = text2(record.employee_name || payload.employeeName || record.owner_upn, record.owner_upn, 240);
  const employeeEmail = text2(isSynthetic ? payload.employeeEmail || record.owner_upn : record.owner_upn, record.owner_upn, 320);
  const employeeUpn = text2(isSynthetic ? payload.employeeUpn || record.owner_upn : record.owner_upn, record.owner_upn, 320);
  const weekStart = text2(payload.weekStart || record.start_date, "", 80);
  const weekEnd = text2(payload.weekEnd || record.end_date || weekStart, weekStart, 80);
  const declaredMonth = text2(payload.payMonth || payload.pay_month, "", 7);
  const calculatedMonth = payMonthForPayload(payload, weekStart, payPeriods2);
  const month = record.action === "pay_month_correction" && /^\d{4}-\d{2}$/.test(declaredMonth) ? declaredMonth : calculatedMonth || declaredMonth || "unspecified";
  const period = /^\d{4}-\d{2}$/.test(month) && payPeriods2 && typeof payPeriods2.periodForMonth === "function" ? payPeriods2.periodForMonth(month) : null;
  const cycleStart = text2(payload.cycleStart || period?.start, "", 10);
  const cycleEnd = text2(payload.cycleEnd || period?.cycleEnd, "", 10);
  const payrollFriday = text2(payload.payrollFriday || period?.payrollFriday || period?.payrollEnd || period?.end, "", 10);
  const workbookKey = `timesheet-${submissionKeyPart(employeeUpn || employeeEmail || employeeName)}-${month}`;
  const form = new FormData();
  const set = /* @__PURE__ */ __name((name, value2) => form.set(name, String(value2 == null ? "" : value2)), "set");
  set("_subject", `[GMT][TIMESHEET][CORRECTION] ${employeeName} | Week ${weekStart || "unspecified"}`);
  set("_template", "box");
  set("_captcha", "false");
  set("_url", "https://gmt-services.co.uk/portal/submissions");
  set("_replyto", employeeEmail);
  set("email", employeeEmail);
  set("employee_name", employeeName);
  set("gmt_type", "timesheet");
  set("gmt_action", "correction");
  set("gmt_schema_version", "1");
  set("gmt_record_id", record.record_id);
  set("gmt_submission_id", record.record_id);
  set("gmt_workbook_key", workbookKey);
  set("gmt_pay_month", month);
  set("gmt_filing_mode", "monthly-upsert");
  set("gmt_employee", employeeName);
  set("gmt_employee_upn", employeeUpn);
  set("gmt_week_start", weekStart);
  set("gmt_week_end", weekEnd);
  set("gmt_cycle_start", cycleStart);
  set("gmt_cycle_end", cycleEnd);
  set("gmt_payroll_friday", payrollFriday);
  set("gmt_year", month.slice(0, 4));
  set("gmt_month", month.slice(5, 7));
  set("gmt_worked_hours", hours(totals.workedActual));
  set("gmt_basic_hours", hours(totals.basic));
  set("gmt_ot15_hours", hours(totals.ot15));
  set("gmt_ot20_hours", hours(totals.ot20));
  set("gmt_absence_count", events.filter((event) => event && event.type === "absence").length);
  set("gmt_calendar_sync", "requested");
  set("gmt_calendar_name", text2(calendarSync.calendarName, "GMT Operational Calendar", 240));
  set("gmt_calendar_event_count", events.length);
  set("gmt_daily_rows", JSON.stringify(Array.isArray(payload.rows) ? payload.rows : []));
  set("gmt_calendar_sync_payload", JSON.stringify(calendarSync));
  const attachmentManifest = attachments.map((attachment) => attachment.field_name || attachment.fieldName).map((fieldName) => ({
    attachment: "xlsx",
    attachment_csv: "csv",
    attachment_record: "record-json",
    attachment_calendar_sync: "calendar-sync-json"
  })[fieldName] || fieldName).filter(Boolean);
  set("gmt_attachment_manifest", attachmentManifest.join(","));
  set("gmt_submitted_at", text2(calendarSync.submittedAt || record.submitted_at, record.submitted_at, 100));
  set("summary", `Worked ${(Number(totals.workedActual) / 60 || 0).toFixed(2)}h | Basic ${(Number(totals.basic) / 60 || 0).toFixed(2)}h | OT x1.5 ${(Number(totals.ot15) / 60 || 0).toFixed(2)}h | OT x2.0 ${(Number(totals.ot20) / 60 || 0).toFixed(2)}h`);
  set("message", `Corrected timesheet attachments for ${employeeName}, week ${weekStart || "unspecified"}. The existing Record ID is retained for idempotent filing.`);
  attachments.forEach((attachment) => {
    const fieldName = attachment.field_name || attachment.fieldName;
    const contentType = attachment.content_type || attachment.contentType;
    const fileName = attachment.file_name || attachment.fileName;
    const bytes = decodeBase64(attachment.content_base64 || attachment.contentBase64);
    form.append(fieldName, new Blob([bytes], { type: contentType }), fileName);
  });
  return form;
}
__name(dispatchForm, "dispatchForm");
function retryAt(timestamp, attempts) {
  const delay = Math.min(24 * 60 * 60 * 1e3, 5 * 60 * 1e3 * 2 ** Math.min(Math.max(attempts - 1, 0), 7));
  return new Date(new Date(timestamp).getTime() + delay).toISOString();
}
__name(retryAt, "retryAt");
function rateLimitRetryAt(timestamp, retryAfter) {
  const start = new Date(timestamp).getTime();
  const value2 = String(retryAfter || "").trim();
  const seconds = /^\d+$/.test(value2) ? Number(value2) : NaN;
  const target = Number.isFinite(seconds) ? start + seconds * 1e3 : Date.parse(value2);
  const delay = Number.isFinite(target) ? target - start : 60 * 60 * 1e3;
  return new Date(start + Math.max(5 * 60 * 1e3, Math.min(delay, 24 * 60 * 60 * 1e3))).toISOString();
}
__name(rateLimitRetryAt, "rateLimitRetryAt");
async function dispatchQueued(env, options = {}) {
  const endpoint = dispatchEndpoint(env);
  if (!endpoint) return { status: "not-configured", sent: 0, failed: 0, skipped: 0 };
  const payPeriods2 = await loadPayPeriods(env);
  const timestamp = options.now || now();
  const limit = Math.min(Math.max(Number(options.limit || MAX_QUEUE_BATCH), 1), MAX_QUEUE_BATCH);
  const targetRecordId = text2(options.recordId, "", MAX_RECORD_ID2);
  const result = await env.DB.prepare(`SELECT q.record_id, q.status AS dispatch_status, q.queued_at, q.updated_at AS dispatch_updated_at,
      q.attempts, q.next_attempt_at, q.last_sent_at, q.last_error, r.*
    FROM dispatch_queue q JOIN records r ON r.record_id = q.record_id
    WHERE q.status IN ('queued', 'failed') AND q.next_attempt_at <= ? AND r.status <> 'Deleted'
      AND (? = '' OR q.record_id = ?)
    ORDER BY q.queued_at ASC LIMIT ?`).bind(timestamp, targetRecordId, targetRecordId, limit).all();
  const summary = { status: "complete", sent: 0, failed: 0, skipped: 0, dryRun: Boolean(options.dryRun), records: [] };
  const rows = result.results || [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const payload = payloadObject(row);
    if (row.action === "pay_month_correction" && env.PAY_MONTH_REPLAY_READY !== "true") {
      summary.status = "awaiting-provider";
      summary.deferred = (summary.deferred || 0) + 1;
      summary.records.push({ recordId: row.record_id, status: "awaiting-provider" });
      continue;
    }
    if (options.dryRun) {
      summary.records.push({ recordId: row.record_id, status: syntheticRecord(row, payload) ? "skipped-dry-run" : "dry-run" });
      continue;
    }
    if (syntheticRecord(row, payload)) {
      await env.DB.prepare("UPDATE dispatch_queue SET status = 'skipped', updated_at = ?, last_error = ? WHERE record_id = ?").bind(timestamp, timestamp, "Synthetic test record was not dispatched").run();
      await env.DB.prepare("UPDATE records SET status = 'Test - not sent', issue = '', updated_at = ? WHERE record_id = ?").bind(timestamp, row.record_id).run();
      summary.skipped += 1;
      summary.records.push({ recordId: row.record_id, status: "skipped" });
      continue;
    }
    const claim = await env.DB.prepare(`UPDATE dispatch_queue SET status = 'sending', attempts = attempts + 1, updated_at = ?
      WHERE record_id = ? AND status IN ('queued', 'failed') AND next_attempt_at <= ?`).bind(timestamp, row.record_id, timestamp).run();
    if (Number(claim?.meta?.changes ?? 1) < 1) continue;
    try {
      const attachmentsResult = await env.DB.prepare(`SELECT field_name, file_name, content_type, content_base64, size_bytes
        FROM record_attachments WHERE record_id = ? ORDER BY field_name`).bind(row.record_id).all();
      const attachments = attachmentsResult.results || [];
      if (!attachments.some((attachment) => attachment.field_name === "attachment") || !attachments.some((attachment) => attachment.field_name === "attachment_csv")) {
        throw new Error("Queued correction attachments are incomplete");
      }
      if (row.action === "pay_month_correction" && !attachments.some((attachment) => attachment.field_name === "attachment_record")) {
        throw new Error("Queued pay-month correction is missing the dated JSON record attachment");
      }
      const response = await (options.fetchImpl || fetch)(endpoint, {
        method: "POST",
        body: dispatchForm(row, attachments, payPeriods2),
        headers: { Accept: "application/json" }
      });
      const responseText = await response.text();
      let body = null;
      try {
        body = responseText ? JSON.parse(responseText) : null;
      } catch (_) {
      }
      if (response.status === 429) {
        throw Object.assign(new Error("FormSubmit rate-limited the correction (429)"), {
          rateLimitedUntil: rateLimitRetryAt(timestamp, response.headers?.get?.("Retry-After"))
        });
      }
      if (!response.ok || body && (body.success === false || body.success === "false")) {
        throw new Error(`FormSubmit rejected the correction (${response.status})`);
      }
      await env.DB.prepare(`UPDATE dispatch_queue SET status = 'sent', updated_at = ?, last_sent_at = ?, last_error = NULL WHERE record_id = ?`).bind(timestamp, timestamp, row.record_id).run();
      await env.DB.prepare("UPDATE records SET status = 'Sent to Accounts', issue = '', updated_at = ? WHERE record_id = ?").bind(timestamp, row.record_id).run();
      summary.sent += 1;
      summary.records.push({ recordId: row.record_id, status: "sent" });
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const message = text2(error?.message, "Correction dispatch failed", 1e3);
      const nextAttempt = error?.rateLimitedUntil || retryAt(timestamp, attempts);
      await env.DB.prepare(`UPDATE dispatch_queue SET status = 'failed', updated_at = ?, next_attempt_at = ?, last_error = ? WHERE record_id = ?`).bind(timestamp, nextAttempt, message, row.record_id).run();
      await env.DB.prepare("UPDATE records SET status = 'Delivery failed', issue = ?, updated_at = ? WHERE record_id = ?").bind(message, timestamp, row.record_id).run();
      summary.failed += 1;
      summary.records.push({ recordId: row.record_id, status: "failed", error: message });
      if (error?.rateLimitedUntil) {
        summary.status = "rate-limited";
        summary.retryAt = nextAttempt;
        summary.deferred = 0;
        for (const remaining of rows.slice(index + 1)) {
          const delayed = await env.DB.prepare("UPDATE dispatch_queue SET updated_at = ?, next_attempt_at = ? WHERE record_id = ? AND status IN ('queued', 'failed')").bind(timestamp, nextAttempt, remaining.record_id).run();
          if (Number(delayed?.meta?.changes || 0) > 0) summary.deferred += 1;
        }
        break;
      }
    }
  }
  return summary;
}
__name(dispatchQueued, "dispatchQueued");
async function adminDispatchQueued(env, identity, options = {}) {
  if (!identity?.isAdmin) throw Object.assign(new Error("Correction replay is restricted to Accounts"), { status: 403 });
  return dispatchQueued(env, {
    dryRun: options.dryRun === true,
    now: options.now,
    fetchImpl: options.fetchImpl
  });
}
__name(adminDispatchQueued, "adminDispatchQueued");
var TIMESHEET_RECEIPT_EVENTS = /* @__PURE__ */ new Set(["flow_started", "workbook_verified", "flow_completed", "flow_failed"]);
var TIMESHEET_RECEIPT_FAILURE_STAGES = /* @__PURE__ */ new Set([
  "source_validation",
  "workbook_routing",
  "workbook_upsert",
  "workbook_readback",
  "history_index",
  "calendar_sync",
  "other"
]);
function receiptString(value2, label, maximum, pattern) {
  if (typeof value2 !== "string") throw Object.assign(new Error(`Invalid ${label}`), { status: 400 });
  const result = value2.trim();
  if (!result || result.length > maximum || /[\u0000-\u001f\u007f]/.test(result) || pattern && !pattern.test(result)) {
    throw Object.assign(new Error(`Invalid ${label}`), { status: 400 });
  }
  return result;
}
__name(receiptString, "receiptString");
function receiptTimestamp(value2) {
  const source = receiptString(
    value2,
    "run start time",
    48,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/
  );
  const milliseconds = Date.parse(source);
  if (!Number.isFinite(milliseconds)) throw Object.assign(new Error("Invalid run start time"), { status: 400 });
  if (milliseconds > Date.now() + 5 * 60 * 1e3) throw Object.assign(new Error("Run start time is in the future"), { status: 400 });
  return new Date(milliseconds).toISOString();
}
__name(receiptTimestamp, "receiptTimestamp");
function safeReceiptError(value2) {
  const source = receiptString(value2, "safe error", 1e3);
  return source.replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]").replace(/\b(access[_ -]?token|client[_ -]?secret|password)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]").replace(/\s+/g, " ").slice(0, 600);
}
__name(safeReceiptError, "safeReceiptError");
function parseTimesheetReceipt(body) {
  const allowed = /* @__PURE__ */ new Set([
    "recordId",
    "flowRunId",
    "runStartedAt",
    "event",
    "stage",
    "safeError",
    "created",
    "updated",
    "unchanged",
    "verifiedRows",
    "verifiedRecordIds"
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw Object.assign(new Error("Unsupported receipt fields"), { status: 400 });
  }
  const recordId = receiptString(body.recordId, "record ID", MAX_RECORD_ID2, /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
  const flowRunId = receiptString(body.flowRunId, "Power Automate run ID", 240, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  const runStartedAt = receiptTimestamp(body.runStartedAt);
  const event = receiptString(body.event, "receipt event", 40);
  if (!TIMESHEET_RECEIPT_EVENTS.has(event)) throw Object.assign(new Error("Unsupported receipt event"), { status: 400 });
  let evidence = {};
  if (event === "flow_failed") {
    if (Object.hasOwn(body, "created") || Object.hasOwn(body, "updated") || Object.hasOwn(body, "unchanged") || Object.hasOwn(body, "verifiedRows") || Object.hasOwn(body, "verifiedRecordIds")) {
      throw Object.assign(new Error("Unsupported failure evidence"), { status: 400 });
    }
    const stage = receiptString(body.stage, "failure stage", 40);
    if (!TIMESHEET_RECEIPT_FAILURE_STAGES.has(stage)) throw Object.assign(new Error("Unsupported failure stage"), { status: 400 });
    evidence = { stage, safeError: safeReceiptError(body.safeError) };
  } else if (event === "workbook_verified") {
    if (Object.hasOwn(body, "stage") || Object.hasOwn(body, "safeError")) throw Object.assign(new Error("Unsupported workbook evidence"), { status: 400 });
    const counts = {};
    ["created", "updated", "unchanged"].forEach((key) => {
      if (!Number.isSafeInteger(body[key]) || body[key] < 0 || body[key] > 62) {
        throw Object.assign(new Error(`Invalid ${key} row count`), { status: 400 });
      }
      counts[key] = body[key];
    });
    if (!Array.isArray(body.verifiedRows) || body.verifiedRows.length < 1 || body.verifiedRows.length > 62 || !Array.isArray(body.verifiedRecordIds) || body.verifiedRecordIds.length !== body.verifiedRows.length) {
      throw Object.assign(new Error("Invalid verified workbook rows"), { status: 400 });
    }
    const verifiedRows = body.verifiedRows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some((key) => !["recordId", "date"].includes(key))) {
        throw Object.assign(new Error("Invalid verified workbook row"), { status: 400 });
      }
      const verifiedRecordId = receiptString(row.recordId, "verified source row ID", 240, /^[A-Za-z0-9][A-Za-z0-9._:|-]*$/);
      const date = receiptString(row.date, "verified row date", 10, /^\d{4}-\d{2}-\d{2}$/);
      const dateMilliseconds = Date.parse(`${date}T00:00:00Z`);
      if (!Number.isFinite(dateMilliseconds) || new Date(dateMilliseconds).toISOString().slice(0, 10) !== date) {
        throw Object.assign(new Error("Invalid verified row date"), { status: 400 });
      }
      return { recordId: verifiedRecordId, date };
    });
    const ids = body.verifiedRecordIds.map((value2) => receiptString(value2, "verified source row ID", 240, /^[A-Za-z0-9][A-Za-z0-9._:|-]*$/));
    const rowKeys = verifiedRows.map((row) => `${row.recordId}\0${row.date}`);
    const uniqueKeys = new Set(rowKeys);
    const uniqueIds = new Set(ids);
    if (uniqueKeys.size !== verifiedRows.length || uniqueIds.size !== ids.length || ids.some((id) => !verifiedRows.some((row) => row.recordId === id)) || verifiedRows.some((row) => !ids.includes(row.recordId)) || counts.created + counts.updated + counts.unchanged !== verifiedRows.length) {
      throw Object.assign(new Error("Workbook verification evidence is inconsistent"), { status: 400 });
    }
    evidence = { ...counts, verifiedRows };
  } else if (Object.keys(body).some((key) => ["stage", "safeError", "created", "updated", "unchanged", "verifiedRows", "verifiedRecordIds"].includes(key))) {
    throw Object.assign(new Error("Unsupported receipt evidence"), { status: 400 });
  }
  return { recordId, flowRunId, runStartedAt, event, evidence };
}
__name(parseTimesheetReceipt, "parseTimesheetReceipt");
function validReceiptDate(value2) {
  return typeof value2 === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value2) && Number.isFinite(Date.parse(`${value2}T00:00:00Z`)) && new Date(Date.parse(`${value2}T00:00:00Z`)).toISOString().slice(0, 10) === value2;
}
__name(validReceiptDate, "validReceiptDate");
async function expectedCorrectionRows(env, recordId) {
  const row = await env.DB.prepare(`SELECT r.record_id, r.kind, r.action, r.status, a.content_base64
    FROM records r JOIN dispatch_queue q ON q.record_id = r.record_id
    JOIN record_attachments a ON a.record_id = r.record_id AND a.field_name = 'attachment_record'
    WHERE r.record_id = ? AND r.kind = 'timesheets' AND r.action = 'pay_month_correction'
      AND r.status <> 'Deleted'`).bind(recordId).first();
  if (!row || row.status === "Deleted") throw Object.assign(new Error("Timesheet correction not found"), { status: 404 });
  const encoded = String(row.content_base64 || "");
  if (!encoded || encoded.length > 3e5) throw Object.assign(new Error("Correction source attachment is unavailable"), { status: 409 });
  let envelope;
  try {
    envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64(encoded)));
  } catch (_) {
    throw Object.assign(new Error("Correction source attachment is invalid"), { status: 409 });
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || envelope.mode !== "replace-pay-month" || String(envelope.recordId || "") !== recordId || !Array.isArray(envelope.rows) || envelope.rows.length > 62) {
    throw Object.assign(new Error("Correction source rows are invalid"), { status: 409 });
  }
  const expectedRows = envelope.rows.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || !validReceiptDate(entry.date)) {
      throw Object.assign(new Error("Correction source rows are invalid"), { status: 409 });
    }
    const date = entry.date;
    const expectedRecordId = `${recordId}|${date}`;
    const entryRecordId = String(entry.recordId || entry.record_id || expectedRecordId);
    if (entryRecordId !== expectedRecordId) throw Object.assign(new Error("Correction source row identity is invalid"), { status: 409 });
    return { recordId: expectedRecordId, date };
  }).sort((left, right) => left.date.localeCompare(right.date));
  if (new Set(expectedRows.map((entry) => entry.date)).size !== expectedRows.length) {
    throw Object.assign(new Error("Correction source dates are not unique"), { status: 409 });
  }
  return expectedRows;
}
__name(expectedCorrectionRows, "expectedCorrectionRows");
async function timesheetDeliveryReceiptEndpoint(request, env, origin = "") {
  if (!env.DB) throw Object.assign(new Error("Receipt service is unavailable"), { status: 503, publicMessage: "Receipt service is unavailable" });
  const configuredKey = String(env.TIMESHEET_DELIVERY_CALLBACK_KEY || "");
  if (configuredKey.length < 32 || configuredKey.length > 500) {
    throw Object.assign(new Error("Receipt service is unavailable"), { status: 503, publicMessage: "Receipt service is unavailable" });
  }
  const suppliedKey = request.headers.get("X-GMT-Delivery-Key") || "";
  if (suppliedKey.length > 500 || !constantTimeEqual(suppliedKey, configuredKey)) {
    throw Object.assign(new Error("Not authorised"), { status: 401, publicMessage: "Not authorised" });
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw Object.assign(new Error("JSON content type required"), { status: 415 });
  }
  const body = parseTimesheetReceipt(await readBoundedJson(request, MAX_TIMESHEET_RECEIPT_BYTES));
  const target = await env.DB.prepare(`SELECT r.record_id FROM records r
    JOIN dispatch_queue q ON q.record_id = r.record_id
    WHERE r.record_id = ? AND r.kind = 'timesheets' AND r.action = 'pay_month_correction'
      AND r.status <> 'Deleted'`).bind(body.recordId).first();
  if (!target) throw Object.assign(new Error("Timesheet correction not found"), { status: 404 });
  if (body.event === "workbook_verified" || body.event === "flow_completed") {
    const priorEvents = await env.DB.prepare(`SELECT event_type FROM timesheet_delivery_receipts
      WHERE record_id = ? AND flow_run_id = ? AND event_type IN ('flow_started', 'workbook_verified')`).bind(body.recordId, body.flowRunId).all();
    const eventTypes = new Set((priorEvents.results || []).map((row) => row.event_type));
    if (!eventTypes.has("flow_started") || body.event === "flow_completed" && !eventTypes.has("workbook_verified")) {
      throw Object.assign(new Error("Receipt events are out of order"), { status: 409 });
    }
  }
  if (body.event === "workbook_verified") {
    const expectedRows = await expectedCorrectionRows(env, body.recordId);
    const actualRows = body.evidence.verifiedRows;
    const expectedKeys = expectedRows.map((entry) => `${entry.recordId}\0${entry.date}`).sort();
    const actualKeys = actualRows.map((entry) => `${entry.recordId}\0${entry.date}`).sort();
    if (!expectedRows.length || expectedKeys.length !== actualKeys.length || expectedKeys.some((key, index) => key !== actualKeys[index]) || body.evidence.created + body.evidence.updated + body.evidence.unchanged !== expectedRows.length) {
      throw Object.assign(new Error("Workbook verification does not match the correction source"), { status: 409 });
    }
    body.evidence.verifiedRows = expectedRows;
  }
  const evidenceJson = JSON.stringify(body.evidence);
  if (evidenceJson.length > 32768) throw Object.assign(new Error("Receipt evidence is too large"), { status: 413 });
  const priorRun = await env.DB.prepare(`SELECT run_started_at FROM timesheet_delivery_receipts
    WHERE record_id = ? AND flow_run_id = ? LIMIT 1`).bind(body.recordId, body.flowRunId).first();
  if (priorRun && priorRun.run_started_at !== body.runStartedAt) {
    throw Object.assign(new Error("Receipt run start time conflict"), { status: 409 });
  }
  if (body.event === "flow_failed" || body.event === "flow_completed") {
    const opposite = body.event === "flow_failed" ? "flow_completed" : "flow_failed";
    const terminal = await env.DB.prepare(`SELECT receipt_id FROM timesheet_delivery_receipts
      WHERE record_id = ? AND flow_run_id = ? AND event_type = ? LIMIT 1`).bind(body.recordId, body.flowRunId, opposite).first();
    if (terminal) throw Object.assign(new Error("Receipt terminal event conflict"), { status: 409 });
  }
  const existing = await env.DB.prepare(`SELECT run_started_at, evidence_json FROM timesheet_delivery_receipts
    WHERE record_id = ? AND flow_run_id = ? AND event_type = ? LIMIT 1`).bind(body.recordId, body.flowRunId, body.event).first();
  if (existing) {
    if (existing.run_started_at !== body.runStartedAt || existing.evidence_json !== evidenceJson) {
      throw Object.assign(new Error("Conflicting duplicate receipt"), { status: 409 });
    }
    return json({ accepted: true }, 200, origin);
  }
  const terminalEvent = await env.DB.prepare(`SELECT event_type FROM timesheet_delivery_receipts
    WHERE record_id = ? AND flow_run_id = ? AND event_type IN ('flow_completed', 'flow_failed') LIMIT 1`).bind(body.recordId, body.flowRunId).first();
  if (terminalEvent) throw Object.assign(new Error("Receipt run is already terminal"), { status: 409 });
  const receivedAt = now();
  try {
    await env.DB.prepare(`INSERT INTO timesheet_delivery_receipts
      (record_id, flow_run_id, run_started_at, event_type, received_at, evidence_json)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM records r JOIN dispatch_queue q ON q.record_id = r.record_id
        WHERE r.record_id = ? AND r.kind = 'timesheets' AND r.action = 'pay_month_correction' AND r.status <> 'Deleted'
      )
      ON CONFLICT(record_id, flow_run_id, event_type) DO NOTHING`).bind(body.recordId, body.flowRunId, body.runStartedAt, body.event, receivedAt, evidenceJson, body.recordId).run();
  } catch (error) {
    if (/timesheet receipt (?:run start time|terminal event) conflict/i.test(String(error && error.message || ""))) {
      throw Object.assign(new Error("Conflicting receipt event"), { status: 409 });
    }
    throw error;
  }
  const stored = await env.DB.prepare(`SELECT run_started_at, evidence_json FROM timesheet_delivery_receipts
    WHERE record_id = ? AND flow_run_id = ? AND event_type = ? LIMIT 1`).bind(body.recordId, body.flowRunId, body.event).first();
  if (!stored) throw Object.assign(new Error("Timesheet correction not found"), { status: 404 });
  if (stored.run_started_at !== body.runStartedAt || stored.evidence_json !== evidenceJson) {
    throw Object.assign(new Error("Conflicting duplicate receipt"), { status: 409 });
  }
  return json({ accepted: true }, 200, origin);
}
__name(timesheetDeliveryReceiptEndpoint, "timesheetDeliveryReceiptEndpoint");
async function adminQueueStatus(env, identity) {
  if (!identity?.isAdmin) throw Object.assign(new Error("Correction queue status is restricted to Accounts"), { status: 403 });
  const result = await env.DB.prepare("SELECT q.record_id, q.status, q.attempts, q.queued_at, q.last_sent_at AS sent_at, q.updated_at, q.last_error AS error, r.employee_name, r.owner_upn, r.record_date, r.payload_json FROM dispatch_queue q JOIN records r ON r.record_id = q.record_id WHERE r.status <> 'Deleted' ORDER BY q.updated_at DESC, q.record_id ASC LIMIT 200").all();
  const rows = result.results || [];
  const receiptResult = await env.DB.prepare(`WITH queued_records AS (
      SELECT q.record_id FROM dispatch_queue q JOIN records r ON r.record_id = q.record_id
      WHERE r.status <> 'Deleted' ORDER BY q.updated_at DESC, q.record_id ASC LIMIT 200
    ), run_candidates AS (
      SELECT receipt.record_id, receipt.flow_run_id, receipt.run_started_at,
        MAX(receipt.received_at) AS last_received_at
      FROM timesheet_delivery_receipts receipt
      JOIN queued_records queued ON queued.record_id = receipt.record_id
      GROUP BY receipt.record_id, receipt.flow_run_id, receipt.run_started_at
    ), ranked_runs AS (
      SELECT record_id, flow_run_id, run_started_at,
        ROW_NUMBER() OVER (PARTITION BY record_id
          ORDER BY run_started_at DESC, last_received_at DESC, flow_run_id DESC) AS run_rank
      FROM run_candidates
    )
    SELECT receipt.record_id, receipt.flow_run_id, receipt.run_started_at,
      receipt.event_type, receipt.received_at, receipt.evidence_json
    FROM timesheet_delivery_receipts receipt
    JOIN ranked_runs latest ON latest.record_id = receipt.record_id
      AND latest.flow_run_id = receipt.flow_run_id
      AND latest.run_started_at = receipt.run_started_at
    WHERE latest.run_rank = 1
    ORDER BY receipt.record_id, receipt.received_at, receipt.receipt_id`).all();
  const latestRuns = /* @__PURE__ */ new Map();
  (receiptResult.results || []).forEach((receipt) => {
    let run = latestRuns.get(receipt.record_id);
    if (!run) {
      run = { flowRunId: text2(receipt.flow_run_id, "", 240), runStartedAt: text2(receipt.run_started_at, "", 40), events: {} };
      latestRuns.set(receipt.record_id, run);
    }
    let evidence = {};
    try {
      evidence = JSON.parse(String(receipt.evidence_json || "{}"));
    } catch (_) {
      evidence = {};
    }
    const event = text2(receipt.event_type, "", 40);
    const receivedAt = text2(receipt.received_at, "", 80);
    if (event === "flow_started" || event === "flow_completed") {
      run.events[event] = { receivedAt };
    } else if (event === "flow_failed") {
      run.events[event] = {
        receivedAt,
        stage: text2(evidence.stage, "", 40),
        safeError: text2(evidence.safeError, "", 600)
      };
    } else if (event === "workbook_verified") {
      run.events[event] = {
        receivedAt,
        created: Number(evidence.created || 0),
        updated: Number(evidence.updated || 0),
        unchanged: Number(evidence.unchanged || 0),
        verifiedRowCount: Array.isArray(evidence.verifiedRows) ? evidence.verifiedRows.length : 0
      };
    }
  });
  const counts = { queued: 0, sending: 0, failed: 0, sent: 0, skipped: 0 };
  const records = rows.map((row) => {
    const state = text2(row.status, "unknown", 40).toLowerCase();
    if (Object.hasOwn(counts, state)) counts[state] += 1;
    const payload = payloadObject(row);
    const dates = Array.isArray(payload.rows) ? payload.rows.map((entry) => text2(entry?.date, "", 10)).filter(Boolean) : [];
    if (!dates.length && Array.isArray(payload.deletedDays)) dates.push(...payload.deletedDays.map((date) => text2(date, "", 10)).filter(Boolean));
    if (!dates.length && row.record_date) dates.push(text2(row.record_date, "", 10));
    return {
      recordId: text2(row.record_id, "", MAX_RECORD_ID2),
      employeeName: text2(row.employee_name || row.owner_upn, "Timesheet correction", 240),
      date: dates.join(", "),
      status: state,
      attempts: Number(row.attempts || 0),
      queuedAt: text2(row.queued_at, "", 80),
      sentAt: text2(row.sent_at, "", 80),
      updatedAt: text2(row.updated_at, "", 80),
      error: text2(row.error, "", 1e3),
      deliveryReceipt: latestRuns.get(row.record_id) || null
    };
  });
  const endpointConfigured = Boolean(dispatchEndpoint(env));
  return {
    providerStatus: !endpointConfigured ? "not-configured" : env.PAY_MONTH_REPLAY_READY === "true" ? "ready" : "awaiting-workbook-route",
    counts,
    records,
    truncated: rows.length === 200
  };
}
__name(adminQueueStatus, "adminQueueStatus");
function requireXeroAdmin(identity) {
  if (!identity?.isXeroAdmin) throw Object.assign(new Error("Xero access is restricted to approved Accounts users"), { status: 403 });
}
__name(requireXeroAdmin, "requireXeroAdmin");
function requireEstimateArchiveAccess(identity) {
  if (!identity?.isAdmin) throw Object.assign(new Error("Estimate archive access is restricted to portal administrators"), { status: 403 });
}
__name(requireEstimateArchiveAccess, "requireEstimateArchiveAccess");
async function adminUsersEndpoint(request, env, identity, origin) {
  if (!identity?.isAdmin) throw Object.assign(new Error("User management is restricted to portal administrators"), { status: 403 });
  if (request.method === "GET") {
    const result = await env.DB.prepare(`SELECT owner_oid, owner_upn, display_name, role, created_at, updated_at
      FROM portal_access_assignments ORDER BY owner_upn, role`).all();
    const names = new Map(staffDirectory(env).map((entry) => [entry.upn, entry.name]));
    const configured = [];
    for (const [role2, variable] of [["admin", "ADMIN_UPNS"], ["admin", "ADDITIONAL_ADMIN_UPNS"], ["submissions", "SUBMISSIONS_ADMIN_UPNS"], ["hr", "HR_ADMIN_UPNS"], ["timesheets", "TIMESHEET_VIEWER_UPNS"], ["xero", "XERO_ADMIN_UPNS"], ["operations", "OPERATIONS_ADMIN_UPNS"], ["job-card", "JOB_CARD_ADMIN_UPNS"], ["offsite-duty-manager", "OFFSITE_DUTY_MANAGER_UPNS"]]) {
      for (const upn2 of csvSet(env[variable])) configured.push({ owner_upn: upn2, display_name: names.get(upn2) || upn2, role: role2, updated_at: "Worker configuration", managed: false });
    }
    if (csvSet(env.ADMIN_GROUP_IDS).size) configured.push({ owner_upn: "Configured Entra group", display_name: "GMT portal administrator group", role: "admin", updated_at: "Entra group configuration", managed: false });
    return json({ users: result.results || [], configured, allowedRoles: ["hr", "xero", "operations", "job-card"] }, 200, origin || "");
  }
  const body = await readJson(request);
  const upn = text2(body.upn, "", 254).toLowerCase();
  const oid = text2(body.oid, "", 80).toLowerCase();
  const name = text2(body.name, "", 160);
  const role = text2(body.role, "", 40);
  const action = text2(body.action, "grant", 20);
  if (!/^[^\s@]+@gmt-services\.co\.uk$/.test(upn) || !/^[0-9a-f-]{16,80}$/.test(oid)) {
    throw Object.assign(new Error("Enter the exact GMT sign-in address and Microsoft Entra object ID"), { status: 400 });
  }
  if (!["hr", "xero", "operations", "job-card"].includes(role)) throw Object.assign(new Error("This role cannot be assigned here"), { status: 400 });
  if (!["grant", "revoke"].includes(action)) throw Object.assign(new Error("Choose grant or revoke"), { status: 400 });
  const timestamp = now();
  const auditId = randomBase64Url(18);
  const statement = action === "grant" ? env.DB.prepare(`INSERT INTO portal_access_assignments (owner_oid, owner_upn, display_name, role, created_by_oid, created_by_upn, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_oid, role) DO UPDATE SET owner_upn=excluded.owner_upn,
      display_name=excluded.display_name, updated_at=excluded.updated_at`).bind(oid, upn, name, role, identity.oid, identity.upn, timestamp, timestamp) : env.DB.prepare("DELETE FROM portal_access_assignments WHERE owner_oid = ? AND owner_upn = ? AND role = ?").bind(oid, upn, role);
  await env.DB.batch([statement, env.DB.prepare(`INSERT INTO portal_access_audit
    (audit_id, actor_oid, actor_upn, target_oid, target_upn, role, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(auditId, identity.oid, identity.upn, oid, upn, role, action, timestamp)]);
  const current = await env.DB.prepare(`SELECT owner_oid, owner_upn, display_name, role, created_at, updated_at
    FROM portal_access_assignments WHERE owner_oid = ? AND owner_upn = ? ORDER BY role`).bind(oid, upn).all();
  return json({ ok: true, user: current.results || [] }, 200, origin || "");
}
__name(adminUsersEndpoint, "adminUsersEndpoint");
async function payMonthStartsEndpoint(request, env, identity, origin) {
  const payPeriods2 = await loadPayPeriods(env);
  const today = londonDateKey();
  const currentMonthKey = payPeriods2.payMonthKeyForDate(today);
  const currentPeriod = payPeriods2.periodForMonth(currentMonthKey);
  const nextMonthKey = currentPeriod ? payPeriods2.payMonthKeyForDate(currentPeriod.nextStart) : "";
  const nextPeriod = payPeriods2.periodForMonth(nextMonthKey);
  const settings = /* @__PURE__ */ __name(() => ({
    startDates: payPeriods2.getStartDates(),
    canManage: identity.canManagePayMonthStarts === true,
    currentMonthKey,
    currentStart: currentPeriod && currentPeriod.start || "",
    nextMonthKey,
    nextStart: nextPeriod && nextPeriod.start || ""
  }), "settings");
  if (request.method === "GET") return json(settings(), 200, origin || "");
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin || "");
  if (!identity.canManagePayMonthStarts) throw Object.assign(new Error("Pay-month start changes are restricted to approved Accounts users"), { status: 403 });
  const body = await readJson(request);
  const monthKey = text2(body.monthKey, "", 7);
  const startDate = text2(body.startDate, "", 10);
  const expectedOldStart = text2(body.expectedOldStart, "", 10);
  if (![currentMonthKey, nextMonthKey].includes(monthKey)) throw Object.assign(new Error("Choose the current or next pay month"), { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !payPeriods2.periodForDate(startDate)) throw Object.assign(new Error("Choose a valid calendar date"), { status: 400 });
  const oldPeriod = payPeriods2.periodForMonth(monthKey);
  if (!oldPeriod || oldPeriod.start !== expectedOldStart) throw Object.assign(new Error("This pay-month boundary changed since you opened the calendar. Reload and review it again."), { status: 409 });
  const previousMonthKey = payPeriods2.previousPayMonthKey(monthKey);
  const previousPeriod = payPeriods2.periodForMonth(previousMonthKey);
  const lowerBound = previousPeriod && previousPeriod.start || "";
  const upperBound = monthKey === currentMonthKey ? nextPeriod && nextPeriod.start || oldPeriod.nextStart : nextPeriod && nextPeriod.nextStart || oldPeriod.nextStart;
  if (lowerBound && startDate <= lowerBound || upperBound && startDate >= upperBound) {
    throw Object.assign(new Error(`Choose a date after ${lowerBound || "the previous pay-month start"} and before ${upperBound || "the following pay-month start"}`), { status: 400 });
  }
  if (monthKey === currentMonthKey && startDate > today) throw Object.assign(new Error("The current pay-month start cannot be in the future"), { status: 400 });
  if (monthKey === nextMonthKey && startDate <= today) throw Object.assign(new Error("The next pay-month start must be in the future"), { status: 400 });
  const proposedStarts = { ...payPeriods2.getStartDates(), [monthKey]: startDate };
  const proposedPeriods = defaultPayPeriods().createPayPeriods(proposedStarts);
  if (proposedPeriods.payMonthKeyForDate(today) !== currentMonthKey || proposedPeriods.payMonthKeyForDate(startDate) !== monthKey || proposedPeriods.periodForDate(startDate)?.start !== startDate) {
    throw Object.assign(new Error("That date would move the active pay-month window. Choose another date within the current or next pay-month range."), { status: 400 });
  }
  if (startDate === oldPeriod.start) return json({ ok: true, changed: false, ...settings() }, 200, origin || "");
  const timestamp = now();
  const auditId = randomBase64Url(18);
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO pay_month_start_settings (month_key, start_date, actor_oid, actor_upn, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(month_key) DO UPDATE SET start_date=excluded.start_date, actor_oid=excluded.actor_oid,
        actor_upn=excluded.actor_upn, updated_at=excluded.updated_at
      WHERE pay_month_start_settings.start_date = ?`).bind(monthKey, startDate, identity.oid, identity.upn, timestamp, expectedOldStart),
    env.DB.prepare(`INSERT INTO pay_month_start_audit (audit_id, actor_oid, actor_upn, month_key, old_start_date, new_start_date, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? FROM pay_month_start_settings
      WHERE month_key = ? AND start_date = ? AND updated_at = ? AND actor_oid = ? AND actor_upn = ?`).bind(
      auditId,
      identity.oid,
      identity.upn,
      monthKey,
      oldPeriod.start,
      startDate,
      timestamp,
      monthKey,
      startDate,
      timestamp,
      identity.oid,
      identity.upn
    )
  ]);
  if (!(results[0] && results[0].meta && results[0].meta.changes > 0)) {
    throw Object.assign(new Error("This pay-month boundary changed while you were saving. Reload and review it again."), { status: 409 });
  }
  const updatedPeriods = await loadPayPeriods(env);
  const updatedCurrentMonthKey = updatedPeriods.payMonthKeyForDate(today);
  const updatedCurrentPeriod = updatedPeriods.periodForMonth(updatedCurrentMonthKey);
  const updatedNextMonthKey = updatedCurrentPeriod ? updatedPeriods.payMonthKeyForDate(updatedCurrentPeriod.nextStart) : "";
  const updatedNextPeriod = updatedPeriods.periodForMonth(updatedNextMonthKey);
  return json({
    ok: true,
    changed: true,
    startDates: updatedPeriods.getStartDates(),
    canManage: true,
    currentMonthKey: updatedCurrentMonthKey,
    currentStart: updatedCurrentPeriod && updatedCurrentPeriod.start || "",
    nextMonthKey: updatedNextMonthKey,
    nextStart: updatedNextPeriod && updatedNextPeriod.start || ""
  }, 200, origin || "");
}
__name(payMonthStartsEndpoint, "payMonthStartsEndpoint");
function xeroRedirectResponse(returnUrl, result, reason = "", tenantName = "") {
  const target = new URL(returnUrl || XERO_DEFAULT_RETURN_URL);
  target.searchParams.set("xero", result);
  if (reason) target.searchParams.set("xero_reason", reason);
  if (tenantName) target.searchParams.set("xero_tenant", tenantName);
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.href,
      "Set-Cookie": xeroStateCookie("", 0),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}
__name(xeroRedirectResponse, "xeroRedirectResponse");
async function startXeroConnection(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const settings = xeroSettings(env);
  if (!settings.configured) return json({ error: "Xero is not configured on the portal service" }, 503, origin || "");
  const state = randomBase64Url(32);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1e3).toISOString();
  await env.DB.prepare("DELETE FROM xero_oauth_states WHERE expires_at <= ? OR consumed_at IS NOT NULL").bind(createdAt).run();
  await env.DB.prepare(`INSERT INTO xero_oauth_states (state_hash, owner_oid, owner_upn, return_url, created_at, expires_at, consumed_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL)`).bind(await sha256Base64Url(state), identity.oid, identity.upn, settings.returnUrl, createdAt, expiresAt).run();
  const authorization = new URL(settings.authUrl);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("client_id", settings.clientId);
  authorization.searchParams.set("redirect_uri", settings.redirectUri);
  authorization.searchParams.set("scope", settings.scopes);
  authorization.searchParams.set("state", state);
  return json({ ok: true, authorization_url: authorization.href, expires_at: expiresAt }, 200, origin || "", { "Set-Cookie": xeroStateCookie(state) });
}
__name(startXeroConnection, "startXeroConnection");
async function completeXeroConnection(request, env) {
  const settings = xeroSettings(env);
  const url = new URL(request.url);
  const state = text2(url.searchParams.get("state"), "", 500);
  const cookieState = xeroCookieState(request);
  const configuredReturn = settings.returnUrl;
  if (!settings.configured) return xeroRedirectResponse(configuredReturn, "error", "not-configured");
  if (url.searchParams.get("error")) return xeroRedirectResponse(configuredReturn, "error", "authorisation-denied");
  if (!xeroOAuthStateMatches(state, cookieState)) return xeroRedirectResponse(configuredReturn, "error", "invalid-state");
  const stateHash = await sha256Base64Url(state);
  const stateRow = await env.DB.prepare(`SELECT state_hash, owner_oid, owner_upn, return_url
    FROM xero_oauth_states WHERE state_hash = ? AND consumed_at IS NULL AND expires_at > ?`).bind(stateHash, now()).first();
  if (!stateRow) return xeroRedirectResponse(configuredReturn, "error", "expired-state");
  await env.DB.prepare("UPDATE xero_oauth_states SET consumed_at = ? WHERE state_hash = ? AND consumed_at IS NULL").bind(now(), stateHash).run();
  const code = text2(url.searchParams.get("code"), "", 4e3);
  if (!code) return xeroRedirectResponse(stateRow.return_url || configuredReturn, "error", "missing-code");
  const tokenResponse = await fetch(settings.tokenUrl, {
    method: "POST",
    headers: { Authorization: xeroBasicAuth(settings), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: settings.redirectUri })
  });
  const tokenText = await tokenResponse.text();
  let tokenBody = null;
  try {
    tokenBody = tokenText ? JSON.parse(tokenText) : null;
  } catch (_) {
  }
  if (!tokenResponse.ok || !tokenBody?.access_token || !tokenBody?.refresh_token) return xeroRedirectResponse(stateRow.return_url || configuredReturn, "error", "token-exchange");
  const connectionsResponse = await fetch(`${settings.apiUrl}/connections`, { headers: xeroApiHeaders(tokenBody.access_token) });
  const connectionsText = await connectionsResponse.text();
  let connections = null;
  try {
    connections = connectionsText ? JSON.parse(connectionsText) : null;
  } catch (_) {
  }
  if (!connectionsResponse.ok || !Array.isArray(connections) || !connections.length) return xeroRedirectResponse(stateRow.return_url || configuredReturn, "error", "no-tenant");
  const timestamp = now();
  let storedConnections = 0;
  for (const connection of connections.slice(0, 25)) {
    const tenantId = text2(connection?.tenantId, "", 160);
    const connectionId = text2(connection?.id || connection?.connectionId, "", 160);
    if (!tenantId || !connectionId) continue;
    const encrypted = await encryptXeroSecret(tokenBody.refresh_token, settings);
    await env.DB.prepare(`INSERT INTO xero_connections
      (tenant_id, connection_id, tenant_name, tenant_type, scopes, refresh_token_ciphertext, refresh_token_iv,
       connected_by_oid, connected_by_upn, connected_at, updated_at, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(tenant_id) DO UPDATE SET connection_id = excluded.connection_id,
       tenant_name = excluded.tenant_name, tenant_type = excluded.tenant_type, scopes = excluded.scopes,
       refresh_token_ciphertext = excluded.refresh_token_ciphertext, refresh_token_iv = excluded.refresh_token_iv,
       connected_by_oid = excluded.connected_by_oid, connected_by_upn = excluded.connected_by_upn,
       connected_at = excluded.connected_at, updated_at = excluded.updated_at, last_error = NULL`).bind(
      tenantId,
      connectionId,
      text2(connection?.tenantName, "Xero organisation", 500),
      text2(connection?.tenantType, "ORGANISATION", 80),
      text2(tokenBody.scope || settings.scopes, settings.scopes, 1e3),
      encrypted.ciphertext,
      encrypted.iv,
      stateRow.owner_oid,
      stateRow.owner_upn,
      timestamp,
      timestamp
    ).run();
    storedConnections += 1;
  }
  if (!storedConnections) return xeroRedirectResponse(stateRow.return_url || configuredReturn, "error", "no-tenant");
  const first = connections.find((connection) => text2(connection?.tenantId, "", 160));
  return xeroRedirectResponse(stateRow.return_url || configuredReturn, "connected", "", text2(first?.tenantName, "", 500));
}
__name(completeXeroConnection, "completeXeroConnection");
async function xeroConnectionRows(env) {
  const result = await env.DB.prepare("SELECT * FROM xero_connections ORDER BY tenant_name").all();
  return result.results || [];
}
__name(xeroConnectionRows, "xeroConnectionRows");
async function xeroStatus(env, identity, origin, fetchImpl = fetch) {
  requireXeroAdmin(identity);
  const settings = xeroSettings(env);
  const connections = await xeroConnectionRows(env);
  const checkedAt = now();
  const healthConnections = [];
  const refreshResults = /* @__PURE__ */ new Map();
  for (const connection of connections) {
    let refreshHealth = "not_configured";
    let identityStatus = "unverified";
    let tenantName = text2(connection.tenant_name, "Xero organisation", 500);
    let healthError = "";
    let lastError = text2(connection.last_error, "", 1e3);
    if (settings.configured) {
      try {
        const savedRefreshToken = await decryptXeroSecret(connection.refresh_token_ciphertext, connection.refresh_token_iv, settings);
        let refreshResult = refreshResults.get(savedRefreshToken);
        if (!refreshResult) {
          try {
            refreshResult = { token: await refreshXeroAccessToken(env, connection, fetchImpl) };
          } catch (error) {
            refreshResult = { error };
          }
          refreshResults.set(savedRefreshToken, refreshResult);
        }
        if (refreshResult.error) throw refreshResult.error;
        const token = refreshResult.token;
        lastError = "";
        const response = await fetchImpl(`${settings.apiUrl}/connections`, { headers: xeroApiHeaders(token.accessToken) });
        if (!response.ok) {
          refreshHealth = "unavailable";
          healthError = response.status >= 500 ? "Xero tenant verification is temporarily unavailable." : "Xero could not verify the saved organisation. Retry the check or reconnect if the problem continues.";
        } else {
          let liveConnections = null;
          try {
            liveConnections = await response.json();
          } catch (_) {
          }
          if (!Array.isArray(liveConnections)) {
            refreshHealth = "unavailable";
            healthError = "Xero returned an invalid tenant verification response.";
          } else {
            refreshHealth = "healthy";
            const matched = liveConnections.find(
              (item) => text2(item?.tenantId, "", 160) === connection.tenant_id && text2(item?.id || item?.connectionId, "", 160) === connection.connection_id
            );
            if (matched) {
              identityStatus = "verified";
              tenantName = text2(matched.tenantName, tenantName, 500);
            } else {
              identityStatus = "mismatch";
              healthError = "The active Xero connection does not match the saved tenant identity. Reconnect Xero to restore the Accounts mapping.";
            }
          }
        }
      } catch (error) {
        const reconnectRequired = error?.code === "XERO_REAUTH_REQUIRED";
        refreshHealth = reconnectRequired ? "reconnect_required" : "unavailable";
        healthError = text2(error?.publicMessage, reconnectRequired ? "Xero authorisation expired. Reconnect Xero to restore invoice access." : "Xero could not verify its authorisation right now.", 500);
        if (reconnectRequired) lastError = healthError;
      }
    } else {
      healthError = "Xero is not fully configured on the portal service.";
    }
    healthConnections.push({
      tenant_id: connection.tenant_id,
      connection_id: connection.connection_id,
      tenant_name: tenantName,
      tenant_type: connection.tenant_type,
      scopes: String(connection.scopes || "").split(/\s+/).filter(Boolean),
      connected_by_upn: connection.connected_by_upn,
      connected_at: connection.connected_at,
      updated_at: connection.updated_at,
      last_error: lastError,
      refresh_health: refreshHealth,
      identity_status: identityStatus,
      checked_at: checkedAt,
      health_error: healthError
    });
  }
  return json({
    configured: settings.configured,
    scopes: settings.scopes.split(/\s+/).filter(Boolean),
    redirect_uri: settings.redirectUri || "",
    checked_at: checkedAt,
    connections: healthConnections
  }, 200, origin || "");
}
__name(xeroStatus, "xeroStatus");
async function refreshXeroAccessToken(env, connection, fetchImpl = fetch) {
  const settings = xeroSettings(env);
  if (!settings.configured) throw Object.assign(new Error("Xero is not configured on the portal service"), { status: 503 });
  let currentConnection = connection;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const refreshToken = await decryptXeroSecret(currentConnection.refresh_token_ciphertext, currentConnection.refresh_token_iv, settings);
    const tokenHash = await sha256Base64Url(refreshToken);
    const leaseId = crypto.randomUUID();
    await acquireXeroRefreshLock(env, tokenHash, leaseId);
    try {
      const latestConnection = await env.DB.prepare("SELECT * FROM xero_connections WHERE tenant_id = ?").bind(currentConnection.tenant_id).first();
      if (!latestConnection) throw Object.assign(new Error("The requested Xero organisation is not connected"), { status: 404 });
      const latestRefreshToken = await decryptXeroSecret(latestConnection.refresh_token_ciphertext, latestConnection.refresh_token_iv, settings);
      if (latestRefreshToken !== refreshToken) {
        currentConnection = latestConnection;
        continue;
      }
      return await refreshXeroAccessTokenLocked(env, latestConnection, settings, refreshToken, tokenHash, leaseId, fetchImpl);
    } finally {
      try {
        await env.DB.prepare("DELETE FROM xero_refresh_locks WHERE token_hash = ? AND lease_id = ?").bind(tokenHash, leaseId).run();
      } catch (_) {
      }
    }
  }
  throw Object.assign(new Error("Xero authorisation is being refreshed. Retry shortly."), {
    status: 503,
    code: "XERO_REFRESH_BUSY",
    publicMessage: "Xero authorisation is being refreshed. Retry shortly."
  });
}
__name(refreshXeroAccessToken, "refreshXeroAccessToken");
async function acquireXeroRefreshLock(env, tokenHash, leaseId) {
  const startedAt = Date.now();
  const leaseDurationMs = 12e4;
  while (Date.now() - startedAt < 1e4) {
    const timestamp = Date.now();
    const result = await env.DB.prepare(`INSERT INTO xero_refresh_locks (token_hash, lease_id, lease_expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET lease_id = excluded.lease_id, lease_expires_at = excluded.lease_expires_at
      WHERE xero_refresh_locks.lease_expires_at <= ?`).bind(tokenHash, leaseId, timestamp + leaseDurationMs, timestamp).run();
    if (Number(result?.meta?.changes || 0) === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Object.assign(new Error("Xero authorisation is being refreshed. Retry shortly."), {
    status: 503,
    code: "XERO_REFRESH_BUSY",
    publicMessage: "Xero authorisation is being refreshed. Retry shortly."
  });
}
__name(acquireXeroRefreshLock, "acquireXeroRefreshLock");
async function refreshXeroAccessTokenLocked(env, connection, settings, refreshToken, tokenHash, leaseId, fetchImpl) {
  const savedConnections = await xeroConnectionRows(env);
  const sharedConnections = [];
  for (const savedConnection of savedConnections) {
    try {
      const savedToken = await decryptXeroSecret(savedConnection.refresh_token_ciphertext, savedConnection.refresh_token_iv, settings);
      if (savedToken === refreshToken) sharedConnections.push(savedConnection);
    } catch (_) {
    }
  }
  if (!sharedConnections.some((item) => item.tenant_id === connection.tenant_id)) sharedConnections.push(connection);
  const response = await fetchImpl(settings.tokenUrl, {
    method: "POST",
    headers: { Authorization: xeroBasicAuth(settings), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    signal: AbortSignal.timeout(3e4)
  });
  const responseText = await response.text();
  let body = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
  }
  if (!response.ok || !body?.access_token || !text2(body?.refresh_token, "", 5e3)) {
    const message = xeroErrorMessage(body, `Xero token refresh failed (${response.status})`);
    await env.DB.prepare("UPDATE xero_connections SET last_error = ?, updated_at = ? WHERE tenant_id = ?").bind(message, now(), connection.tenant_id).run();
    const invalidGrant = String(body?.error || "").toLowerCase() === "invalid_grant" || /consum|invalid.grant|refresh token/i.test(String(body?.error_description || body?.message || ""));
    throw Object.assign(new Error(message), {
      status: 503,
      code: invalidGrant ? "XERO_REAUTH_REQUIRED" : "XERO_REFRESH_FAILED",
      publicMessage: invalidGrant ? "Xero authorisation expired or its refresh token was already used. Reconnect Xero to restore invoice access." : "Xero could not refresh its authorisation. Retry shortly or reconnect Xero to restore invoice access."
    });
  }
  const nextRefreshToken = text2(body.refresh_token, "", 5e3);
  const encrypted = await encryptXeroSecret(nextRefreshToken, settings);
  const updatedAt = now();
  const scopes = text2(body.scope || connection.scopes, connection.scopes || settings.scopes, 1e3);
  const statements = [];
  for (const sharedConnection of sharedConnections) {
    statements.push(env.DB.prepare(`UPDATE xero_connections SET refresh_token_ciphertext = ?, refresh_token_iv = ?, scopes = ?,
      updated_at = ?, last_error = NULL WHERE tenant_id = ? AND refresh_token_ciphertext = ? AND refresh_token_iv = ?`).bind(
      encrypted.ciphertext,
      encrypted.iv,
      scopes,
      updatedAt,
      sharedConnection.tenant_id,
      sharedConnection.refresh_token_ciphertext,
      sharedConnection.refresh_token_iv
    ));
    statements.push(env.DB.prepare(`UPDATE xero_refresh_locks
      SET lease_expires_at = CASE WHEN changes() = 1 AND lease_id = ? THEN lease_expires_at ELSE NULL END
      WHERE token_hash = ? AND lease_id = ?`).bind(leaseId, tokenHash, leaseId));
    if (sharedConnection.tenant_id === connection.tenant_id) {
      connection.refresh_token_ciphertext = encrypted.ciphertext;
      connection.refresh_token_iv = encrypted.iv;
    }
  }
  await env.DB.batch(statements);
  return { accessToken: body.access_token, expiresAt: xeroTokenExpiry(body.expires_in) };
}
__name(refreshXeroAccessTokenLocked, "refreshXeroAccessTokenLocked");
async function selectXeroConnection(env, tenantId = "") {
  const requested = text2(tenantId, "", 160);
  const result = requested ? await env.DB.prepare("SELECT * FROM xero_connections WHERE tenant_id = ?").bind(requested).first() : await env.DB.prepare("SELECT * FROM xero_connections ORDER BY updated_at DESC LIMIT 2").all();
  if (requested) {
    if (!result) throw Object.assign(new Error("The requested Xero organisation is not connected"), { status: 404 });
    return result;
  }
  const rows = result.results || [];
  if (!rows.length) throw Object.assign(new Error("No Xero organisation is connected"), { status: 404 });
  if (rows.length > 1) throw Object.assign(new Error("Choose a Xero organisation before looking up an invoice"), { status: 409 });
  return rows[0];
}
__name(selectXeroConnection, "selectXeroConnection");
async function lookupXeroInvoice(env, tenantId, invoiceNumber) {
  const settings = xeroSettings(env);
  const connection = await selectXeroConnection(env, tenantId);
  const token = await refreshXeroAccessToken(env, connection);
  const escaped = String(invoiceNumber || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const where = `InvoiceNumber="${escaped}"`;
  const endpoint = `${settings.apiUrl}/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}`;
  const response = await fetch(endpoint, { headers: xeroApiHeaders(token.accessToken, connection.tenant_id) });
  const responseText = await response.text();
  let body = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
  }
  if (!response.ok) throw Object.assign(new Error(xeroErrorMessage(body, `Xero invoice lookup failed (${response.status})`)), { status: 502 });
  const invoices = Array.isArray(body?.Invoices) ? body.Invoices : [];
  return {
    tenant: { tenant_id: connection.tenant_id, tenant_name: connection.tenant_name },
    invoice: invoices[0] ? xeroInvoiceProjection(invoices[0]) : null,
    invoices: invoices.slice(0, 20).map(xeroInvoiceProjection),
    refreshed_at: now()
  };
}
__name(lookupXeroInvoice, "lookupXeroInvoice");
async function lookupXeroInvoiceEndpoint(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const invoiceNumber = text2(body.invoiceNumber || body.invoice_number, "", 255);
  if (!invoiceNumber) return json({ error: "Invoice number is required" }, 400, origin || "");
  return json(await lookupXeroInvoice(env, body.tenantId || body.tenant_id, invoiceNumber), 200, origin || "");
}
__name(lookupXeroInvoiceEndpoint, "lookupXeroInvoiceEndpoint");
async function listXeroInvoices(env, tenantId = "", options = {}) {
  const connection = await selectXeroConnection(env, tenantId);
  const requestedLimit = Number(options.limit ?? 50);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 100) : 50;
  const page = Number(options.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 1e3) {
    throw Object.assign(new Error("Invoice page must be an integer between 1 and 1000"), { status: 400 });
  }
  const status = text2(options.status, "", 40);
  const cachePath = xeroInvoiceArchivePagePath(connection.tenant_id, page, limit, status);
  if (options.refresh !== true) {
    const cached = await readXeroInvoiceArchivePage(env, connection, page, limit, status);
    if (cached) {
      return {
        tenant: { tenant_id: connection.tenant_id, tenant_name: connection.tenant_name },
        invoices: cached.invoices,
        page,
        page_size: limit,
        pagination: { page_limit: 1e3, has_more: cached.invoices.length === limit },
        refreshed_at: cached.cached_at,
        archive: { source: "sharepoint", stored: true, cached_at: cached.cached_at }
      };
    }
  }
  const settings = xeroSettings(env);
  const token = await refreshXeroAccessToken(env, connection);
  const params = new URLSearchParams({ page: String(page), pageSize: String(limit) });
  if (status) params.set("where", `Status=="${status.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  const endpoint = `${settings.apiUrl}/api.xro/2.0/Invoices?${params.toString()}`;
  const response = await fetch(endpoint, { headers: xeroApiHeaders(token.accessToken, connection.tenant_id) });
  const responseText = await response.text();
  let body = null;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch (_) {
  }
  if (!response.ok) throw Object.assign(new Error(xeroErrorMessage(body, `Xero invoice list failed (${response.status})`)), { status: 502 });
  if (!Array.isArray(body?.Invoices)) {
    throw Object.assign(new Error("Xero invoice list returned an invalid response"), { status: 502 });
  }
  const invoices = body.Invoices;
  const cachedAt = now();
  let stored = false;
  try {
    await writeXeroInvoiceArchivePage(env, cachePath, {
      schema_version: 1,
      tenant_id: connection.tenant_id,
      page,
      page_size: limit,
      status,
      cached_at: cachedAt,
      invoices: invoices.slice(0, limit).map(xeroInvoiceProjection)
    });
    stored = true;
  } catch (_) {
  }
  return {
    tenant: { tenant_id: connection.tenant_id, tenant_name: connection.tenant_name },
    invoices: invoices.slice(0, limit).map(xeroInvoiceProjection),
    page,
    page_size: limit,
    pagination: { page_limit: 1e3, has_more: invoices.length >= limit },
    refreshed_at: cachedAt,
    archive: { source: "xero", stored, cached_at: stored ? cachedAt : "" }
  };
}
__name(listXeroInvoices, "listXeroInvoices");
function xeroInvoiceArchivePagePath(tenantId, page, pageSize, status = "") {
  const tenant = archiveFilename(text2(tenantId, "", 160));
  const filter = archiveFilename(text2(status, "all", 40).toLowerCase());
  return `Invoices/Xero/${tenant}/page-${page}-${pageSize}-${filter}.json`;
}
__name(xeroInvoiceArchivePagePath, "xeroInvoiceArchivePagePath");
async function readXeroInvoiceArchivePage(env, connection, page, pageSize, status = "") {
  const path = `/root:/${encodeDrivePath(xeroInvoiceArchivePagePath(connection.tenant_id, page, pageSize, status))}:/content`;
  const response = await graphSharePointRequest(env, path, { headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw Object.assign(new Error("SharePoint invoice archive could not be read"), { status: 503 });
  let archived;
  try {
    archived = await response.json();
  } catch (_) {
    throw Object.assign(new Error("SharePoint invoice archive page is invalid"), { status: 503 });
  }
  if (archived?.schema_version !== 1 || archived.tenant_id !== connection.tenant_id || Number(archived.page) !== page || Number(archived.page_size) !== pageSize || String(archived.status || "") !== status || !Array.isArray(archived.invoices) || !archived.cached_at) return null;
  return archived;
}
__name(readXeroInvoiceArchivePage, "readXeroInvoiceArchivePage");
async function writeXeroInvoiceArchivePage(env, path, archived) {
  const folder = path.slice(0, path.lastIndexOf("/"));
  await ensureSharePointFolder(env, folder);
  const response = await graphSharePointRequest(env, `/root:/${encodeDrivePath(path)}:/content`, {
    method: "PUT",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(archived)
  });
  if (!response.ok) throw Object.assign(new Error("SharePoint invoice archive could not be written"), { status: 503 });
}
__name(writeXeroInvoiceArchivePage, "writeXeroInvoiceArchivePage");
async function listXeroInvoicesEndpoint(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  return json(await listXeroInvoices(env, url.searchParams.get("tenantId") || url.searchParams.get("tenant_id") || "", {
    limit: url.searchParams.get("limit") || 50,
    page: url.searchParams.get("page") || 1,
    status: url.searchParams.get("status") || "",
    refresh: url.searchParams.get("refresh") === "1"
  }), 200, origin || "");
}
__name(listXeroInvoicesEndpoint, "listXeroInvoicesEndpoint");
function xeroInvoiceApiBase(settings) {
  return `${settings.apiUrl}/api.xro/2.0`;
}
__name(xeroInvoiceApiBase, "xeroInvoiceApiBase");
async function xeroAccountingRequest(env, connection, path, options = {}) {
  const settings = xeroSettings(env);
  const token = await refreshXeroAccessToken(env, connection, options.fetchImpl || fetch);
  const response = await (options.fetchImpl || fetch)(`${xeroInvoiceApiBase(settings)}${path}`, {
    method: options.method || "GET",
    headers: { ...xeroApiHeaders(token.accessToken, connection.tenant_id), ...options.body ? { "Content-Type": "application/json" } : {} },
    ...options.body ? { body: JSON.stringify(options.body) } : {}
  });
  const raw = await response.text();
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch (_) {
  }
  const invoice = body?.Invoices?.[0];
  const validation = Array.isArray(invoice?.ValidationErrors) ? invoice.ValidationErrors.map((item) => text2(item?.Message, "", 250)).filter(Boolean).join("; ") : "";
  if (!response.ok || validation || body?.Status === "ERROR") {
    throw Object.assign(new Error(xeroErrorMessage(body, validation || `Xero request failed (${response.status})`)), { status: response.status === 401 ? 502 : 422 });
  }
  return body;
}
__name(xeroAccountingRequest, "xeroAccountingRequest");
async function getXeroInvoice(env, tenantId, invoiceId, options = {}) {
  const connection = await selectXeroConnection(env, tenantId);
  const body = await xeroAccountingRequest(env, connection, `/Invoices/${encodeURIComponent(invoiceId)}`, options);
  const invoice = body?.Invoices?.[0];
  if (!invoice?.InvoiceID) throw Object.assign(new Error("Invoice not found in the selected Xero organisation"), { status: 404 });
  return { connection, invoice };
}
__name(getXeroInvoice, "getXeroInvoice");
function xeroLinkedRecordDisplay(row, payload) {
  let candidates = {};
  let confirmed = {};
  try {
    candidates = JSON.parse(row.candidates_json || "{}");
  } catch (_) {
  }
  try {
    confirmed = JSON.parse(row.confirmed_json || "{}");
  } catch (_) {
  }
  const candidateFields = payload.candidateFields && typeof payload.candidateFields === "object" ? payload.candidateFields : {};
  const confirmedFields = payload.confirmedFields && typeof payload.confirmedFields === "object" ? payload.confirmedFields : {};
  const title = payload.estimateNumber || payload.number || payload.jobReference || payload.reference || confirmed.cardNumber || confirmedFields.cardNumber || candidates.cardNumber || candidateFields.cardNumber || (row.source_file ? `${row.source_file} \xB7 page ${row.source_page || ""}` : row.record_id);
  const customer = payload.company || payload.client || payload.customerName || confirmed.customer || confirmedFields.customer || candidates.customer || candidateFields.customer || "";
  return {
    title: text2(title, "", 255),
    customer: text2(customer, "", 240),
    is_candidate: row.kind === "job-cards" && row.archive_review_state !== "confirmed" && Boolean(candidates.cardNumber || candidateFields.cardNumber)
  };
}
__name(xeroLinkedRecordDisplay, "xeroLinkedRecordDisplay");
async function xeroInvoiceRecords(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  const query = text2(url.searchParams.get("q"), "", 200).toLowerCase();
  const requestedLimit = Number(url.searchParams.get("limit") || 100);
  const requestedOffset = Number(url.searchParams.get("offset") || 0);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0 || requestedOffset > 1e6) {
    throw Object.assign(new Error("Record lookup pagination is invalid"), { status: 400 });
  }
  const limit = Math.min(requestedLimit, 100);
  const offset = requestedOffset;
  const search = query ? ` AND (
      instr(lower(r.record_id), ?) > 0 OR
      instr(lower(COALESCE(r.payload_json, '')), ?) > 0 OR
      instr(lower(COALESCE(a.candidates_json, '')), ?) > 0 OR
      instr(lower(COALESCE(a.confirmed_json, '')), ?) > 0 OR
      instr(lower(COALESCE(a.ocr_text, '')), ?) > 0 OR
      instr(lower(COALESCE(a.source_file, '')), ?) > 0
    )` : "";
  const values = query ? [query, query, query, query, query, query, limit + 1, offset] : [limit + 1, offset];
  const result = await env.DB.prepare(`SELECT r.record_id, r.kind, r.status, r.employee_name, r.record_date, r.payload_json,
      a.candidates_json, a.confirmed_json, a.review_state AS archive_review_state,
      a.source_file, a.source_page, a.ocr_text
    FROM records r LEFT JOIN job_card_archive a ON a.record_id=r.record_id
    WHERE r.kind IN ('estimates', 'job-cards') AND r.status <> 'Deleted'${search}
    ORDER BY r.updated_at DESC, r.record_id ASC LIMIT ? OFFSET ?`).bind(...values).all();
  const rows = result.results || [];
  const hasMore = rows.length > limit;
  return json({ records: rows.slice(0, limit).map((row) => {
    const payload = payloadObject(row);
    const display = xeroLinkedRecordDisplay(row, payload);
    return {
      record_id: text2(row.record_id, "", MAX_RECORD_ID2),
      kind: row.kind,
      title: display.title,
      customer: display.customer,
      is_candidate: display.is_candidate,
      date: text2(row.record_date, "", 10),
      total: Number.isFinite(Number(payload.total)) ? Number(payload.total) : null
    };
  }), pagination: { has_more: hasMore, next_offset: hasMore ? offset + limit : null } }, 200, origin || "");
}
__name(xeroInvoiceRecords, "xeroInvoiceRecords");
async function persistExactInvoiceJobCardLinks(env, connection, invoice, identity) {
  const reference = correlationToken(invoice?.Reference);
  const invoiceId = text2(invoice?.InvoiceID, "", 180);
  if (!reference || !invoiceId) return;
  const result = await env.DB.prepare(`SELECT record_id, kind, payload_json FROM records
    WHERE kind = 'job-cards' AND status <> 'Deleted' AND (
      lower(trim(record_id)) = ? OR
      lower(trim(CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.jobReference'), '') ELSE '' END)) = ? OR
      lower(trim(CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.job_reference'), '') ELSE '' END)) = ? OR
      lower(trim(CASE WHEN json_valid(payload_json) THEN COALESCE(json_extract(payload_json, '$.reference'), '') ELSE '' END)) = ?
    )`).bind(reference, reference, reference, reference).all();
  const rows = result.results || [];
  if (rows.length !== 1) return;
  const record = rows[0];
  await storeXeroInvoiceLinks(env, connection, invoiceId, [{ record_id: record.record_id, kind: "job-cards" }], identity);
  const messageIds = /* @__PURE__ */ new Set();
  const matchingEmails = await env.DB.prepare(`SELECT id FROM archive_messages
    WHERE source_kind = 'email' AND lower(trim(reference)) = ?`).bind(reference).all();
  for (const message of matchingEmails.results || []) messageIds.add(message.id);
  const linkedEmails = await env.DB.prepare(`SELECT message_id FROM archive_associations
    WHERE target_kind = 'job-card' AND target_id = ? AND state = 'confirmed'`).bind(record.record_id).all();
  for (const message of linkedEmails.results || []) messageIds.add(message.message_id);
  for (const messageId of messageIds) {
    await upsertEstimateAssociation(env, messageId, {
      target_kind: "invoice",
      target_id: invoiceId,
      target_reference: text2(invoice.InvoiceNumber || invoiceId, "", 500),
      relationship: "billed-as",
      confidence: 1,
      state: "confirmed",
      provenance_kind: "exact-reference",
      evidence: { field: "xero_reference", value: text2(invoice.Reference, "", 500), job_card_id: record.record_id, rule: "job-card-reference" }
    }, identity.upn);
  }
}
__name(persistExactInvoiceJobCardLinks, "persistExactInvoiceJobCardLinks");
async function xeroInvoiceDetailEndpoint(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  const result = await getXeroInvoice(env, url.searchParams.get("tenantId") || "", invoiceId);
  await persistExactInvoiceJobCardLinks(env, result.connection, result.invoice, identity);
  const links = await env.DB.prepare(`SELECT record_id, record_kind, linked_by_upn, linked_at
    FROM xero_invoice_links WHERE tenant_id = ? AND invoice_id = ? ORDER BY linked_at DESC`).bind(result.connection.tenant_id, invoiceId).all();
  const linkedRecords = /* @__PURE__ */ new Map();
  for (const link of links.results || []) {
    const record = await env.DB.prepare(`SELECT r.status AS record_status, r.record_date, r.payload_json,
        a.candidates_json, a.confirmed_json, a.review_state AS archive_review_state,
        a.source_file, a.source_page
      FROM records r LEFT JOIN job_card_archive a ON a.record_id=r.record_id
      WHERE r.record_id = ?`).bind(link.record_id).first();
    linkedRecords.set(link.record_id, record || {});
  }
  const audit = await env.DB.prepare(`SELECT action, before_status, after_status, actor_upn, occurred_at FROM xero_invoice_audit
    WHERE tenant_id = ? AND invoice_id = ? ORDER BY occurred_at DESC LIMIT 20`).bind(result.connection.tenant_id, invoiceId).all();
  const invoice = result.invoice;
  let estimateCorrelation = { matches: [], candidates: [], explanation: "Estimate index unavailable" };
  let estimateRows = [];
  try {
    estimateRows = await listEstimateIndex(env, identity, { limit: 500 });
    estimateCorrelation = correlateEstimateRecords(estimateRows, xeroInvoiceProjection(invoice), []);
  } catch (_) {
  }
  const indexedById = new Map(estimateRows.map((row) => [row.canonical_id, row]));
  for (const match of estimateCorrelation.matches) {
    if (!["estimate-number", "estimate-number-alias", "reference"].includes(match.rule)) continue;
    const estimate = indexedById.get(match.canonical_id);
    if (!estimate) continue;
    const sourceMessages = /* @__PURE__ */ new Map();
    if (estimate.internet_message_id) {
      const source = await env.DB.prepare(`SELECT id, conversation_id FROM archive_messages
        WHERE internet_message_id = ? LIMIT 1`).bind(String(estimate.internet_message_id).toLowerCase()).first();
      if (source) sourceMessages.set(source.id, { ...source, provenance: "exact-reference" });
    }
    for (const source of estimate.mail_sources || []) {
      if (!source.mailbox || !source.outlook_message_id) continue;
      const archived = await env.DB.prepare(`SELECT id, conversation_id FROM archive_messages
        WHERE mailbox = ? AND source_message_id = ? LIMIT 1`).bind(source.mailbox, source.outlook_message_id).first();
      if (archived) sourceMessages.set(archived.id, { ...archived, provenance: "exact-reference" });
    }
    for (const archived of sourceMessages.values()) {
      await upsertEstimateAssociation(env, archived.id, {
        target_kind: "invoice",
        target_id: invoiceId,
        target_reference: text2(invoice.InvoiceNumber || invoiceId, "", 500),
        relationship: "billed-as",
        confidence: 1,
        state: "confirmed",
        provenance_kind: "exact-reference",
        evidence: { estimate_canonical_id: estimate.canonical_id, rule: match.rule, invoice_reference: text2(invoice.Reference, "", 500) }
      }, identity.upn);
      if (archived.conversation_id) {
        const conversation = await env.DB.prepare(`SELECT id FROM archive_messages
          WHERE conversation_id = ? AND source_kind = 'email'`).bind(archived.conversation_id).all();
        for (const message of conversation.results || []) {
          await upsertEstimateAssociation(env, message.id, {
            target_kind: "invoice",
            target_id: invoiceId,
            target_reference: text2(invoice.InvoiceNumber || invoiceId, "", 500),
            relationship: "same-conversation",
            confidence: 1,
            state: "confirmed",
            provenance_kind: "conversation-id",
            evidence: { estimate_canonical_id: estimate.canonical_id, source_message_id: archived.id, conversation_id: archived.conversation_id }
          }, identity.upn);
        }
      }
    }
  }
  const relatedEstimates = estimateCorrelation.matches.map((match) => {
    const row = indexedById.get(match.canonical_id) || {};
    return {
      canonical_id: text2(row.canonical_id, "", 200),
      estimate_number: text2(row.estimate_number, "", 160),
      client: text2(row.client, "", 500),
      estimate_date: text2(row.estimate_date, "", 80),
      reference: text2(row.reference, "", 500),
      source: text2(row.source, "", 40),
      correlation_rule: text2(match.rule, "", 80),
      outlook_url: httpUrl(row.outlook_url, 2e3),
      sharepoint_url: httpUrl(row.sharepoint_url, 2e3),
      attachment_url: httpUrl(row.attachment_url, 2e3),
      history_url: row.canonical_id ? `../tools/estimates.html?record=${encodeURIComponent(row.canonical_id)}` : ""
    };
  });
  const emailThreads = estimateRows.filter((row) => estimateCorrelation.matches.some((match) => match.canonical_id === row.canonical_id) || estimateCorrelation.candidates.some((candidate) => candidate.canonical_id === row.canonical_id)).map((row) => ({
    canonical_id: text2(row.canonical_id, "", 200),
    subject: text2(row.estimate_number || row.reference || "Estimate email", "", 255),
    message_id: text2(row.outlook_message_id, "", 255),
    outlook_url: httpUrl(row.outlook_url, 2e3),
    attachment_url: httpUrl(row.attachment_url, 2e3),
    match_status: estimateCorrelation.matches.some((match) => match.canonical_id === row.canonical_id) ? "matched" : "candidate"
  }));
  const relatedJobCards = (links.results || []).filter((link) => link.record_kind === "job-cards").map((link) => {
    const record = linkedRecords.get(link.record_id) || {};
    const display = xeroLinkedRecordDisplay({ ...record, kind: "job-cards", record_id: link.record_id }, payloadObject(record));
    return {
      record_id: text2(link.record_id, "", MAX_RECORD_ID2),
      record_title: display.title,
      customer: display.customer,
      is_candidate: display.is_candidate,
      linked_by_upn: text2(link.linked_by_upn, "", 320),
      linked_at: text2(link.linked_at, "", 80),
      history_url: `../jobs/?record=${encodeURIComponent(link.record_id)}`
    };
  });
  return json({
    invoice: xeroInvoiceProjection(invoice),
    line_items: (invoice.LineItems || []).map((line) => ({ description: text2(line.Description, "", 4e3), quantity: Number(line.Quantity) || 0, unit_amount: Number(line.UnitAmount) || 0, account_code: text2(line.AccountCode, "", 40), tax_type: text2(line.TaxType, "", 80) })),
    contact_id: text2(invoice.Contact?.ContactID, "", 100),
    reference: text2(invoice.Reference, "", 255),
    line_amount_types: text2(invoice.LineAmountTypes, "Exclusive", 20),
    links: (links.results || []).map((link) => {
      const record = linkedRecords.get(link.record_id) || {};
      const payload = payloadObject(record);
      const kind = link.record_kind === "estimates" ? "estimate" : "job-card";
      const display = xeroLinkedRecordDisplay({ ...record, kind: link.record_kind, record_id: link.record_id }, payload);
      return {
        record_id: text2(link.record_id, "", MAX_RECORD_ID2),
        record_kind: link.record_kind,
        record_title: display.title,
        customer: display.customer || text2(payload.client_company || payload.clientCompany, "", 240),
        is_candidate: display.is_candidate,
        record_date: text2(record.record_date || payload.date || payload.estimateDate || payload.estimate_date || payload.plannedDate || payload.planned_date, "", 40),
        record_status: text2(record.record_status, "", 80),
        email_url: text2(payload.jobEmailUrl || payload.job_email_url || payload.emailUrl || payload.email_url, "", 2e3),
        email_message_id: text2(payload.jobEmailMessageId || payload.job_email_message_id || payload.emailMessageId || payload.email_message_id, "", 255),
        history_url: kind === "estimate" ? `../tools/estimates.html?record=${encodeURIComponent(link.record_id)}` : `../jobs/?record=${encodeURIComponent(link.record_id)}`,
        linked_by_upn: text2(link.linked_by_upn, "", 320),
        linked_at: text2(link.linked_at, "", 80)
      };
    }),
    related_estimates: relatedEstimates,
    related_job_cards: relatedJobCards,
    email_threads: emailThreads,
    correlation: estimateCorrelation,
    audit: audit.results || [],
    policy: xeroInvoiceMutationPolicy(invoice)
  }, 200, origin || "");
}
__name(xeroInvoiceDetailEndpoint, "xeroInvoiceDetailEndpoint");
async function xeroInvoiceLinksEndpoint(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  const current = await getXeroInvoice(env, url.searchParams.get("tenantId") || "", invoiceId);
  const links = await env.DB.prepare(`SELECT record_id, record_kind, linked_by_upn, linked_at
    FROM xero_invoice_links WHERE tenant_id = ? AND invoice_id = ? ORDER BY linked_at DESC`).bind(current.connection.tenant_id, invoiceId).all();
  const audit = await env.DB.prepare(`SELECT action, before_status, after_status, actor_upn, occurred_at
    FROM xero_invoice_audit WHERE tenant_id = ? AND invoice_id = ? ORDER BY occurred_at DESC LIMIT 20`).bind(current.connection.tenant_id, invoiceId).all();
  return json({
    invoice: xeroInvoiceProjection(current.invoice),
    links: links.results || [],
    audit: audit.results || []
  }, 200, origin || "");
}
__name(xeroInvoiceLinksEndpoint, "xeroInvoiceLinksEndpoint");
async function recordInvoiceLinksEndpoint(request, env, identity, origin, kind, recordId) {
  if (!["estimates", "job-cards"].includes(kind)) return json({ error: "Invoice links are available for estimates and job cards only" }, 400, origin || "");
  const record = await env.DB.prepare("SELECT record_id, kind, status FROM records WHERE record_id = ?").bind(recordId).first();
  if (!record) return json({ error: "Record not found" }, 404, origin || "");
  if (record.kind !== kind) return json({ error: "Record type does not match the requested link type" }, 400, origin || "");
  if (!canViewRecord(identity, record)) throw Object.assign(new Error("You are not allowed to view this record"), { status: 403 });
  const linked = await env.DB.prepare(`SELECT tenant_id, invoice_id, record_kind, linked_by_upn, linked_at
    FROM xero_invoice_links WHERE record_id = ? AND record_kind = ? ORDER BY linked_at DESC`).bind(recordId, kind).all();
  const invoices = [];
  for (const link of linked.results || []) {
    try {
      const current = await getXeroInvoice(env, link.tenant_id, link.invoice_id);
      invoices.push({ ...xeroInvoiceProjection(current.invoice), linked_by_upn: link.linked_by_upn, linked_at: link.linked_at });
    } catch (_) {
      invoices.push({ invoice_id: link.invoice_id, status: "UNAVAILABLE", display_status: "Unavailable", linked_by_upn: link.linked_by_upn, linked_at: link.linked_at });
    }
  }
  return json({ invoices, links: linked.results || [] }, 200, origin || "");
}
__name(recordInvoiceLinksEndpoint, "recordInvoiceLinksEndpoint");
async function xeroSetupDataEndpoint(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const url = new URL(request.url);
  const connection = await selectXeroConnection(env, url.searchParams.get("tenantId") || "");
  const settings = xeroSettings(env);
  const contacts = await xeroAccountingRequest(env, connection, "/Contacts?page=1", {});
  const accountsConnection = await selectXeroConnection(env, connection.tenant_id);
  const accounts = await xeroAccountingRequest(env, accountsConnection, "/Accounts", {});
  const taxConnection = await selectXeroConnection(env, connection.tenant_id);
  const taxRates = await xeroAccountingRequest(env, taxConnection, "/TaxRates", {});
  return json({
    contacts: (contacts?.Contacts || []).filter((item) => item.ContactID && item.IsCustomer !== false).map((item) => ({ id: text2(item.ContactID, "", 100), name: text2(item.Name, "", 500), email: text2(item.EmailAddress, "", 320) })),
    accounts: (accounts?.Accounts || []).filter((item) => item.Code && item.Status !== "ARCHIVED").map((item) => ({ code: text2(item.Code, "", 40), name: text2(item.Name, "", 500), type: text2(item.Type, "", 80), status: text2(item.Status, "", 40) })),
    tax_rates: (taxRates?.TaxRates || []).filter((item) => item.TaxType && item.Status !== "ARCHIVED").map((item) => ({ type: text2(item.TaxType, "", 80), name: text2(item.Name, "", 160), rate: Number(item.EffectiveRate) || 0 })),
    tenant: { tenant_id: connection.tenant_id, tenant_name: connection.tenant_name },
    api_base: `${settings.apiUrl}/api.xro/2.0`
  }, 200, origin || "");
}
__name(xeroSetupDataEndpoint, "xeroSetupDataEndpoint");
async function validateXeroRecordLinks(env, recordIds) {
  const ids = [...new Set((Array.isArray(recordIds) ? recordIds : []).map((id) => text2(id, "", MAX_RECORD_ID2)).filter(Boolean))];
  if (ids.length > 20) throw Object.assign(new Error("An invoice can link to at most 20 GMT records"), { status: 400 });
  const records = [];
  for (const id of ids) {
    const row = await env.DB.prepare("SELECT record_id, kind, status FROM records WHERE record_id = ?").bind(id).first();
    if (!row || row.status === "Deleted" || !["estimates", "job-cards"].includes(row.kind)) throw Object.assign(new Error("Choose an active estimate or job card to link"), { status: 400 });
    records.push(row);
  }
  return records;
}
__name(validateXeroRecordLinks, "validateXeroRecordLinks");
async function writeXeroInvoiceAudit(env, connection, invoiceId, action, beforeStatus, afterStatus, identity) {
  await env.DB.prepare(`INSERT INTO xero_invoice_audit (audit_id, tenant_id, invoice_id, action, before_status, after_status, actor_upn, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(randomBase64Url(18), connection.tenant_id, invoiceId, action, beforeStatus || "", afterStatus || "", identity.upn, now()).run();
}
__name(writeXeroInvoiceAudit, "writeXeroInvoiceAudit");
async function storeXeroInvoiceLinks(env, connection, invoiceId, records, identity) {
  for (const record of records) {
    await env.DB.prepare(`INSERT OR IGNORE INTO xero_invoice_links (tenant_id, invoice_id, record_id, record_kind, linked_by_upn, linked_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(connection.tenant_id, invoiceId, record.record_id, record.kind, identity.upn, now()).run();
  }
}
__name(storeXeroInvoiceLinks, "storeXeroInvoiceLinks");
async function createXeroInvoice(request, env, identity, origin) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const records = await validateXeroRecordLinks(env, body.recordIds || body.record_ids || []);
  const invoiceInput = xeroInvoicePayload(body.invoice || body);
  const connection = await selectXeroConnection(env, body.tenantId || body.tenant_id || "");
  const result = await xeroAccountingRequest(env, connection, "/Invoices", { method: "POST", body: { Invoices: [invoiceInput] } });
  const invoice = result?.Invoices?.[0];
  if (!invoice?.InvoiceID) throw Object.assign(new Error("Xero did not return the created invoice"), { status: 502 });
  await storeXeroInvoiceLinks(env, connection, invoice.InvoiceID, records, identity);
  await writeXeroInvoiceAudit(env, connection, invoice.InvoiceID, "created", "", invoice.Status || "DRAFT", identity);
  return json({ ok: true, invoice: xeroInvoiceProjection(invoice) }, 201, origin || "");
}
__name(createXeroInvoice, "createXeroInvoice");
async function updateXeroInvoice(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const tenantId = body.tenantId || body.tenant_id || new URL(request.url).searchParams.get("tenantId") || "";
  const current = await getXeroInvoice(env, tenantId, invoiceId);
  const policy = xeroInvoiceMutationPolicy(current.invoice);
  if (!policy.canEdit) return json({ error: "Only unpaid draft invoices can be edited here. Change authorised invoices in Xero." }, 409, origin || "");
  const invoiceInput = xeroInvoicePayload(body.invoice || body, invoiceId);
  const records = await validateXeroRecordLinks(env, body.recordIds || body.record_ids || []);
  const result = await xeroAccountingRequest(env, current.connection, "/Invoices", { method: "POST", body: { Invoices: [invoiceInput] } });
  const invoice = result?.Invoices?.[0];
  if (!invoice?.InvoiceID) throw Object.assign(new Error("Xero did not return the updated invoice"), { status: 502 });
  await env.DB.prepare("DELETE FROM xero_invoice_links WHERE tenant_id = ? AND invoice_id = ?").bind(current.connection.tenant_id, invoiceId).run();
  await storeXeroInvoiceLinks(env, current.connection, invoiceId, records, identity);
  await writeXeroInvoiceAudit(env, current.connection, invoiceId, "edited", current.invoice.Status || "", invoice.Status || "", identity);
  return json({ ok: true, invoice: xeroInvoiceProjection(invoice) }, 200, origin || "");
}
__name(updateXeroInvoice, "updateXeroInvoice");
async function sendXeroInvoice(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const current = await getXeroInvoice(env, body.tenantId || body.tenant_id || "", invoiceId);
  if (!xeroInvoiceMutationPolicy(current.invoice).canSend) return json({ error: "Only unpaid draft or authorised invoices that have not already been sent can be emailed from here" }, 409, origin || "");
  let beforeStatus = current.invoice.Status || "";
  if (beforeStatus !== "AUTHORISED") {
    const approved = await xeroAccountingRequest(env, current.connection, "/Invoices", { method: "POST", body: { Invoices: [{ InvoiceID: invoiceId, Status: "AUTHORISED" }] } });
    const approvedInvoice = approved?.Invoices?.[0];
    if (!approvedInvoice || approvedInvoice.Status !== "AUTHORISED") throw Object.assign(new Error("Xero did not authorise this invoice; check its validation errors in Xero"), { status: 422 });
    await writeXeroInvoiceAudit(env, current.connection, invoiceId, "approved-for-send", beforeStatus, approvedInvoice.Status, identity);
    beforeStatus = approvedInvoice.Status;
  }
  const sendConnection = await selectXeroConnection(env, current.connection.tenant_id);
  const result = await xeroAccountingRequest(env, sendConnection, `/Invoices/${encodeURIComponent(invoiceId)}/Email`, { method: "POST", body: {} });
  const refreshed = await getXeroInvoice(env, sendConnection.tenant_id, invoiceId);
  await writeXeroInvoiceAudit(env, sendConnection, invoiceId, "sent", beforeStatus, refreshed.invoice.Status || "", identity);
  return json({ ok: true, result, invoice: xeroInvoiceProjection(refreshed.invoice) }, 200, origin || "");
}
__name(sendXeroInvoice, "sendXeroInvoice");
async function deleteXeroInvoice(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const current = await getXeroInvoice(env, body.tenantId || body.tenant_id || "", invoiceId);
  const policy = xeroInvoiceMutationPolicy(current.invoice);
  if (!policy.canDelete) return json({ error: "Paid, part-paid, voided, or deleted invoices cannot be removed here. Correct those in Xero." }, 409, origin || "");
  const status = policy.deleteAction === "void" ? "VOIDED" : "DELETED";
  const result = await xeroAccountingRequest(env, current.connection, `/Invoices/${encodeURIComponent(invoiceId)}`, { method: "POST", body: { InvoiceID: invoiceId, Status: status } });
  const invoice = result?.Invoices?.[0] || { ...current.invoice, Status: status };
  await writeXeroInvoiceAudit(env, current.connection, invoiceId, status === "VOIDED" ? "voided" : "deleted", current.invoice.Status || "", status, identity);
  return json({ ok: true, invoice: xeroInvoiceProjection(invoice) }, 200, origin || "");
}
__name(deleteXeroInvoice, "deleteXeroInvoice");
async function linkXeroInvoice(request, env, identity, origin, invoiceId) {
  requireXeroAdmin(identity);
  const body = await readJson(request);
  const current = await getXeroInvoice(env, body.tenantId || body.tenant_id || "", invoiceId);
  const records = await validateXeroRecordLinks(env, body.recordIds || body.record_ids || (body.recordId ? [body.recordId] : []));
  await env.DB.prepare("DELETE FROM xero_invoice_links WHERE tenant_id = ? AND invoice_id = ?").bind(current.connection.tenant_id, invoiceId).run();
  await storeXeroInvoiceLinks(env, current.connection, invoiceId, records, identity);
  await writeXeroInvoiceAudit(env, current.connection, invoiceId, "links-updated", current.invoice.Status || "", current.invoice.Status || "", identity);
  return json({ ok: true, linked_count: records.length }, 200, origin || "");
}
__name(linkXeroInvoice, "linkXeroInvoice");
async function syncXeroJobCard(request, env, identity, origin, recordId) {
  requireXeroAdmin(identity);
  const existing = await env.DB.prepare("SELECT * FROM records WHERE record_id = ?").bind(recordId).first();
  if (!existing) return json({ error: "Record not found" }, 404, origin || "");
  if (existing.kind !== "job-cards") return json({ error: "Only job cards can be linked to Xero invoices" }, 400, origin || "");
  if (existing.status === "Deleted") return json({ error: "Record has been deleted" }, 410, origin || "");
  const body = await readJson(request);
  const payload = payloadObject(existing);
  const invoiceNumber = text2(body.invoiceNumber || body.invoice_number || payload.invoiceNumber, "", 255);
  if (!invoiceNumber) return json({ error: "Invoice number is required before linking a job card to Xero" }, 400, origin || "");
  const result = await lookupXeroInvoice(env, body.tenantId || body.tenant_id, invoiceNumber);
  if (!result.invoice) return json({ error: `No Xero invoice matched ${invoiceNumber}`, tenant: result.tenant }, 404, origin || "");
  const invoice = result.invoice;
  const mergedPayload = {
    ...payload,
    invoiceNumber,
    xeroReference: invoice.invoice_number || invoice.invoice_id || payload.xeroReference || "",
    xeroInvoiceId: invoice.invoice_id,
    xeroInvoiceStatus: invoice.status,
    xeroInvoiceUrl: invoice.url,
    xeroInvoiceTotal: invoice.total,
    xeroInvoiceAmountDue: invoice.amount_due,
    xeroInvoiceCurrency: invoice.currency,
    xeroLastSyncedAt: result.refreshed_at
  };
  const input = normaliseInput({
    recordId,
    kind: "job-cards",
    action: existing.action,
    status: existing.status,
    employeeName: existing.employee_name,
    employeeEmail: existing.owner_upn,
    recordDate: existing.record_date,
    submittedAt: existing.submitted_at,
    payload: mergedPayload
  }, { ...identity, name: existing.employee_name }, existing);
  await saveRecord(env, input, identity, existing);
  const updated = await env.DB.prepare(`SELECT r.*, q.status AS dispatch_status, q.attempts AS dispatch_attempts,
      q.queued_at AS dispatch_queued_at, q.last_sent_at AS dispatch_last_sent_at,
      q.last_error AS dispatch_last_error FROM records r LEFT JOIN dispatch_queue q ON q.record_id = r.record_id
      WHERE r.record_id = ?`).bind(recordId).first();
  return json({ ok: true, record: projectRow(updated, true, env), invoice }, 200, origin || "");
}
__name(syncXeroJobCard, "syncXeroJobCard");
async function knownOwnerIds(db, upn) {
  const result=await db.prepare(`SELECT owner_oid AS oid, lower(owner_upn) AS upn FROM profile_settings WHERE lower(owner_upn) = ?
    UNION SELECT owner_oid AS oid, lower(owner_upn) AS upn FROM records WHERE lower(owner_upn) = ? AND action <> 'pay_month_correction'
      AND NOT (action = 'email_archive' AND owner_oid = 'shared-estimate-archive')`).bind(upn,upn).all();
  return new Set((result?.results || []).filter(row=>row?.oid && String(row.upn||'').toLowerCase()===upn).map(row=>String(row.oid).toLowerCase()));
}

async function assertNoHistoricalOwnerConflict(identity, db) {
  const upn=String(identity?.upn||'').trim().toLowerCase(), oid=String(identity?.oid||'').trim().toLowerCase();
  if (!upn || !oid) throw Object.assign(new Error('Employee identity not found'),{status:400});
  const known=await knownOwnerIds(db,upn);
  if ([...known].some(savedOid=>savedOid!==oid)) throw Object.assign(new Error('Employee identity needs reconciliation'),{status:409});
}
function flattenUpstreamRecord(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  // SharePoint Get items sometimes wraps the actual columns in `fields` (and
  // a few older flow versions used `item`/`properties`). Flatten those
  // envelopes before looking for the canonical column names. Keep top-level
  // values authoritative when both shapes are present.
  const nested = ['fields', 'Fields', 'item', 'Item', 'properties', 'Properties']
    .map((key) => row[key])
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value))
    .reduce((merged, value) => Object.assign(merged, value), {});
  return Object.keys(nested).length ? { ...nested, ...row } : row;
}

// Do not release a multi-person attachment just because its outer header
// names the requesting employee. All explicit employee claims must agree.
function upstreamEmployeeClaimsAgree(sourceRow, mapped) {
  const row = flattenUpstreamRecord(sourceRow);
  if (!row || !mapped?.employee_upn) return false;
  const { payload } = upstreamPayloadAndRows(row);
  const headerName = text2(upstreamValue(row, ['employee_name', 'employeeName', 'EmployeeName', 'Employee Name', 'employee', 'Employee', 'gmt_employee']) || mapped.employee_name, '', 240).toLowerCase();
  const objects = [row, payload, ...collectUpstreamDailyRows(payload)].filter((value) => value && typeof value === 'object' && !Array.isArray(value));
  const emailKeys = new Set(['employeeupn', 'employeeemail', 'gmtemployeeupn']);
  const nameKeys = new Set(['employeename', 'gmtemployee']);
  let hasExplicitOwner=false;
  for (const object of objects) {
    for (const [key, value] of Object.entries(object)) {
      const normalizedKey = key.toLowerCase().replace(/_x0020_/g, '').replace(/[_\s]/g, '');
      if ((emailKeys.has(normalizedKey) || (object===row && normalizedKey==='email')) && text2(value, '', 320)) {
        if (text2(value, '', 320).toLowerCase() !== mapped.employee_upn.toLowerCase()) return false;
        hasExplicitOwner=true;
      }
      if (object !== row && nameKeys.has(normalizedKey) && text2(value, '', 240) && headerName && text2(value, '', 240).toLowerCase() !== headerName) return false;
    }
  }
  return hasExplicitOwner;
}
async function visibleTimesheetRevisions(env,identity) {
  try {
    const all=identity.isTimesheetViewer===true||identity.isSubmissionAdmin===true;
    const query=all?env.DB.prepare('SELECT owner_upn,revision FROM timesheet_owner_revisions ORDER BY owner_upn'):env.DB.prepare('SELECT owner_upn,revision FROM timesheet_owner_revisions WHERE owner_upn=? ORDER BY owner_upn').bind(String(identity.upn||'').toLowerCase());
    const result=await query.all(),map={};for(const row of result?.results||[])map[String(row.owner_upn).toLowerCase()]=Number(row.revision);return map;
  }catch(_){return null;}
}
async function holdOverlappingUpstreamTimesheets(env,identity,rows) {
  if (canViewAllRecords(identity,'timesheets')) return {rows,identityHold:false};
  const ids=[...new Set(rows.map(row=>String(row.source_record_id||'').trim().toLowerCase()).filter(Boolean))];
  // A review establishes a separate boundary for all of that person's
  // upstream timesheets, including copies without a matching source ID.
  // A local record also holds a copy with the same ID for other identities.
  const result=await env.DB.prepare(`SELECT NULL AS record_id, 1 AS identity_hold WHERE EXISTS (
      SELECT 1 FROM timesheet_ownership_reviews review LEFT JOIN records r ON r.record_id=review.record_id
      WHERE lower(review.subject_oid)=lower(?) OR lower(r.owner_upn)=lower(?)
    )
    UNION SELECT lower(record_id) AS record_id, 0 AS identity_hold FROM records
      WHERE kind='timesheets' AND lower(record_id) IN (SELECT value FROM json_each(?))
    UNION SELECT lower(record_id) AS record_id, 0 AS identity_hold FROM timesheet_ownership_reviews
      WHERE lower(record_id) IN (SELECT value FROM json_each(?))`).bind(String(identity.oid||''),String(identity.upn||''),JSON.stringify(ids),JSON.stringify(ids)).all();
  if (!Array.isArray(result?.results)) throw Object.assign(new Error('Timesheet source review is unavailable'),{status:503});
  const identityHold=result.results.some(row=>Number(row.identity_hold)===1);
  const held=new Set(result.results.map(row=>String(row.record_id||'').toLowerCase()));
  return {rows:rows.filter(row=>!(identityHold && canonicalKind(row.kind||row.action)==='timesheets') && !held.has(String(row.source_record_id||'').trim().toLowerCase())),identityHold};
}
async function listRecords(request, env, identity, payPeriods = defaultPayPeriods()) {
  const revisionsBefore=await visibleTimesheetRevisions(env,identity);
  const url = new URL(request.url);
  const sourceProbe = url.searchParams.get('source') === 'sharepoint-check';
  if (sourceProbe && identity.isSubmissionAdmin !== true) throw Object.assign(new Error('History source diagnostics require submission admin access'), { status: 403 });
  const requestedKind = url.searchParams.get('kind') || 'all';
  const kind = requestedKind === 'all' ? '' : canonicalKind(requestedKind);
  if (kind && !ALLOWED_KINDS.has(kind)) throw Object.assign(new Error('Record category is not supported'), { status: 400 });
  let timesheetIdentityReviewRequired=false;
  if ((!kind || kind === 'timesheets' || kind === 'clock') && !canViewAllRecords(identity,'timesheets')) {
    try { await assertNoHistoricalOwnerConflict(identity,env.DB); }
    catch (error) {
      if (error?.status!==409 || kind==='clock') throw error;
      timesheetIdentityReviewRequired=true;
    }
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 200), 1), 1000);
  const offset = Math.min(Math.max(Number(url.searchParams.get('offset') || 0), 0), 1000000);
  const payMonth = String(url.searchParams.get('payMonth') || '').trim();
  if (payMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(payMonth)) throw Object.assign(new Error('Pay month must use YYYY-MM format'), { status: 400 });
  const monthPeriod = payMonth && payPeriods && typeof payPeriods.periodForMonth === 'function'
    ? payPeriods.periodForMonth(payMonth)
    : null;
  if (payMonth && !monthPeriod) throw Object.assign(new Error('Pay month is not available'), { status: 400 });
  const projection = `SELECT r.*, q.status AS dispatch_status, q.attempts AS dispatch_attempts,
      q.queued_at AS dispatch_queued_at, q.last_sent_at AS dispatch_last_sent_at,
      q.last_error AS dispatch_last_error,
      EXISTS (SELECT 1 FROM timesheet_ownership_reviews reviewed WHERE reviewed.record_id=r.record_id) AS has_ownership_review
    FROM records r LEFT JOIN dispatch_queue q ON q.record_id = r.record_id`;
  const viewAll = Boolean(kind) && canViewAllRecords(identity, kind);
  const isTimesheetViewer = identity.isTimesheetViewer === true;
  const isSubmissionAdmin = identity.isSubmissionAdmin === true;
  const timesheetViewerAcrossKinds = !kind && isTimesheetViewer && !identity.isAdmin;
  const operationsAdminAcrossKinds = !kind && identity.isOperationsAdmin && !identity.isAdmin;
  const hrAdminAcrossKinds = !kind && identity.isHrAdmin && !identity.isAdmin && !identity.isOperationsAdmin;
  const jobCardAdminAcrossKinds = !kind && identity.isJobCardAdmin && !identity.isAdmin;
  // ?1 and ?2 are the signed-in OID and UPN wherever the own-record
  // predicate is used. Reuse them throughout the same SQL snapshot.
  const ownRecords = `((r.kind<>'timesheets' AND r.owner_oid=?1) OR (r.kind='timesheets' AND (
    EXISTS (SELECT 1 FROM timesheet_ownership_reviews review JOIN timesheet_review_record_revisions v
      ON v.record_id=review.record_id AND v.revision=review.record_revision
      WHERE review.record_id=r.record_id AND lower(review.subject_oid)=lower(?1) AND NOT EXISTS (
        SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated')))
    OR (NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=r.record_id)
      AND lower(r.owner_oid)=lower(?1) AND (r.action<>'pay_month_correction' OR lower(r.owner_upn)=?2)
      AND NOT EXISTS (SELECT 1 FROM profile_settings p WHERE lower(p.owner_upn)=?2 AND p.owner_oid<>'' AND lower(p.owner_oid)<>lower(?1))
      AND NOT EXISTS (SELECT 1 FROM records old WHERE lower(old.owner_upn)=?2 AND old.action<>'pay_month_correction'
        AND NOT (old.action='email_archive' AND old.owner_oid='shared-estimate-archive') AND old.owner_oid<>'' AND lower(old.owner_oid)<>lower(?1))))))`;
  const sharedRecordKinds = "r.kind IN ('job-cards')";
  const sql = !kind && isSubmissionAdmin
    ? `${projection} WHERE r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`
    : !kind && identity.isAdmin
    ? (isTimesheetViewer
      ? `${projection} WHERE r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`
      : `${projection} WHERE r.status <> 'Deleted' AND (r.kind NOT IN ('timesheets', 'clock') OR ${ownRecords}) ORDER BY r.updated_at DESC LIMIT ?`)
    : timesheetViewerAcrossKinds
      ? (identity.isOperationsAdmin
        ? `${projection} WHERE r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`
        : identity.isHrAdmin
          ? `${projection} WHERE r.status <> 'Deleted' AND (r.kind IN ('timesheets', 'clock', 'calendar') OR ${ownRecords}) ORDER BY r.updated_at DESC LIMIT ?`
          : `${projection} WHERE r.status <> 'Deleted' AND (r.kind IN ('timesheets', 'clock') OR ${ownRecords} OR ${sharedRecordKinds}) ORDER BY r.updated_at DESC LIMIT ?`)
    : operationsAdminAcrossKinds
      ? `${projection} WHERE r.status <> 'Deleted' AND (r.kind NOT IN ('timesheets', 'clock') OR ${ownRecords}) ORDER BY r.updated_at DESC LIMIT ?`
    : hrAdminAcrossKinds
      ? `${projection} WHERE r.status <> 'Deleted' AND (r.kind = 'calendar' OR ${ownRecords}) ORDER BY r.updated_at DESC LIMIT ?`
    : viewAll
      ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?`
    : jobCardAdminAcrossKinds
        ? `${projection} WHERE r.status <> 'Deleted' AND (${ownRecords} OR ${sharedRecordKinds}) ORDER BY r.updated_at DESC LIMIT ?`
        : (kind
          ? (viewAll ? `${projection} WHERE r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?` : `${projection} WHERE ${ownRecords} AND r.status <> 'Deleted' AND r.kind = ? ORDER BY r.updated_at DESC LIMIT ?`)
          : `${projection} WHERE (${ownRecords} OR ${sharedRecordKinds}) AND r.status <> 'Deleted' ORDER BY r.updated_at DESC LIMIT ?`);
  const bindings = !kind && isSubmissionAdmin
    ? [limit]
    : !kind && identity.isAdmin
    ? (isTimesheetViewer ? [limit] : [identity.oid, identity.upn, limit])
    : timesheetViewerAcrossKinds
      ? (identity.isOperationsAdmin ? [limit] : [identity.oid, identity.upn, limit])
    : operationsAdminAcrossKinds
      ? [identity.oid, identity.upn, limit]
    : hrAdminAcrossKinds
      ? [identity.oid, identity.upn, limit]
    : viewAll
      ? [kind || 'job-cards', limit]
      : jobCardAdminAcrossKinds
        ? [identity.oid, identity.upn, limit]
        : (kind ? (viewAll ? [kind, limit] : [identity.oid, identity.upn, kind, limit]) : [identity.oid, identity.upn, limit]);
  let pagedSql = sql.replace(/ORDER BY r\.updated_at DESC LIMIT \?/g, 'ORDER BY r.updated_at DESC, r.record_id ASC LIMIT ? OFFSET ?');
  const queryBindings = bindings.slice(0, -1);
  if (timesheetIdentityReviewRequired) {
    const orderIndex=pagedSql.indexOf(' ORDER BY');
    if(orderIndex<0)throw new Error('History ordering is unavailable');
    pagedSql=pagedSql.slice(0,orderIndex)+" AND r.kind <> 'clock'"+pagedSql.slice(orderIndex);
  }
  if (monthPeriod) {
    const cycleStart = String(monthPeriod.start || '');
    const cycleEnd = String(monthPeriod.cycleEnd || monthPeriod.end || '');
    const orderIndex = pagedSql.indexOf(' ORDER BY');
    if (orderIndex < 0 || !cycleStart || !cycleEnd) throw Object.assign(new Error('Pay-month history range is unavailable'), { status: 400 });
    pagedSql = pagedSql.slice(0, orderIndex) + ' AND ((r.record_date >= ? AND r.record_date <= ?) OR (r.start_date <= ? AND r.end_date >= ?))' + pagedSql.slice(orderIndex);
    queryBindings.push(cycleStart, cycleEnd, cycleEnd, cycleStart);
  }
  queryBindings.push(limit + 1, offset);
  const result = await env.DB.prepare(pagedSql).bind(...queryBindings).all();
  const includeSynthetic = identity.isAdmin && url.searchParams.get('includeSynthetic') === '1';
  const pageRows = result.results || [];
  const reviewedIds = canViewAllRecords(identity,'timesheets') ? new Set() : new Set(pageRows.filter(row=>row.has_ownership_review).map(row=>row.record_id));
  const hasMoreLocalRecords = pageRows.length > limit;
  const projectedLocalRecords = pageRows.slice(0, limit).map((row) => projectRow(row, true, env, payPeriods));
  const syntheticRecordCount = projectedLocalRecords.filter((row) => row.synthetic).length;
  let records = includeSynthetic ? projectedLocalRecords : projectedLocalRecords.filter((row) => !row.synthetic);
  const localRecordCount = records.length;
  let upstream = 'not-configured';
  let upstreamRecordCount = 0;
  let upstreamSourceRowCount = 0;
  let upstreamNormalisedRecordCount = 0;
  let upstreamEmployeeMatchedRecordCount = 0;
  let releasedUpstreamRecords = [];
  let timesheetHistoryHeld = false;
  const upstreamUrl = text2(env.HISTORY_UPSTREAM_URL, '', 2000);
  const upstreamEnabledForKind = !timesheetIdentityReviewRequired && (!kind || kind === 'timesheets' || kind === 'clock');
  const useSecureHistory = text2(env.HISTORY_SOURCE, '', 40).toLowerCase() === 'sharepoint';
  if ((sourceProbe || useSecureHistory) && upstreamEnabledForKind) {
    let result;
    try {
      result = await readSharePointHistory(env, identity);
    } catch (error) {
      if (!sourceProbe) {
        upstream = 'sharepoint-unavailable';
      } else {
        const known = ['Shared archive content access is not configured', 'Shared archive content authentication failed', 'SharePoint history is not configured', 'SharePoint history pagination is incomplete', 'Invalid SharePoint history continuation', 'Invalid SharePoint history response'];
        const safeStage = ['authentication', 'continuation', 'request', 'response', 'mapping'].includes(error?.historyStage) ? error.historyStage : 'unknown';
        const safeName = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'URIError'].includes(error?.name) ? error.name : 'Error';
        const errorText = String(error?.message || '');
        const safeReason = /redirect/i.test(errorText) ? ', redirect' : (/fetch|network|dns|connect|socket/i.test(errorText) ? ', network' : '');
        const detail = error?.publicMessage || (known.includes(error?.message) ? error.message : `History source processing failed at ${safeStage} (${safeName}${safeReason})`);
        throw Object.assign(new Error(detail), { status: 503, publicMessage: detail });
      }
    }
    if (result) {
      upstreamSourceRowCount = result.records.length;
      upstreamNormalisedRecordCount = result.records.length;
      upstreamEmployeeMatchedRecordCount = result.records.length;
      const upstreamCandidates=result.records.filter((row) => !kind || canonicalKind(row.kind || row.action) === kind || (kind === 'timesheets' && canonicalKind(row.action) === 'submission'));
      const upstreamHold = await holdOverlappingUpstreamTimesheets(env,identity,upstreamCandidates);
      const upstreamRecords=upstreamHold.rows;
      timesheetHistoryHeld=upstreamHold.identityHold||upstreamRecords.length!==upstreamCandidates.length;
      releasedUpstreamRecords = upstreamRecords;
      upstreamRecordCount = upstreamRecords.length;
      const merged = deduplicateProviderRecords([...records, ...upstreamRecords]);
      const fingerprints = new Set();
      records = removeStaleAbsenceRows(merged.filter((row) => {
        const fingerprint = historyRecordFingerprint(row);
        if (!fingerprint || fingerprints.has(fingerprint)) return false;
        fingerprints.add(fingerprint);
        return true;
      }));
      upstream = 'ok';
    }
  } else if (upstreamUrl && upstreamEnabledForKind) {
    const upstreamAuth = await verifiedUpstreamToken(request, env, identity);
    if (!upstreamAuth.token) {
      upstream = upstreamAuth.status;
    } else {
      try {
        const upstreamResponse = await fetchUpstreamHistory(upstreamUrl, upstreamAuth.token, kind, identity);
        if (upstreamResponse.ok) {
          const body = await upstreamResponse.json();
          const sourceRows = Array.isArray(body)
            ? body
            : body && Array.isArray(body.records)
              ? body.records
            : body && Array.isArray(body.value)
              ? body.value
              : body && Array.isArray(body.data)
                ? body.data
                : null;
          if (sourceRows) {
            upstreamSourceRowCount = sourceRows.length;
            const normalisedRows = sourceRows.map((source) => ({ source, row: normaliseUpstreamRecord(source, identity, env) }));
            upstreamNormalisedRecordCount = normalisedRows.filter(({ row }) => Boolean(row)).length;
            const mayViewAll = identity.isSubmissionAdmin === true || identity.isTimesheetViewer === true;
            const employeeMatchedRows = normalisedRows.filter(({ source, row }) => canReadHistoryRecord(identity, row)
              && (mayViewAll || upstreamEmployeeClaimsAgree(source, row)))
              .map(({ row }) => {
                if (!mayViewAll && row.payload) row.payload = { rows: row.payload.rows || [] };
                return row;
              });
            upstreamEmployeeMatchedRecordCount = employeeMatchedRows.length;
            const upstreamRecords = employeeMatchedRows.filter((row) => !kind || canonicalKind(row.kind || row.action) === kind || (kind === 'timesheets' && canonicalKind(row.action) === 'submission'));
            const upstreamCandidates=includeSynthetic ? upstreamRecords : upstreamRecords.filter((row) => !row.synthetic);
            const upstreamHold = await holdOverlappingUpstreamTimesheets(env,identity,upstreamCandidates);
            const visibleUpstreamRecords=upstreamHold.rows;
            timesheetHistoryHeld=upstreamHold.identityHold||visibleUpstreamRecords.length!==upstreamCandidates.length;
            releasedUpstreamRecords = visibleUpstreamRecords;
            upstreamRecordCount = visibleUpstreamRecords.length;
            // Merge corrected copies that share a source ID. A later partial
            // correction must not erase valid days from an earlier copy.
            const merged = deduplicateProviderRecords([...records, ...visibleUpstreamRecords])
              .sort((left, right) => String(right.updated_at || right.submitted_at || '').localeCompare(String(left.updated_at || left.submitted_at || '')));
            const fingerprints = new Set();
            records = removeStaleAbsenceRows(merged.filter((row) => {
              const fingerprint = historyRecordFingerprint(row);
              if (!fingerprint || fingerprints.has(fingerprint)) return false;
              fingerprints.add(fingerprint);
              return true;
            }));
            upstream = 'ok';
          } else upstream = 'invalid-response';
        } else upstream = `http-${upstreamResponse.status}`;
      } catch (_) {
        upstream = 'unavailable';
      }
    }
  } else if (upstreamUrl && !upstreamEnabledForKind) {
    upstream = 'not-requested-for-category';
  }
  if (upstream!=='ok' && !timesheetIdentityReviewRequired && !canViewAllRecords(identity,'timesheets') && (!kind || kind==='timesheets' || kind==='clock')) {
    const reviewHold=await holdOverlappingUpstreamTimesheets(env,identity,[]);
    timesheetHistoryHeld=timesheetHistoryHeld||reviewHold.identityHold;
  }
  if (monthPeriod) {
    const start = String(monthPeriod.start || '');
    const end = String(monthPeriod.cycleEnd || monthPeriod.end || '');
    const intersectsMonth = (record) => {
      const payload = record && record.payload && typeof record.payload === 'object' ? record.payload : {};
      const rows = payload.rows || payload.dailyRows || payload.daily_rows || record.rows || record.daily_rows || record.dailyRows;
      if (Array.isArray(rows) && rows.some((row) => {
        const date = String(row && (row.date || row.record_date || row.recordDate || row.workDate || row.Date) || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= start && date <= end;
      })) return true;
      const recordDate = String(record && (record.record_date || record.recordDate || record.event_date || record.completed_at || record.completedAt || record.created_at || record.submitted_at || record.updated_at) || payload.recordDate || payload.record_date || payload.date || payload.completedAt || payload.completed_at || payload.createdAt || payload.submittedAt || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(recordDate) && recordDate >= start && recordDate <= end) return true;
      const rangeStart = String(record && (record.start_date || record.startDate) || payload.startDate || payload.start_date || '').slice(0, 10);
      const rangeEnd = String(record && (record.end_date || record.endDate) || payload.endDate || payload.end_date || '').slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(rangeStart) && /^\d{4}-\d{2}-\d{2}$/.test(rangeEnd) && rangeStart <= end && rangeEnd >= start;
    };
    records = records.filter(intersectsMonth);
  }
  const canViewAllTimesheets = identity.isTimesheetViewer === true || identity.isSubmissionAdmin === true;
  records = records.map((record) => ({
    ...record,
    can_edit_record: reviewedIds.has(record.source_record_id) ? false : canEditRecord(identity, record, new Date(), payPeriods),
    can_edit: ['timesheets', 'clock'].includes(canonicalKind(record.kind || record.action))
      ? (reviewedIds.has(record.source_record_id) ? false : canEditRecord(identity, record, new Date(), payPeriods))
      : record.can_edit === true
  }));
  const completion = canViewAllTimesheets && (!kind || kind === 'timesheets')
    ? completionSummary(records, env)
    : null;
  records.sort((a, b) => String(b.updated_at || b.submitted_at).localeCompare(String(a.updated_at || a.submitted_at)));
  const revisionsAfter=await visibleTimesheetRevisions(env,identity);
  const revisionsConsistent=!timesheetIdentityReviewRequired&&!!revisionsBefore&&!!revisionsAfter&&JSON.stringify(revisionsBefore)===JSON.stringify(revisionsAfter);
  // The external history fetch cannot share the local ownership transaction.
  // If a conflicting identity appeared during that fetch, do not return its
  // rows; a fresh request will instead use the normal review-required path.
  if (upstream==='ok' && !timesheetIdentityReviewRequired && !canViewAllRecords(identity,'timesheets') && (!kind || kind==='timesheets' || kind==='clock')) {
    await assertNoHistoricalOwnerConflict(identity,env.DB);
    const stillVisible=await holdOverlappingUpstreamTimesheets(env,identity,releasedUpstreamRecords);
    if (stillVisible.rows.length!==releasedUpstreamRecords.length) throw Object.assign(new Error('Timesheet history changed during review. Refresh and try again.'),{status:409});
    timesheetHistoryHeld=timesheetHistoryHeld||stillVisible.identityHold;
  }
  return {
    records,
    meta: {
      upstream,
      timesheet_history_held:timesheetHistoryHeld,
      timesheet_identity_review_required:timesheetIdentityReviewRequired,
      timesheet_owner_revisions:revisionsConsistent?revisionsAfter:null,
      timesheet_revision_consistent:revisionsConsistent,
      local_record_count: localRecordCount,
      upstream_record_count: upstreamRecordCount,
      upstream_source_row_count: upstreamSourceRowCount,
      upstream_normalized_record_count: upstreamNormalisedRecordCount,
      upstream_employee_matched_record_count: upstreamEmployeeMatchedRecordCount,
      synthetic_record_count: syntheticRecordCount,
      synthetic_included: includeSynthetic,
      history_pagination: {
        limit,
        offset,
        has_more: hasMoreLocalRecords,
        next_offset: hasMoreLocalRecords ? offset + limit : null,
        pay_month: payMonth || null
      },
      role: identity.isAdmin ? 'accounts-admin' : (identity.isSubmissionAdmin ? 'submissions-manager' : (identity.isHrAdmin ? 'accounts-hr' : (identity.isOperationsAdmin ? 'operations-admin' : (identity.isJobCardAdmin ? 'job-card-admin' : 'employee')))),
      is_admin: identity.isAdmin,
      is_hr_admin: identity.isHrAdmin,
      is_submission_admin: isSubmissionAdmin,
      can_view_all_timesheets: canViewAllTimesheets,
      is_xero_admin: identity.isXeroAdmin,
      is_operations_admin: identity.isOperationsAdmin,
      is_job_card_admin: identity.isJobCardAdmin,
      editable_pay_months: identity.isAdmin ? editablePayCycleKeys(new Date(), 'Europe/London', payPeriods) : currentPayCycleKeys(new Date(), 'Europe/London', payPeriods),
      self_editable_pay_months: currentPayCycleKeys(new Date(), 'Europe/London', payPeriods),
      visible_scope: timesheetIdentityReviewRequired
        ? 'other authorised submissions; timesheets held for an Accounts identity check'
        : isSubmissionAdmin
        ? 'all submissions and all employee timesheets and clock records; My Submissions edit access'
        : identity.isTimesheetViewer
        ? 'all employee timesheets and clock records'
        : identity.isAdmin
          ? 'all non-timesheet submissions; this account timesheets and clock records'
          : identity.isHrAdmin
            ? 'shared calendar requests and this account submissions'
            : identity.isOperationsAdmin
              ? 'all non-timesheet submissions; this account timesheets and clock records'
              : identity.isJobCardAdmin
                ? 'all job cards; this account submissions for other categories'
                : 'this account submissions',
      completion
    }
  };
}
__name(listRecords, "listRecords");
async function handle(request, env, ctx) {
  const origin = allowedOrigin(request, env);
  if (origin === null) return json({ error: "Origin is not allowed" }, 403);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin || "") });
  }
  const url = new URL(request.url);
  if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true, service: "gmt-portal-api", version: 1 }, 200, origin || "");
  if (url.pathname === "/api/integrations/timesheet-delivery-receipts" && request.method === "POST") {
    return timesheetDeliveryReceiptEndpoint(request, env, origin || "");
  }
  if (url.pathname === "/api/xero/callback" && request.method === "GET") {
    if (!env.DB) return xeroRedirectResponse(xeroSettings(env).returnUrl, "error", "storage-not-configured");
    return completeXeroConnection(request, env);
  }
  if (url.pathname === "/api/archive/sync/estimates" && request.method === "POST") {
    return estimateArchiveIngestEndpoint(request, env, origin || "");
  }
  const identity = await authenticate(request, env);
  if (!env.DB) throw Object.assign(new Error("Protected storage is not configured"), { status: 503 });
  if (url.pathname === "/api/access" && request.method === "GET") {
    return json({
      isAdmin: identity.isAdmin,
      isHrAdmin: identity.isHrAdmin,
      isXeroAdmin: identity.isXeroAdmin,
      isOperationsAdmin: identity.isOperationsAdmin,
      isJobCardAdmin: identity.isJobCardAdmin,
      canManageSubmissions: identity.isSubmissionAdmin === true,
      canReviewOffsite: identity.canReviewOffsite === true,
      canManagePayMonthStarts: identity.canManagePayMonthStarts,
      roles: identity.assignedRoles || []
    }, 200, origin || "");
  }
  const offsiteClockResponse = await offsiteClockEndpoint(request, env, identity, readJson);
  if (offsiteClockResponse) return json(offsiteClockResponse.body, offsiteClockResponse.status, origin || "");
  if (url.pathname === "/api/pay-month-starts" && ["GET", "POST"].includes(request.method)) {
    return payMonthStartsEndpoint(request, env, identity, origin || "");
  }
  if (url.pathname === "/api/admin/users" && ["GET", "POST"].includes(request.method)) return adminUsersEndpoint(request, env, identity, origin || "");
  if (url.pathname === "/api/admin/job-card-batches/start" && request.method === "POST") return jobCardBatchStartEndpoint(request, env, identity, origin || "");
  if (url.pathname === "/api/job-cards/archive/access" && request.method === "GET") {
    return json({ canImport: Boolean(identity.isAdmin || identity.isJobCardAdmin) }, 200, origin || "");
  }
  const jobCardBatchStatusMatch = url.pathname.match(/^\/api\/admin\/job-card-batches\/([^/]+)\/status$/);
  if (jobCardBatchStatusMatch && request.method === "GET") {
    return jobCardBatchStatusEndpoint(env, identity, decodeURIComponent(jobCardBatchStatusMatch[1]), origin || "");
  }
  if (url.pathname === "/api/admin/job-card-upload-sessions" && request.method === "POST") return jobCardUploadSessionEndpoint(request, env, identity, origin || "");
  if (url.pathname === "/api/admin/job-card-batches/complete" && request.method === "POST") return jobCardBatchCompleteEndpoint(request, env, identity, origin || "");
  if (url.pathname === "/api/admin/job-cards/import" && request.method === "POST") return jobCardImportEndpoint(request, env, identity, origin || "");
  if (url.pathname === "/api/job-cards/archive/search" && request.method === "GET") return listJobCardArchiveEndpoint(request, env, identity, origin || "");
  const jobCardArchiveContentMatch = url.pathname.match(/^\/api\/job-cards\/archive\/([^/]+)\/content$/);
  if (jobCardArchiveContentMatch && request.method === "GET") {
    return jobCardArchiveContentEndpoint(env, identity, decodeURIComponent(jobCardArchiveContentMatch[1]), origin || "");
  }
  const jobCardArchiveReviewMatch = url.pathname.match(/^\/api\/job-cards\/archive\/([^/]+)\/review$/);
  if (jobCardArchiveReviewMatch && request.method === "PATCH") {
    return jobCardArchiveReviewEndpoint(request, env, identity, decodeURIComponent(jobCardArchiveReviewMatch[1]), origin || "");
  }
  const jobCardArchiveDetailMatch = url.pathname.match(/^\/api\/job-cards\/archive\/([^/]+)$/);
  if (jobCardArchiveDetailMatch && request.method === "GET") {
    return jobCardArchiveDetailEndpoint(env, identity, decodeURIComponent(jobCardArchiveDetailMatch[1]), origin || "");
  }
  if (url.pathname === "/api/archive/estimates" && request.method === "GET") {
    requireEstimateArchiveAccess(identity);
    return listEstimateArchiveEndpoint(request, env, origin || "");
  }
  if (url.pathname === "/api/archive/estimates/app" && request.method === "POST") {
    requireEstimateArchiveAccess(identity);
    return createAppEstimateEndpoint(request, env, identity, origin || "");
  }
  if (url.pathname === "/api/estimates/send" && request.method === "POST") return sendClientEstimateEndpoint(request, env, identity, origin || "");
  const archiveContentMatch = url.pathname.match(/^\/api\/archive\/estimates\/([^/]+)\/content\/([^/]+)$/);
  if (archiveContentMatch && request.method === "GET") {
    requireEstimateArchiveAccess(identity);
    return estimateArchiveContentEndpoint(env, decodeURIComponent(archiveContentMatch[1]), decodeURIComponent(archiveContentMatch[2]), origin || "");
  }
  const archiveDetailMatch = url.pathname.match(/^\/api\/archive\/estimates\/([^/]+)$/);
  if (archiveDetailMatch && request.method === "GET") {
    requireEstimateArchiveAccess(identity);
    return estimateArchiveDetailEndpoint(env, origin || "", decodeURIComponent(archiveDetailMatch[1]));
  }
  if (url.pathname === "/api/xero/connect" && request.method === "POST") return startXeroConnection(request, env, identity, origin || "");
  if (url.pathname === "/api/xero/status" && request.method === "GET") return xeroStatus(env, identity, origin || "");
  if (url.pathname === "/api/estimates/index" && ["GET", "POST"].includes(request.method)) {
    requireEstimateArchiveAccess(identity);
    return request.method === "GET" ? estimateIndexListEndpoint(request, env, identity, origin || "") : estimateIndexUpsertEndpoint(request, env, identity, origin || "");
  }
  if (url.pathname === "/api/xero/setup-data" && request.method === "GET") return xeroSetupDataEndpoint(request, env, identity, origin || "");
  if (url.pathname === "/api/xero/records" && request.method === "GET") return xeroInvoiceRecords(request, env, identity, origin || "");
  if (url.pathname === "/api/xero/invoices" && request.method === "GET") return listXeroInvoicesEndpoint(request, env, identity, origin || "");
  if (url.pathname === "/api/xero/invoices" && request.method === "POST") return createXeroInvoice(request, env, identity, origin || "");
  if (url.pathname === "/api/xero/invoices/lookup" && request.method === "POST") return lookupXeroInvoiceEndpoint(request, env, identity, origin || "");
  const xeroInvoiceLinksMatch = url.pathname.match(/^\/api\/xero\/invoices\/([^/]+)\/links$/);
  if (xeroInvoiceLinksMatch && request.method === "GET") return xeroInvoiceLinksEndpoint(request, env, identity, origin || "", decodeURIComponent(xeroInvoiceLinksMatch[1]));
  const xeroInvoiceActionMatch = url.pathname.match(/^\/api\/xero\/invoices\/([^/]+)\/(send|delete|links)$/);
  if (xeroInvoiceActionMatch && request.method === "POST") {
    const invoiceId = decodeURIComponent(xeroInvoiceActionMatch[1]);
    if (xeroInvoiceActionMatch[2] === "send") return sendXeroInvoice(request, env, identity, origin || "", invoiceId);
    if (xeroInvoiceActionMatch[2] === "delete") return deleteXeroInvoice(request, env, identity, origin || "", invoiceId);
    return linkXeroInvoice(request, env, identity, origin || "", invoiceId);
  }
  const xeroInvoiceMatch = url.pathname.match(/^\/api\/xero\/invoices\/([^/]+)$/);
  if (xeroInvoiceMatch && request.method === "GET") return xeroInvoiceDetailEndpoint(request, env, identity, origin || "", decodeURIComponent(xeroInvoiceMatch[1]));
  if (xeroInvoiceMatch && request.method === "PATCH") return updateXeroInvoice(request, env, identity, origin || "", decodeURIComponent(xeroInvoiceMatch[1]));
  const recordInvoiceLinksMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/([^/]+)\/invoices$/);
  if (recordInvoiceLinksMatch && request.method === "GET") return recordInvoiceLinksEndpoint(request, env, identity, origin || "", decodeURIComponent(recordInvoiceLinksMatch[1]), decodeURIComponent(recordInvoiceLinksMatch[2]));
  const xeroJobSyncMatch = url.pathname.match(/^\/api\/xero\/job-cards\/([^/]+)\/sync$/);
  if (xeroJobSyncMatch && request.method === "POST") return syncXeroJobCard(request, env, identity, origin || "", decodeURIComponent(xeroJobSyncMatch[1]));
  if (url.pathname === "/api/profile" && request.method === "GET") {
    return json({ profile: await getProfileSettings(env, identity) }, 200, origin || "");
  }
  if (url.pathname === "/api/profile" && (request.method === "PUT" || request.method === "POST")) {
    const body = await readJson(request);
    return json({ ok: true, profile: await saveProfileSettings(env, identity, body) }, 200, origin || "");
  }
  if (url.pathname === "/api/admin/dispatch-queue" && request.method === "POST") {
    if (!identity.isAdmin) throw Object.assign(new Error("Correction replay is restricted to Accounts"), { status: 403 });
    const body = await readJson(request);
    return json(await adminDispatchQueued(env, identity, { dryRun: body.dryRun === true }), 200, origin || "");
  }
  if (url.pathname === "/api/admin/dispatch-queue" && request.method === "GET") {
    return json(await adminQueueStatus(env, identity), 200, origin || "");
  }
  if (url.pathname === "/api/history" && request.method === "GET") {
    const payPeriods2 = await loadPayPeriods(env);
    return json(await listRecords(request, env, identity, payPeriods2), 200, origin || "");
  }
  if (url.pathname === "/api/records" && request.method === "POST") {
    const payPeriods2 = await loadPayPeriods(env);
    const body = await readJson(request);
    if (body.action === "pay_month_correction") validatePayMonthCorrection(body, /* @__PURE__ */ new Date(), payPeriods2, identity);
    const recordId = text2(body.recordId || body.sourceRecordId || body.source_record_id || body.gmt_record_id, "", MAX_RECORD_ID2);
    const existing = recordId ? await env.DB.prepare("SELECT * FROM records WHERE record_id = ?").bind(recordId).first() : null;
    if (existing && existing.status === "Deleted") throw Object.assign(new Error("This record has been deleted"), { status: 409 });
    if (existing && !canEditRecord(identity, existing, /* @__PURE__ */ new Date(), payPeriods2)) throw Object.assign(new Error("This record is read-only for your account"), { status: 403 });
    if (existing?.action === "archive_import") throw Object.assign(new Error("Scanned job-card records are managed through Accounts review"), { status: 409 });
    if (existing && existing.action === "pay_month_correction" && body.action !== "pay_month_correction") throw Object.assign(new Error("A pay-month correction cannot change record type"), { status: 400 });
    validatePortalRequestMutation(body, existing, identity);
    const input = normaliseInput(body, existing && (identity.isAdmin || identity.isSubmissionAdmin || identity.isOperationsAdmin && existing.kind !== "timesheets" && existing.kind !== "clock" || existing.kind === "job-cards" && identity.isJobCardAdmin) ? { ...identity, name: existing.employee_name } : identity, existing, env, payPeriods2);
    const result = await saveRecord(env, input, identity, existing);
    return json({ ok: true, record_id: input.recordId, ...result }, result.created ? 201 : 200, origin || "");
  }
  const attachmentContentMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/attachments\/([^/]+)\/content$/);
  if (attachmentContentMatch) {
    const recordId = decodeURIComponent(attachmentContentMatch[1]);
    const attachmentId = decodeURIComponent(attachmentContentMatch[2]);
    if (request.method === "GET") return jobCardAttachmentContentEndpoint(env, identity, recordId, attachmentId, origin || "");
    if (request.method === "PUT") return jobCardAttachmentUploadEndpoint(request, env, identity, recordId, attachmentId, origin || "");
  }
  const attachmentCompleteMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/attachments\/([^/]+)\/complete$/);
  if (attachmentCompleteMatch && request.method === "POST") {
    return jobCardAttachmentCompleteEndpoint(env, identity, decodeURIComponent(attachmentCompleteMatch[1]), decodeURIComponent(attachmentCompleteMatch[2]), origin || "");
  }
  const attachmentMatch = url.pathname.match(/^\/api\/records\/([^/]+)\/attachments$/);
  if (attachmentMatch && ["GET", "POST"].includes(request.method)) {
    const recordId = decodeURIComponent(attachmentMatch[1]);
    const existing = await env.DB.prepare("SELECT * FROM records WHERE record_id = ?").bind(recordId).first();
    if (!existing) return json({ error: "Record not found" }, 404, origin || "");
    if (existing.kind === "job-cards") {
      if (request.method === "GET") {
        await jobCardRecordForAttachment(env, identity, recordId);
        return json({ attachments: await listJobCardAttachments(env, recordId) }, 200, origin || "");
      }
      return jobCardAttachmentStartEndpoint(request, env, identity, recordId, origin || "");
    }
    if (request.method !== "POST") return json({ error: "Attachments are only available for job cards" }, 400, origin || "");
    const payPeriods2 = await loadPayPeriods(env);
    if (!canEditRecord(identity, existing, /* @__PURE__ */ new Date(), payPeriods2)) return json({ error: "Record access is not permitted" }, 403, origin || "");
    if (existing.status === "Deleted") return json({ error: "Record has been deleted" }, 410, origin || "");
    if (existing.kind !== "timesheets") return json({ error: "Only timesheet corrections can be queued" }, 400, origin || "");
    const body = await readJson(request);
    const result = await queueRecordAttachments(env, existing, body);
    if (result.skipped) {
      const timestamp = now();
      await env.DB.prepare("UPDATE records SET status = 'Test - not sent', issue = '', updated_at = ? WHERE record_id = ?").bind(timestamp, recordId).run();
      return json({ ok: true, record_id: recordId, ...result }, 200, origin || "");
    }
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(dispatchQueued(env, { limit: 1, recordId }).catch(() => null));
    }
    return json({ ok: true, record_id: recordId, ...result }, 202, origin || "");
  }
  const detailMatch = url.pathname.match(/^\/api\/records\/([^/]+)$/);
  if (detailMatch) {
    const recordId = decodeURIComponent(detailMatch[1]);
    const existing = await env.DB.prepare(`SELECT r.*, q.status AS dispatch_status, q.attempts AS dispatch_attempts,
        q.queued_at AS dispatch_queued_at, q.last_sent_at AS dispatch_last_sent_at,
        q.last_error AS dispatch_last_error
      FROM records r LEFT JOIN dispatch_queue q ON q.record_id = r.record_id WHERE r.record_id = ?`).bind(recordId).first();
    if (!existing) return json({ error: "Record not found" }, 404, origin || "");
    if (request.method === 'GET' && existing.kind === 'timesheets' && !canViewAllRecords(identity,'timesheets')) {
      const oid=String(identity.oid || '').trim().toLowerCase(), upn=String(identity.upn || '').trim().toLowerCase();
      // Resolve the decision and the record in one query. Once a record has
      // ever had a review, its original editor fields cannot restore access
      // after revocation or invalidation.
      const visible = await env.DB.prepare(`SELECT r.*, q.status AS dispatch_status, q.attempts AS dispatch_attempts,
          q.queued_at AS dispatch_queued_at, q.last_sent_at AS dispatch_last_sent_at, q.last_error AS dispatch_last_error,
          EXISTS (SELECT 1 FROM timesheet_ownership_reviews review
            JOIN timesheet_review_record_revisions v ON v.record_id=review.record_id AND v.revision=review.record_revision
            WHERE review.record_id=r.record_id AND lower(review.subject_oid)=? AND NOT EXISTS (
              SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated'))) AS reviewed_access
        FROM records r LEFT JOIN dispatch_queue q ON q.record_id=r.record_id
        WHERE r.record_id=? AND r.kind='timesheets' AND r.status<>'Deleted' AND (
          EXISTS (SELECT 1 FROM timesheet_ownership_reviews review
            JOIN timesheet_review_record_revisions v ON v.record_id=review.record_id AND v.revision=review.record_revision
            WHERE review.record_id=r.record_id AND lower(review.subject_oid)=? AND NOT EXISTS (
              SELECT 1 FROM timesheet_ownership_review_events e WHERE e.review_id=review.review_id AND e.event_type IN ('revoked','invalidated')))
          OR (NOT EXISTS (SELECT 1 FROM timesheet_ownership_reviews review WHERE review.record_id=r.record_id)
            AND lower(r.owner_oid)=? AND (r.action<>'pay_month_correction' OR lower(r.owner_upn)=?)
            AND NOT EXISTS (SELECT 1 FROM profile_settings p WHERE lower(p.owner_upn)=? AND p.owner_oid<>'' AND lower(p.owner_oid)<>?)
            AND NOT EXISTS (SELECT 1 FROM records old WHERE lower(old.owner_upn)=? AND old.action<>'pay_month_correction'
              AND NOT (old.action='email_archive' AND old.owner_oid='shared-estimate-archive') AND old.owner_oid<>'' AND lower(old.owner_oid)<>?)))`)
        .bind(oid,recordId,oid,oid,upn,upn,oid,upn,oid).first();
      if (!visible) return json({ error:'Record access is not permitted' },403,origin || '');
      const payPeriods=await loadPayPeriods(env), reviewed=Boolean(visible.reviewed_access);
      const record=projectRow(visible,true,env,payPeriods);
      record.can_edit=reviewed ? false : canEditRecord(identity,visible,new Date(),payPeriods);
      record.can_edit_record=record.can_edit;
      return json({ record,payload:payloadObject(visible) },200,origin || '');
    }
    if (!canAccessRecord(identity, existing)) return json({ error: "Record access is not permitted" }, 403, origin || "");
    if (existing.status === "Deleted") return json({ error: "Record has been deleted" }, 410, origin || "");
    if (request.method === "GET") {
      const payPeriods2 = await loadPayPeriods(env);
      const record = projectRow(existing, true, env, payPeriods2);
      record.can_edit = ["timesheets", "clock"].includes(canonicalKind(existing.kind)) && canEditRecord(identity, existing, /* @__PURE__ */ new Date(), payPeriods2);
      record.can_edit_record = canEditRecord(identity, existing, /* @__PURE__ */ new Date(), payPeriods2);
      return json({ record, payload: payloadObject(existing) }, 200, origin || "");
    }
    if (existing.action === "archive_import" && (request.method === "PATCH" || request.method === "DELETE")) return json({ error: "Scanned job-card records are managed through Accounts review" }, 409, origin || "");
    if (request.method === "PATCH") {
      const payPeriods2 = await loadPayPeriods(env);
      if (!canEditRecord(identity, existing, /* @__PURE__ */ new Date(), payPeriods2)) return json({ error: "This record is read-only for your account." }, 403, origin || "");
      const body = await readJson(request);
      if (existing.action === "pay_month_correction" && body.action !== "pay_month_correction") return json({ error: "A pay-month correction cannot change record type" }, 400, origin || "");
      if (existing.action === "pay_month_correction") validatePayMonthCorrection(body, /* @__PURE__ */ new Date(), payPeriods2, identity);
      validatePortalRequestMutation(body, existing, identity);
      const input = normaliseInput({ ...body, recordId }, identity.isAdmin || identity.isSubmissionAdmin || identity.isOperationsAdmin && existing.kind !== "timesheets" && existing.kind !== "clock" || existing.kind === "job-cards" && identity.isJobCardAdmin ? { ...identity, name: existing.employee_name } : identity, existing, env, payPeriods2);
      const result = await saveRecord(env, input, identity, existing);
      return json({ ok: true, record_id: input.recordId, ...result }, 200, origin || "");
    }
    if (request.method === "DELETE") {
      if (identity.isSubmissionAdmin === true && !isOwnerRecord(identity, existing)) return json({ error: "Submission managers can edit records but cannot delete another employee\u2019s submission." }, 403, origin || "");
      if (url.searchParams.has("day") && (existing.kind === "timesheets" || existing.kind === "clock")) {
        return json({ error: "Single-day deletion is not available from the calendar yet. Remove the day in the pay-month sheet editor." }, 409, origin || "");
      }
      const result = await deleteRecord(env, existing, identity);
      return json({ ok: true, record_id: recordId, ...result }, 200, origin || "");
    }
  }
  return json({ error: "Route not found" }, 404, origin || "");
}
__name(handle, "handle");
var index_default = {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env, ctx);
    } catch (error) {
      const status = Number(error && error.status) || 500;
      const message = error?.publicMessage || (status >= 500 ? "GMT portal service is temporarily unavailable" : error.message || "Request failed");
      const origin = allowedOrigin(request, env);
      return json({ error: message }, status, origin || "");
    }
  },
  async scheduled(event, env, ctx) {
    const scheduledAt = new Date(Number(event?.scheduledTime || Date.now()));
    if (!shouldDispatchNow(scheduledAt, env)) return;
    ctx.waitUntil(dispatchQueued(env));
  }
};
export {
  adminDispatchQueued,
  adminQueueStatus,
  canAccessRecord,
  canReadHistoryRecord,
  canViewAllRecords,
  canViewRecord,
  canonicalEstimateInput,
  completionSummary,
  completionWeeks,
  correlateEstimateRecords,
  decryptXeroSecret,
  index_default as default,
  dispatchEndpoint,
  dispatchForm,
  dispatchQueued,
  emailEstimatePortalRecordId,
  encryptXeroSecret,
  getProfileSettings,
  historyRecordFingerprint,
  historyTitleDetails,
  isCurrentMonthRecord,
  isCurrentPayMonthRecord,
  listEstimateIndex,
  listRecords,
  listXeroInvoices,
  monthKeyInTimeZone,
  normaliseInput,
  normaliseUpstreamRecord,
  parseQueuedAttachments,
  profileView,
  projectRow,
  readSharePointHistory,
  recordMonthKey,
  saveProfileSettings,
  shouldDispatchNow,
  staffDirectory,
  tokenIdentity,
  upsertEstimateIndex,
  upstreamHistoryScope,
  validateNoFutureWork,
  validatePayMonthCorrection,
  validatePortalRequestDeletion,
  validatePortalRequestMutation,
  xeroAccountingRequest,
  xeroInvoiceDeliveryStatus,
  xeroInvoiceMutationPolicy,
  xeroInvoicePayload,
  xeroInvoicePaymentStatus,
  xeroInvoiceProjection,
  xeroInvoiceRecords,
  xeroOAuthStateMatches,
  xeroSettings
};
//# sourceMappingURL=index.js.map
