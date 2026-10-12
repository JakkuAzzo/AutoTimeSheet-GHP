(function () {
  "use strict";
  if (!window.GMTPortalApi || typeof window.GMTPortalApi.access !== "function") return;
  window.GMTPortalApi.access().then(function (access) {
    var isHrOnly = !!(access && access.isHrAdmin && !access.isAdmin);
    document.querySelectorAll("[data-hide-for-hr]").forEach(function (element) { element.hidden = isHrOnly; });
    var invoiceCard = document.getElementById("xero-invoices-card");
    if (invoiceCard && access && access.isXeroAdmin) { invoiceCard.hidden = false; invoiceCard.removeAttribute("aria-hidden"); }
  }).catch(function () {});
}());
