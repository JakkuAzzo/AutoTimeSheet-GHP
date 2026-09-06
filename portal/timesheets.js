(function () {
  "use strict";
  var config = window.GMT_APP_CONFIG || {};
  var status = document.getElementById("timesheet-history-status");
  var historyLink = document.getElementById("timesheet-history-link");
  var list = document.getElementById("timesheet-history-list");

  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char];
    });
  }

  function render(records) {
    if (!records.length) {
      list.innerHTML = '<p class="small-text">No submitted timesheets were found for this account.</p>';
      return;
    }
    list.innerHTML = records.map(function (record) {
      var statusClass = String(record.status || "Submitted").toLowerCase().replace(/\s+/g, "-");
      return '<article class="portal-item"><strong>' + safe(record.employee_name || record.employeeName || "Timesheet") + '</strong>' +
        '<span class="portal-status ' + safe(statusClass) + '">' + safe(record.status || "Submitted") + '</span>' +
        '<p class="portal-item-meta">Week ' + safe(record.start_date || record.weekStart || "not dated") + ' to ' + safe(record.end_date || record.weekEnd || "not dated") + '</p>' +
        '<p class="portal-item-meta">Last updated ' + safe(record.updated_at || record.submitted_at || record.submittedAt || "not recorded") + '</p>' +
        (record.issue ? '<p class="portal-history-warning">Review needed: ' + safe(record.issue) + '</p>' : '') +
        '</article>';
    }).join("");
  }

  async function load() {
    if (!config.timesheetHistoryEndpoint) {
      status.textContent = "Your secure history endpoint is not connected yet. The underlying SharePoint register is intentionally not exposed here.";
      if (config.timesheetHistoryAppUrl) {
        historyLink.hidden = false;
        historyLink.innerHTML = '<a class="portal-text-link" href="' + safe(config.timesheetHistoryAppUrl) + '" target="_blank" rel="noopener">Open protected timesheet records <span aria-hidden="true">→</span></a>';
      }
      list.innerHTML = '<p class="small-text">Ask an administrator to complete the protected Microsoft 365 history connection.</p>';
      return;
    }
    try {
      var response = await fetch(config.timesheetHistoryEndpoint, { credentials: "include", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("History request failed");
      var body = await response.json();
      render(Array.isArray(body.records) ? body.records : []);
      status.textContent = "Only records authorised for your signed-in GMT identity are shown.";
    } catch (error) {
      status.textContent = "Your timesheet history could not be loaded. Please try again or contact Accounts.";
      list.innerHTML = "";
    }
  }

  document.addEventListener("DOMContentLoaded", load);
}());
