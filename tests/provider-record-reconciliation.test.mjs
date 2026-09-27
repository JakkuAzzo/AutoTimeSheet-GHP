import assert from 'node:assert/strict';
import test from 'node:test';
import { deduplicateProviderRecords, removeStaleAbsenceRows } from '../cloudflare-worker/src/provider-reconciliation.js';

function row(date, values = {}) {
  return { date, ...values };
}

test('a newer no-absence correction removes stale holiday-only rows for the same source record', () => {
  const older = {
    source_record_id: 'timesheet-matthew-2026-08-31',
    employee_name: 'Matthew',
    updated_at: '2026-09-15T15:11:58.063Z',
    payload: {
      rows: [
        row('2026-09-01', { absenceReason: 'Holiday', workedHours: 0 }),
        row('2026-09-02', { absenceReason: 'Holiday', workedHours: 0 }),
        row('2026-09-03', { absenceReason: 'Holiday', workedHours: 0 }),
        row('2026-09-04', { absenceReason: 'Holiday', workedHours: 0 })
      ],
      absenceCount: 4
    }
  };
  const correction = {
    source_record_id: 'timesheet-matthew-2026-08-31',
    employee_name: 'Matthew',
    updated_at: '2026-09-21T15:10:43.487Z',
    payload: {
      rows: [
        row('2026-09-03', { start: '08:00', finish: '17:00', absenceStatus: 'NA', workedHours: 9 }),
        row('2026-09-04', { start: '08:00', finish: '17:00', absenceStatus: 'NA', workedHours: 9 })
      ],
      absenceCount: 0
    }
  };

  const [merged] = deduplicateProviderRecords([older, correction]);
  assert.deepEqual(merged.payload.rows.map((item) => item.date).sort(), ['2026-09-03', '2026-09-04']);
  assert.equal(merged.payload.rows.every((item) => item.absenceReason !== 'Holiday'), true);
});

test('worked rows from an older variant remain when the newer variant is only a partial correction', () => {
  const older = {
    source_record_id: 'timesheet-simon-2026-09-07',
    employee_name: 'Simon',
    updated_at: '2026-09-15T15:11:58.063Z',
    payload: { rows: [row('2026-09-07', { start: '07:30', finish: '17:30', workedHours: 10 })] }
  };
  const correction = {
    source_record_id: 'timesheet-simon-2026-09-07',
    employee_name: 'Simon',
    updated_at: '2026-09-21T15:10:43.487Z',
    payload: { rows: [row('2026-09-08', { start: '08:00', finish: '18:00', workedHours: 10 })] }
  };

  const [merged] = deduplicateProviderRecords([older, correction]);
  assert.deepEqual(merged.payload.rows.map((item) => item.date).sort(), ['2026-09-07', '2026-09-08']);
});

test('a zero-absence correction suppresses stale holiday rows from a separate reconciliation record', () => {
  const corrected = {
    source_record_id: 'timesheet-matthew-2026-08-31',
    employee_name: 'matthew',
    owner_upn: 'matthew@gmt-services.co.uk',
    start_date: '2026-08-31',
    end_date: '2026-09-11',
    updated_at: '2026-09-21T17:01:57.252Z',
    payload: {
      weekStart: '2026-08-31',
      weekEnd: '2026-09-11',
      totals: { absent: 0, holiday: 0 },
      rows: [row('2026-09-03', { start: '08:00', finish: '18:00', absenceStatus: 'NA', workedHours: 9 })]
    }
  };
  const stale = {
    source_record_id: 'reconcile-matthew-2026-08-31',
    employee_name: 'Matthew',
    owner_upn: 'matthew@gmt-services.co.uk',
    start_date: '2026-08-31',
    end_date: '2026-09-06',
    updated_at: '',
    payload: {
      totals: { absent: 5, holiday: 5 },
      rows: [
        row('2026-09-01', { absenceStatus: 'Holiday', workedHours: 0 }),
        row('2026-09-02', { absenceStatus: 'Holiday', workedHours: 0 }),
        row('2026-09-03', { absenceStatus: 'Holiday', workedHours: 0 })
      ]
    }
  };

  const cleaned = removeStaleAbsenceRows([corrected, stale]);
  const staleAfter = cleaned.find((record) => record.source_record_id === stale.source_record_id);
  assert.deepEqual(staleAfter.payload.rows, []);
  assert.equal(cleaned.find((record) => record.source_record_id === corrected.source_record_id).payload.rows.length, 1);
});
