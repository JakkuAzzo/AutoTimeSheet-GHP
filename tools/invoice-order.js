(function (root) {
  "use strict";

  function newestFirst(invoices) {
    return (Array.isArray(invoices) ? invoices : []).slice().sort(function (left, right) {
      var leftDate = Date.parse(String(left && left.date || ""));
      var rightDate = Date.parse(String(right && right.date || ""));
      var leftValid = Number.isFinite(leftDate);
      var rightValid = Number.isFinite(rightDate);
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      if (leftValid && leftDate !== rightDate) return rightDate - leftDate;
      return String(left && left.invoice_id || "").localeCompare(String(right && right.invoice_id || ""));
    });
  }

  function selectNewest(invoices, limit) {
    var count = Math.max(0, Math.min(Math.floor(Number(limit) || 0), 25));
    return newestFirst(invoices).filter(function (invoice) {
      return Number.isFinite(Date.parse(String(invoice && invoice.date || ""))) && String(invoice && invoice.invoice_id || "").trim();
    }).slice(0, count);
  }

  root.GMTInvoiceOrder = { newestFirst: newestFirst, selectNewest: selectNewest };
})(globalThis);
