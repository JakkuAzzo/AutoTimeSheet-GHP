(function () {
  "use strict";

  var form = document.querySelector("[data-offsite-clock-form]");
  var siteInput = form && form.elements.namedItem("offsite_site");
  var clockInButton = document.querySelector("[data-offsite-clock-in]");
  var clockOutButton = document.querySelector("[data-offsite-clock-out]");
  var lunchStartButton = document.querySelector("[data-offsite-lunch-start]");
  var lunchEndButton = document.querySelector("[data-offsite-lunch-end]");
  var status = document.querySelector("[data-offsite-status]");
  var entriesList = document.querySelector("[data-offsite-entries]");
  var managerQueue = document.querySelector("[data-offsite-manager-queue]");
  var managerStatus = document.querySelector("[data-offsite-manager-status]");
  var pendingList = document.querySelector("[data-offsite-pending-list]");
  var bookingForm = document.querySelector("[data-offsite-booking-form]");
  var bookingStatus = document.querySelector("[data-offsite-booking-status]");
  var bookingsList = document.querySelector("[data-offsite-bookings]");
  var managerBookingStatus = document.querySelector("[data-offsite-booking-manager-status]");
  var pendingBookingsList = document.querySelector("[data-offsite-booking-pending-list]");
  var activeEntry = null;
  var managerEnabled = false;
  var storagePrefix = "gmt.portal.offsiteClock.request.v2.";

  if (!form || !siteInput || !clockInButton || !clockOutButton || !status || !entriesList) return;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character];
    });
  }

  function accountKey() {
    try {
      var profile = JSON.parse(localStorage.getItem("gmt.portal.profile.v1") || "{}");
      return String(profile.subject || profile.username || "signed-in-account").trim().toLowerCase() || "signed-in-account";
    } catch (_) { return "signed-in-account"; }
  }

  function requestStorageKey(key) {
    return storagePrefix + encodeURIComponent(accountKey()) + "." + key;
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

  function prettyTime(value) {
    if (!value) return "Not recorded";
    var date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short"
    }).format(date);
  }

  function prettyDate(value) {
    if (!value) return "Date unavailable";
    var date = new Date(String(value).slice(0, 10) + "T12:00:00Z");
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", dateStyle: "medium"
    }).format(date);
  }

  function statusLabel(value) {
    return ({
      clocked_in: "Shift in progress",
      awaiting_approval: "Awaiting manager sign-off",
      approved: "Approved",
      rejected: "Rejected"
    })[value] || "Status unavailable";
  }

  function isCoordinatePair(value) {
    return /^\s*-?\d{1,3}(?:\.\d+)?,\s*-?\d{1,3}(?:\.\d+)?\s*(?:\(.*\))?$/i.test(String(value || ""));
  }

  function displaySite(value) {
    var site = String(value || "").trim();
    return isCoordinatePair(site) ? "Location name not recorded" : (site || "Off-site location");
  }

  function renderOwnEntries(entries) {
    var values = Array.isArray(entries) ? entries : [];
    activeEntry = values.find(function (entry) { return entry && entry.status === "clocked_in"; }) || null;
    clockInButton.disabled = Boolean(activeEntry);
    clockOutButton.hidden = !activeEntry;
    clockOutButton.disabled = !activeEntry;
    if (lunchStartButton) {
      lunchStartButton.hidden = !activeEntry;
      lunchStartButton.disabled = !activeEntry || Boolean(activeEntry.lunchStartAt || activeEntry.lunchEndAt);
    }
    if (lunchEndButton) {
      lunchEndButton.hidden = !activeEntry;
      lunchEndButton.disabled = !activeEntry || !activeEntry.lunchStartAt || Boolean(activeEntry.lunchEndAt);
    }
    siteInput.disabled = Boolean(activeEntry);
    if (activeEntry) {
      status.textContent = "Shift started at " + prettyTime(activeEntry.clockInAt) + ". Record lunch and clock out when the off-site work is complete.";
      if (activeEntry.site && !isCoordinatePair(activeEntry.site)) siteInput.value = activeEntry.site;
    } else if (values.some(function (entry) { return entry && entry.status === "awaiting_approval"; })) {
      status.textContent = "Your completed shift is awaiting manager sign-off. You can start another shift.";
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
        '<h4>' + escapeHtml(displaySite(entry.site)) + '</h4>' +
        '<p><strong>' + escapeHtml(statusLabel(entry.status)) + '</strong></p>' +
        '<p class="small-text">Date: ' + escapeHtml(prettyDate(entry.workDate)) + '</p>' +
        '<p class="small-text">Clock in: ' + escapeHtml(prettyTime(entry.clockInAt)) + '</p>' +
        '<p class="small-text">Lunch: ' + escapeHtml(prettyTime(entry.lunchStartAt)) + ' – ' + escapeHtml(prettyTime(entry.lunchEndAt)) + '</p>' +
        '<p class="small-text">Clock out: ' + escapeHtml(prettyTime(entry.clockOutAt)) + '</p>' +
        (entry.bookingId ? '<p class="small-text">Linked approved booking</p>' : '') +
        (entry.decidedAt ? '<p class="small-text">' + escapeHtml(statusLabel(entry.status)) + ' by ' + escapeHtml(entry.decidedByUpn || "Duty Manager") + ' · ' + escapeHtml(prettyTime(entry.decidedAt)) + '</p>' : '') +
        (entry.decisionNote ? '<p class="small-text">Manager note: ' + escapeHtml(entry.decisionNote) + '</p>' : '') +
        '</article>';
    }).join("");
  }

  function renderShiftQueue(entries) {
    var values = Array.isArray(entries) ? entries : [];
    if (!pendingList) return;
    if (!values.length) {
      pendingList.innerHTML = '<p class="small-text">No entries are awaiting sign-off.</p>';
      return;
    }
    pendingList.innerHTML = values.map(function (entry) {
      var controls = entry.canDecide === false
        ? '<p class="small-text">You submitted this entry. You cannot sign off your own shift.</p>'
        : '<label class="offsite-decision-note">Decision note <textarea rows="2" maxlength="1000" data-offsite-note placeholder="Optional for approval; required to reject"></textarea></label>' +
          '<div class="offsite-entry-actions"><button type="button" data-offsite-approve data-entry-id="' + escapeHtml(entry.entryId) + '">Approve shift</button>' +
          '<button type="button" class="secondary" data-offsite-reject data-entry-id="' + escapeHtml(entry.entryId) + '">Reject</button></div>';
      return '<article class="offsite-entry" data-offsite-pending-entry="' + escapeHtml(entry.entryId) + '">' +
        '<h4>' + escapeHtml(entry.ownerName || entry.ownerUpn || "GMT staff") + '</h4>' +
        '<p><strong>' + escapeHtml(displaySite(entry.site)) + '</strong> · ' + escapeHtml(prettyDate(entry.workDate)) + '</p>' +
        '<p class="small-text">Clock in: ' + escapeHtml(prettyTime(entry.clockInAt)) + '</p>' +
        '<p class="small-text">Lunch: ' + escapeHtml(prettyTime(entry.lunchStartAt)) + ' – ' + escapeHtml(prettyTime(entry.lunchEndAt)) + '</p>' +
        '<p class="small-text">Clock out: ' + escapeHtml(prettyTime(entry.clockOutAt)) + '</p>' + controls + '</article>';
    }).join("");
  }

  function renderBookingCard(booking) {
    var id = escapeHtml(booking.bookingId);
    var date = escapeHtml(booking.workDate);
    var start = escapeHtml(booking.start);
    var end = escapeHtml(booking.end);
    var site = escapeHtml(displaySite(booking.site));
    var editableSite = escapeHtml(isCoordinatePair(booking.site) ? "" : booking.site);
    var note = escapeHtml(booking.note || "");
    return '<article class="offsite-entry" data-booking-card="' + id + '">' +
      '<h4>' + site + '</h4><p><strong>' + escapeHtml(statusLabel(booking.status)) + '</strong></p>' +
      '<p class="small-text">' + escapeHtml(prettyDate(booking.workDate)) + ' · ' + start + '–' + end + '</p>' +
      (note ? '<p class="small-text">' + note + '</p>' : '') +
      (booking.decidedAt ? '<p class="small-text">' + escapeHtml(booking.decidedByUpn || "Duty Manager") + ' · ' + escapeHtml(prettyTime(booking.decidedAt)) + '</p>' : '') +
      (booking.decisionNote ? '<p class="small-text">Manager note: ' + escapeHtml(booking.decisionNote) + '</p>' : '') +
      '<button type="button" class="secondary" data-booking-edit>Amend booking</button>' +
      '<form class="offsite-inline-edit" data-booking-edit-form hidden>' +
        '<label>Date<input name="workDate" type="date" required value="' + date + '"></label>' +
        '<div class="offsite-booking-times"><label>Start<input name="start" type="time" required value="' + start + '"></label><label>End<input name="end" type="time" required value="' + end + '"></label></div>' +
        '<label>Road, business or site name<input name="site" type="text" required maxlength="240" value="' + editableSite + '"></label>' +
        '<label>Note<input name="note" type="text" maxlength="1000" value="' + note + '"></label>' +
        '<button type="submit" data-booking-id="' + id + '">Save amended booking for approval</button>' +
      '</form>' + renderBookingHistory(booking) + '</article>';
  }

  function bookingSnapshotLabel(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return "";
    return [
      snapshot.workDate ? prettyDate(snapshot.workDate) : "",
      snapshot.start && snapshot.end ? snapshot.start + "–" + snapshot.end : "",
      snapshot.site ? displaySite(snapshot.site) : ""
    ].filter(Boolean).join(" · ");
  }

  function bookingHistoryLabel(event) {
    return ({ book: "Booking requested", amend: "Booking amended", approve: "Booking approved", reject: "Booking rejected" })[event.eventType] || "Booking updated";
  }

  function renderBookingHistory(booking) {
    var history = Array.isArray(booking.history) ? booking.history : [];
    if (!history.length) return "";
    return '<details class="offsite-booking-history"><summary>Booking history · ' + history.length + ' updates</summary><ol>' + history.map(function (event) {
      var details = "";
      if (event.previous && event.next) {
        details += '<p>Previous plan: ' + escapeHtml(bookingSnapshotLabel(event.previous)) + '</p>';
        details += '<p>Amended plan: ' + escapeHtml(bookingSnapshotLabel(event.next)) + '</p>';
      } else {
        var snapshot = event.next || event.planned;
        if (snapshot) details += '<p>Planned: ' + escapeHtml(bookingSnapshotLabel(snapshot)) + '</p>';
      }
      if (event.actorUpn) details += '<p>By ' + escapeHtml(event.actorUpn) + '</p>';
      if (event.note) details += '<p>Manager note: ' + escapeHtml(event.note) + '</p>';
      return '<li><strong>' + escapeHtml(bookingHistoryLabel(event)) + ' · version ' + escapeHtml(event.version) + '</strong><p>' + escapeHtml(prettyTime(event.occurredAt)) + '</p>' + details + '</li>';
    }).join("") + '</ol></details>';
  }

  function renderOwnBookings(bookings) {
    var values = Array.isArray(bookings) ? bookings : [];
    if (!bookingsList) return;
    bookingsList.innerHTML = values.length ? values.map(renderBookingCard).join("") : '<p class="small-text">No planned off-site work yet.</p>';
  }

  function renderBookingQueue(bookings) {
    var values = Array.isArray(bookings) ? bookings : [];
    if (!pendingBookingsList) return;
    if (!values.length) {
      pendingBookingsList.innerHTML = '<p class="small-text">No bookings are awaiting approval.</p>';
      return;
    }
    pendingBookingsList.innerHTML = values.map(function (booking) {
      var controls = booking.canDecide === false
        ? '<p class="small-text">You submitted this booking. You cannot approve it.</p>'
        : '<label class="offsite-decision-note">Decision note <textarea rows="2" maxlength="1000" data-offsite-booking-note placeholder="Optional for approval; required to reject"></textarea></label>' +
          '<div class="offsite-entry-actions"><button type="button" data-booking-approve data-booking-id="' + escapeHtml(booking.bookingId) + '" data-booking-version="' + escapeHtml(booking.version) + '">Approve booking</button>' +
          '<button type="button" class="secondary" data-booking-reject data-booking-id="' + escapeHtml(booking.bookingId) + '" data-booking-version="' + escapeHtml(booking.version) + '">Reject</button></div>';
      return '<article class="offsite-entry" data-offsite-pending-booking="' + escapeHtml(booking.bookingId) + '">' +
        '<h4>' + escapeHtml(booking.ownerName || booking.ownerUpn || "GMT staff") + '</h4>' +
        '<p><strong>' + escapeHtml(displaySite(booking.site)) + '</strong> · ' + escapeHtml(prettyDate(booking.workDate)) + ' · ' + escapeHtml(booking.start) + '–' + escapeHtml(booking.end) + '</p>' +
        (booking.note ? '<p class="small-text">' + escapeHtml(booking.note) + '</p>' : '') +
        '<p class="small-text">Version ' + escapeHtml(booking.version) + '</p>' + controls + '</article>';
    }).join("");
  }

  async function refreshOwn() {
    var result = await window.GMTPortalApi.offsiteClockMine();
    renderOwnEntries(result && result.entries);
  }

  async function refreshBookings() {
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.offsiteBookingsMine !== "function") return;
    var result = await window.GMTPortalApi.offsiteBookingsMine();
    renderOwnBookings(result && result.bookings);
  }

  async function refreshPending() {
    if (!managerEnabled || !window.GMTPortalApi || typeof window.GMTPortalApi.offsiteClockPending !== "function") return;
    var result = await window.GMTPortalApi.offsiteClockPending();
    renderShiftQueue(result && result.entries);
    if (managerStatus) managerStatus.textContent = "Loaded " + ((result && result.entries || []).length) + " completed shifts awaiting sign-off.";
  }

  async function refreshPendingBookings() {
    if (!managerEnabled || !window.GMTPortalApi || typeof window.GMTPortalApi.offsiteBookingsPending !== "function") return;
    var result = await window.GMTPortalApi.offsiteBookingsPending();
    renderBookingQueue(result && result.bookings);
    if (managerBookingStatus) managerBookingStatus.textContent = "Loaded " + ((result && result.bookings || []).length) + " booking requests awaiting approval.";
  }

  async function refreshAll() {
    await Promise.all([refreshOwn(), refreshBookings(), refreshPending(), refreshPendingBookings()]);
  }

  async function initialize() {
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== "function" || !window.GMTPortalApi.enabled()) {
      status.textContent = "The protected off-site clock service is not connected.";
      entriesList.innerHTML = "";
      return;
    }
    if (bookingForm) {
      var today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
      bookingForm.elements.work_date.min = today;
      bookingForm.elements.work_date.value = today;
    }
    try {
      var requests = [refreshOwn(), refreshBookings()];
      if (typeof window.GMTPortalApi.access === "function") {
        requests.push(window.GMTPortalApi.access().then(function (access) {
          managerEnabled = Boolean(access && access.canReviewOffsite === true);
          if (managerEnabled && managerQueue) {
            managerQueue.hidden = false;
            return Promise.all([refreshPending(), refreshPendingBookings()]);
          }
        }));
      }
      await Promise.all(requests);
    } catch (error) {
      status.textContent = error && error.message || "Your off-site entries could not be loaded.";
      if (managerQueue && managerEnabled && managerStatus) managerStatus.textContent = error && error.message || "The sign-off queue could not be loaded.";
    }
  }

  async function sendShiftEvent(button, action) {
    if (button.disabled) return;
    if (action === "clock_in" && !activeEntry) {
      var site = String(siteInput.value || "").trim();
      if (!site) { siteInput.focus(); status.textContent = "Enter a road, business or site name before clocking in."; return; }
      if (isCoordinatePair(site)) { siteInput.focus(); status.textContent = "Enter the road, business or site name; coordinates are not accepted."; return; }
    }
    var entry = activeEntry;
    var key = action === "clock_in" ? "clock-in" : action + "-" + entry.entryId;
    button.disabled = true;
    status.textContent = action === "clock_in" ? "Recording your off-site clock-in…" : "Recording " + action.replace("_", " ") + "…";
    var api = window.GMTPortalApi;
    var body = { requestId: requestId(key) };
    if (action === "clock_in") {
      body.site = String(siteInput.value || "").trim();
    } else {
      body.entryId = entry.entryId;
    }
    var method = {
      clock_in: "offsiteClockIn",
      lunch_start: "offsiteClockLunchStart",
      lunch_end: "offsiteClockLunchEnd",
      clock_out: "offsiteClockOut"
    }[action];
    try {
      await api[method](body);
      clearRequestId(key);
      await refreshOwn();
      if (action === "clock_out") status.textContent = "Shift complete and awaiting manager sign-off. It will appear in timesheet history after approval.";
    } catch (error) {
      button.disabled = false;
      status.textContent = error && error.message || "The off-site action could not be recorded. You can retry safely.";
    }
  }

  clockInButton.addEventListener("click", function () { sendShiftEvent(clockInButton, "clock_in"); });
  if (clockOutButton) clockOutButton.addEventListener("click", function () { sendShiftEvent(clockOutButton, "clock_out"); });
  if (lunchStartButton) lunchStartButton.addEventListener("click", function () { sendShiftEvent(lunchStartButton, "lunch_start"); });
  if (lunchEndButton) lunchEndButton.addEventListener("click", function () { sendShiftEvent(lunchEndButton, "lunch_end"); });

  if (bookingForm) bookingForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    var values = bookingForm.elements;
    var site = String(values.site.value || "").trim();
    if (isCoordinatePair(site)) { bookingStatus.textContent = "Enter the road, business or site name; coordinates are not accepted."; values.site.focus(); return; }
    var submit = bookingForm.querySelector("[data-offsite-booking-submit]");
    var key = "booking-create";
    if (submit) submit.disabled = true;
    bookingStatus.textContent = "Sending booking request for manager approval…";
    try {
      await window.GMTPortalApi.createOffsiteBooking({
        requestId: requestId(key), workDate: values.work_date.value, start: values.start.value,
        end: values.end.value, site: site, note: String(values.note.value || "").trim()
      });
      clearRequestId(key);
      bookingForm.reset();
      bookingForm.elements.work_date.value = bookingForm.elements.work_date.min;
      bookingStatus.textContent = "Booking request sent. It will not be added to a timesheet unless the actual shift is separately recorded and approved.";
      await refreshBookings();
    } catch (error) {
      bookingStatus.textContent = error && error.message || "The booking request could not be saved. You can retry safely.";
    } finally { if (submit) submit.disabled = false; }
  });

  if (bookingsList) bookingsList.addEventListener("click", function (event) {
    var button = event.target.closest("[data-booking-edit]");
    if (!button) return;
    var editForm = button.closest("[data-booking-card]")?.querySelector("[data-booking-edit-form]");
    if (!editForm) return;
    editForm.hidden = !editForm.hidden;
    button.textContent = editForm.hidden ? "Amend booking" : "Close amendment";
  });

  if (bookingsList) bookingsList.addEventListener("submit", async function (event) {
    var editForm = event.target.closest("[data-booking-edit-form]");
    if (!editForm) return;
    event.preventDefault();
    var submit = editForm.querySelector("[data-booking-id]");
    var bookingId = submit && submit.dataset.bookingId;
    var site = String(editForm.elements.site.value || "").trim();
    if (isCoordinatePair(site)) { editForm.elements.site.focus(); bookingStatus.textContent = "Enter a named road, business or site."; return; }
    var key = "booking-amend-" + bookingId;
    if (submit) submit.disabled = true;
    bookingStatus.textContent = "Saving amended booking for manager approval…";
    try {
      await window.GMTPortalApi.amendOffsiteBooking(bookingId, {
        requestId: requestId(key), workDate: editForm.elements.workDate.value, start: editForm.elements.start.value,
        end: editForm.elements.end.value, site: site, note: String(editForm.elements.note.value || "").trim()
      });
      clearRequestId(key);
      bookingStatus.textContent = "Amendment saved and sent for fresh manager approval.";
      await refreshBookings();
      if (managerEnabled) await refreshPendingBookings();
    } catch (error) {
      bookingStatus.textContent = error && error.message || "The amendment could not be saved. You can retry safely.";
      if (submit) submit.disabled = false;
    }
  });

  async function decideShift(button, decision) {
    var entryId = button.dataset.entryId;
    var card = button.closest("[data-offsite-pending-entry]");
    var note = String(card && card.querySelector("[data-offsite-note]")?.value || "").trim();
    if (decision === "reject" && !note) {
      managerStatus.textContent = "Add a reason before rejecting an entry.";
      if (card) card.querySelector("[data-offsite-note]")?.focus();
      return;
    }
    var key = "shift-decision-" + entryId;
    Array.from(card.querySelectorAll("button")).forEach(function (item) { item.disabled = true; });
    managerStatus.textContent = decision === "approve" ? "Approving the completed shift…" : "Rejecting the completed shift…";
    try {
      await window.GMTPortalApi.offsiteClockDecision(entryId, { requestId: requestId(key), decision: decision, note: note });
      clearRequestId(key);
      await refreshPending();
      managerStatus.textContent = decision === "approve" ? "Shift approved and added to the employee's protected timesheet history." : "Shift rejected with a recorded reason.";
    } catch (error) {
      Array.from(card.querySelectorAll("button")).forEach(function (item) { item.disabled = false; });
      managerStatus.textContent = error && error.message || "The sign-off decision could not be recorded. You can retry safely.";
    }
  }

  if (pendingList) pendingList.addEventListener("click", function (event) {
    var button = event.target.closest("[data-offsite-approve], [data-offsite-reject]");
    if (button) decideShift(button, button.hasAttribute("data-offsite-approve") ? "approve" : "reject");
  });

  if (pendingBookingsList) pendingBookingsList.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-booking-approve], [data-booking-reject]");
    if (!button) return;
    var bookingId = button.dataset.bookingId;
    var version = Number(button.dataset.bookingVersion);
    var card = button.closest("[data-offsite-pending-booking]");
    var decision = button.hasAttribute("data-booking-approve") ? "approve" : "reject";
    var note = String(card && card.querySelector("[data-offsite-booking-note]")?.value || "").trim();
    if (decision === "reject" && !note) {
      managerBookingStatus.textContent = "Add a reason before rejecting a booking.";
      card && card.querySelector("[data-offsite-booking-note]")?.focus();
      return;
    }
    var key = "booking-decision-" + bookingId + "-v" + version;
    Array.from(card.querySelectorAll("button")).forEach(function (item) { item.disabled = true; });
    managerBookingStatus.textContent = decision === "approve" ? "Approving the planned booking…" : "Rejecting the planned booking…";
    try {
      await window.GMTPortalApi.offsiteBookingDecision(bookingId, { requestId: requestId(key), version: version, decision: decision, note: note });
      clearRequestId(key);
      await refreshPendingBookings();
      managerBookingStatus.textContent = decision === "approve" ? "Booking approved. This does not create a timesheet entry." : "Booking rejected with a recorded reason.";
      await refreshBookings();
    } catch (error) {
      Array.from(card.querySelectorAll("button")).forEach(function (item) { item.disabled = false; });
      managerBookingStatus.textContent = error && error.message || "The booking decision could not be saved. You can retry safely.";
    }
  });

  initialize();
}());
