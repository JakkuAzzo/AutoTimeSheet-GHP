(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GMTInvoiceRegisterState = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function summarizePages(pages) {
    var sourceCounts = { sharepoint: 0, xero: 0, unarchived: 0 };
    var timestamps = [];
    (Array.isArray(pages) ? pages : []).forEach(function (page) {
      var archive = page && page.archive || {};
      if (archive.source === 'sharepoint') {
        sourceCounts.sharepoint += 1;
        if (archive.cached_at) timestamps.push(String(archive.cached_at));
      } else if (archive.source === 'xero') {
        sourceCounts.xero += 1;
        if (!archive.stored) sourceCounts.unarchived += 1;
        var timestamp = archive.cached_at || page.refreshed_at;
        if (timestamp) timestamps.push(String(timestamp));
      }
    });
    timestamps.sort(function (left, right) { return Date.parse(left) - Date.parse(right); });
    return {
      source_counts: sourceCounts,
      timestamps: {
        oldest_at: timestamps.length ? timestamps[0] : '',
        newest_at: timestamps.length ? timestamps[timestamps.length - 1] : ''
      }
    };
  }

  function makeSnapshot(tenantId, savedAt, pages, invoices, complete) {
    var summary = summarizePages(pages);
    return {
      tenant_id: String(tenantId || ''),
      saved_at: String(savedAt || ''),
      complete: complete === true,
      source_counts: summary.source_counts,
      timestamps: summary.timestamps,
      invoices: Array.isArray(invoices) ? invoices : []
    };
  }

  function save(storage, key, snapshot, tenantId) {
    if (!storage || !snapshot || snapshot.complete !== true || !tenantId || snapshot.tenant_id !== String(tenantId)) return false;
    try {
      storage.setItem(key, JSON.stringify(snapshot));
      return true;
    } catch (_) {
      return false;
    }
  }

  function load(storage, key, tenantId) {
    if (!storage || !tenantId) return null;
    try {
      var snapshot = JSON.parse(storage.getItem(key) || 'null');
      if (!snapshot || snapshot.complete !== true || snapshot.tenant_id !== String(tenantId) || !Array.isArray(snapshot.invoices)) return null;
      return snapshot;
    } catch (_) {
      return null;
    }
  }

  return { summarizePages: summarizePages, makeSnapshot: makeSnapshot, save: save, load: load };
});
