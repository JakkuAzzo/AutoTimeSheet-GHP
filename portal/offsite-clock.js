(function () {
  "use strict";

  var form = document.querySelector("[data-offsite-clock-form]");
  var siteInput = form && form.elements.namedItem("offsite_site");
  var clockInButton = document.querySelector("[data-offsite-clock-in]");
  var clockOutButton = document.querySelector("[data-offsite-clock-out]");
  var status = document.querySelector("[data-offsite-status]");
  var entriesList = document.querySelector("[data-offsite-entries]");
  var managerQueue = document.querySelector("[data-offsite-manager-queue]");
  var managerStatus = document.querySelector("[data-offsite-manager-status]");
  var pendingList = document.querySelector("[data-offsite-pending-list]");
  var activeEntry = null;
  var managerEnabled = false;
  var storagePrefix = "gmt.portal.offsiteClock.request.v1.";

  if (!form || !siteInput || !clockInButton || !clockOutButton || !status || !entriesList) return;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character];
    });
  }

  function requestId(key) {
    var storageKey = requestStorageKey(key);
    try {
      var existing = localStorage.getItem(storageKey);
      if (existing) return existing;
    } catch (_) {}
    var value = "offsite-" + (window.crypto && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2));
    try { localStorage.setItem(storageKey, value); } catch (_) {}
    return value;
  }

  function clearRequestId(key) {
    try { localStorage.removeItem(requestStorageKey(key)); } catch (_) {}
  }

  function requestStorageKey(key) {
    var account = "signed-in-account";
    try {
      var profile = JSON.parse(localStorage.getItem("gmt.portal.profile.v1") || "{}");
      account = String(profile.subject || profile.username || account).trim().toLowerCase() || account;
    } catch (_) {}
    return storagePrefix + encodeURIComponent(account) + "." + key;
  }

  function prettyTime(value) {
    if (!value) return "Not recorded";
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short"
    }).format(date);
  }

  function statusLabel(value) {
    return ({
      clocked_in: "Clocked in",
      awaiting_approval: "Awaiting manager sign-off",
      approved: "Approved",
      rejected: "Rejected"
    })[value] || "Status unavailable";
  }

  function renderOwnEntries(entries) {
    var values = Array.isArray(entries) ? entries : [];
    activeEntry = values.find(function (entry) { return entry && entry.status === "clocked_in"; }) || null;
    clockInButton.disabled = Boolean(activeEntry);
    clockOutButton.hidden = !activeEntry;
    siteInput.disabled = Boolean(activeEntry);
    if (activeEntry) {
      status.textContent = "Clocked in at " + prettyTime(activeEntry.clockInAt) + ". Clock out when your off-site work is complete.";
      if (activeEntry.site) siteInput.value = activeEntry.site;
    } else if (values.some(function (entry) { return entry && entry.status === "awaiting_approval"; })) {
      status.textContent = "Awaiting manager sign-off. You can start another off-site shift.";
      siteInput.disabled = false;
    } else {
      status.textContent = "No active off-site shift.";
    }

    if (!values.length) {
      entriesList.innerHTML = '<p class="small-text">No off-site entries yet.</p>';
      return;
    }
    entriesList.innerHTML = values.map(function (entry) {
      return '<article class="offsite-entry">' +
        '<h4>' + escapeHtml(entry.site || "Off-site shift") + '</h4>' +
        '<p><strong>' + escapeHtml(statusLabel(entry.status)) + '</strong></p>' +
        '<p class="small-text">Clock in: ' + escapeHtml(prettyTime(entry.clockInAt)) + '</p>' +
        '<p class="small-text">Clock out: ' + escapeHtml(prettyTime(entry.clockOutAt)) + '</p>' +
        (entry.decisionNote ? '<p class="small-text">Manager note: ' + escapeHtml(entry.decisionNote) + '</p>' : '') +
        '</article>';
    }).join("");
  }

  function renderPending(entries) {
    var values = Array.isArray(entries) ? entries : [];
    if (!pendingList) return;
    if (!values.length) {
      pendingList.innerHTML = '<p class="small-text">No entries are awaiting sign-off.</p>';
      return;
    }
    pendingList.innerHTML = values.map(function (entry) {
      if (entry.canDecide === false) {
        return '<article class="offsite-entry" data-offsite-pending-entry="' + escapeHtml(entry.entryId) + '">' +
          '<h4>' + escapeHtml(entry.ownerName || entry.ownerUpn || "GMT staff") + '</h4>' +
          '<p><strong>' + escapeHtml(entry.site || "Off-site shift") + '</strong></p>' +
          '<p class="small-text">Clock in: ' + escapeHtml(prettyTime(entry.clockInAt)) + '</p>' +
          '<p class="small-text">Clock out: ' + escapeHtml(prettyTime(entry.clockOutAt)) + '</p>' +
          '<p class="small-text">You submitted this entry. You cannot sign off your own shift.</p></article>';
      }
      return '<article class="offsite-entry" data-offsite-pending-entry="' + escapeHtml(entry.entryId) + '">' +
        '<h4>' + escapeHtml(entry.ownerName || entry.ownerUpn || "GMT staff") + '</h4>' +
        '<p><strong>' + escapeHtml(entry.site || "Off-site shift") + '</strong></p>' +
        '<p class="small-text">Clock in: ' + escapeHtml(prettyTime(entry.clockInAt)) + '</p>' +
        '<p class="small-text">Clock out: ' + escapeHtml(prettyTime(entry.clockOutAt)) + '</p>' +
        '<label class="offsite-decision-note">Decision note <textarea rows="2" maxlength="1000" data-offsite-note placeholder="Optional for approval; required to reject"></textarea></label>' +
        '<div class="offsite-entry-actions"><button type="button" data-offsite-approve data-entry-id="' + escapeHtml(entry.entryId) + '">Approve</button>' +
        '<button type="button" class="secondary" data-offsite-reject data-entry-id="' + escapeHtml(entry.entryId) + '">Reject</button></div>' +
        '</article>';
    }).join("");
  }

  async function refreshOwn() {
    var result = await window.GMTPortalApi.offsiteClockMine();
    renderOwnEntries(result && result.entries);
  }

  async function refreshPending() {
    if (!managerEnabled || !window.GMTPortalApi || typeof window.GMTPortalApi.offsiteClockPending !== "function") return;
    var result = await window.GMTPortalApi.offsiteClockPending();
    renderPending(result && result.entries);
    if (managerStatus) managerStatus.textContent = "Loaded " + ((result && result.entries || []).length) + " entries awaiting sign-off.";
  }

  async function initialize() {
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== "function" || !window.GMTPortalApi.enabled()) {
      status.textContent = "The protected off-site clock service is not connected.";
      entriesList.innerHTML = "";
      return;
    }
    try {
      var requests = [refreshOwn()];
      if (typeof window.GMTPortalApi.access === "function") {
        requests.push(window.GMTPortalApi.access().then(function (access) {
          managerEnabled = Boolean(access && access.canReviewOffsite === true);
          if (managerEnabled && managerQueue) {
            managerQueue.hidden = false;
            return refreshPending();
          }
        }));
      }
      await Promise.all(requests);
    } catch (error) {
      status.textContent = error && error.message || "Your off-site entries could not be loaded.";
      if (managerQueue && managerEnabled && managerStatus) managerStatus.textContent = error && error.message || "The sign-off queue could not be loaded.";
    }
  }

  clockInButton.addEventListener("click", async function () {
    var site = String(siteInput.value || "").trim();
    if (!site) { siteInput.focus(); status.textContent = "Enter an off-site location before clocking in."; return; }
    clockInButton.disabled = true;
    status.textContent = "Recording your off-site clock-in…";
    try {
      await window.GMTPortalApi.offsiteClockIn({ requestId: requestId("clock-in"), site: site });
      clearRequestId("clock-in");
      await refreshOwn();
    } catch (error) {
      clockInButton.disabled = false;
      status.textContent = error && error.message || "Clock-in could not be recorded. You can retry safely.";
    }
  });

  clockOutButton.addEventListener("click", async function () {
    if (!activeEntry) return;
    var entry = activeEntry;
    var key = "clock-out-" + entry.entryId;
    clockOutButton.disabled = true;
    status.textContent = "Recording your off-site clock-out…";
    try {
      await window.GMTPortalApi.offsiteClockOut({ requestId: requestId(key), entryId: entry.entryId });
      clearRequestId(key);
      await refreshOwn();
    } catch (error) {
      clockOutButton.disabled = false;
      status.textContent = error && error.message || "Clock-out could not be recorded. You can retry safely.";
    }
  });

  if (pendingList) pendingList.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-offsite-approve], [data-offsite-reject]");
    if (!button) return;
    var entryId = button.dataset.entryId;
    var card = button.closest("[data-offsite-pending-entry]");
    var decision = button.hasAttribute("data-offsite-approve") ? "approve" : "reject";
    var note = String(card && card.querySelector("[data-offsite-note]")?.value || "").trim();
    if (decision === "reject" && !note) {
      managerStatus.textContent = "Add a reason before rejecting an entry.";
      if (card) card.querySelector("[data-offsite-note]")?.focus();
      return;
    }
    var key = "decision-" + entryId;
    Array.from(card.querySelectorAll("button")).forEach(function (item) { item.disabled = true; });
    managerStatus.textContent = decision === "approve" ? "Approving off-site entry…" : "Rejecting off-site entry…";
    try {
      await window.GMTPortalApi.offsiteClockDecision(entryId, { requestId: requestId(key), decision: decision, note: note });
      clearRequestId(key);
      await refreshPending();
      managerStatus.textContent = decision === "approve" ? "Approved." : "Rejected with a recorded reason.";
    } catch (error) {
      Array.from(card.querySelectorAll("button")).forEach(function (item) { item.disabled = false; });
      managerStatus.textContent = error && error.message || "The sign-off decision could not be recorded. You can retry safely.";
    }
  });

  initialize();
}());
