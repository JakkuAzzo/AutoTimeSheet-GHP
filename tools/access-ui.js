(function () {
  "use strict";

  var api = window.GMTPortalApi || {};
  var status = document.querySelector("[data-tools-access-status]");
  var retry = document.querySelector("[data-tools-access-retry]");

  function setCardVisible(name, visible) {
    var card = document.querySelector('[data-tool-card="' + name + '"]');
    if (!card) return;
    card.hidden = !visible;
    if (visible) card.removeAttribute("aria-hidden");
    else card.setAttribute("aria-hidden", "true");
  }

  function setDescription(name, value) {
    var description = document.querySelector('[data-tool-description="' + name + '"]');
    if (description) description.textContent = value;
  }

  function setStatus(message, role, canRetry) {
    if (status) {
      status.textContent = message;
      status.hidden = !message;
      status.setAttribute("role", role || "status");
      status.setAttribute("aria-live", role === "alert" ? "assertive" : "polite");
    }
    if (retry) retry.hidden = !canRetry;
  }

  function hideRestrictedCards() {
    setCardVisible("estimates", false);
    setCardVisible("job-cards", false);
    setCardVisible("tasks", false);
    setCardVisible("invoices", false);
  }

  function applyAccess(access) {
    if (!access || typeof access !== "object" || Array.isArray(access)) throw new Error("Access response was not valid");
    var isAdmin = access.isAdmin === true;
    var isHrAdmin = access.isHrAdmin === true;
    var isXeroAdmin = isAdmin || access.isXeroAdmin === true;
    var isOperationsAdmin = isAdmin || access.isOperationsAdmin === true;
    var isJobCardAdmin = isAdmin || access.isJobCardAdmin === true;
    var canSeeJobCards = !isHrAdmin || isAdmin || isOperationsAdmin || isJobCardAdmin;
    var canSeeTasks = !isHrAdmin || isAdmin || isOperationsAdmin;

    setCardVisible("estimates", isAdmin);
    setCardVisible("job-cards", canSeeJobCards);
    setCardVisible("tasks", canSeeTasks);
    setCardVisible("invoices", isXeroAdmin);
    setDescription("job-cards", isJobCardAdmin
      ? "Manage job cards and review the scanned job-card archive."
      : "Create EC or MTA cards, preview their layout, and review submitted job history.");
    setDescription("tasks", isOperationsAdmin
      ? "Review and manage tasks across the operations team."
      : "Submit task requests and manage your assigned work.");
    setDescription("calendar", isAdmin || isHrAdmin || isOperationsAdmin
      ? "Review the shared schedule and request time off from a day."
      : "Review your requests and request time off from a day.");
    setStatus("", "status", false);
  }

  async function checkAccess() {
    if (retry) {
      retry.disabled = true;
      retry.hidden = true;
    }
    setStatus("Checking which tools are available…", "status", false);
    if (typeof api.access !== "function") {
      hideRestrictedCards();
      setStatus("Role-specific tools could not be checked. Retry to refresh access.", "alert", true);
      if (retry) retry.disabled = false;
      return;
    }
    try {
      var access = await api.access();
      applyAccess(access);
    } catch (_) {
      hideRestrictedCards();
      setStatus("Role-specific tools could not be checked. Retry to refresh access.", "alert", true);
    } finally {
      if (retry) retry.disabled = false;
    }
  }

  if (retry) retry.addEventListener("click", checkAccess);
  checkAccess();
}());
