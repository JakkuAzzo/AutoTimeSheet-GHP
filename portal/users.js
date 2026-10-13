(function () {
  "use strict";
  var form = document.querySelector("[data-user-form]");
  var list = document.querySelector("[data-users-list]");
  var status = document.querySelector("[data-users-status]");
  var main = document.querySelector("main");
  var labels = { admin: "Full administrator", hr: "HR", timesheets: "All timesheets (read-only)", xero: "Xero", operations: "Operations", "job-card": "Job cards" };
  function safe(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function message(text, error) { if (!status) return; status.textContent = text; status.classList.toggle("error", !!error); }
  async function refresh() {
    try {
      var result = await window.GMTPortalApi.adminUsers();
      var users = Array.isArray(result && result.users) ? result.users : [];
      var configured = Array.isArray(result && result.configured) ? result.configured : [];
      var assignedRows = users.map(function (user) {
        return '<tr><td>' + safe(user.display_name || "GMT staff") + '</td><td>' + safe(user.owner_upn) + '</td><td>' + safe(labels[user.role] || user.role) + '</td><td>' + safe(user.updated_at || user.created_at || "") + '</td><td><button type="button" class="secondary" data-revoke data-oid="' + safe(user.owner_oid) + '" data-upn="' + safe(user.owner_upn) + '" data-name="' + safe(user.display_name) + '" data-role="' + safe(user.role) + '">Remove role</button></td></tr>';
      });
      var configuredRows = configured.map(function (user) {
        return '<tr><td>' + safe(user.display_name || "GMT staff") + '</td><td>' + safe(user.owner_upn) + '</td><td>' + safe(labels[user.role] || user.role) + '</td><td>Worker configuration</td><td>Configured separately</td></tr>';
      });
      list.innerHTML = assignedRows.concat(configuredRows).join("") || '<tr><td colspan="5">No additional staff role assignments.</td></tr>';
      message("Loaded " + users.length + " managed assignment" + (users.length === 1 ? "" : "s") + " and " + configured.length + " configured role" + (configured.length === 1 ? "" : "s") + ".", false);
    } catch (error) {
      if (error && error.status === 403) {
        if (main) main.hidden = true;
        message("User management is available only to portal administrators.", true);
      } else message(error && error.message || "Could not load role assignments.", true);
    }
  }
  if (!window.GMTPortalApi) { message("Protected portal access is not connected.", true); return; }
  window.GMTPortalApi.access().then(function (access) {
    if (!access || !access.isAdmin) {
      if (main) main.hidden = true;
      message("User management is available only to portal administrators.", true);
      return;
    }
    refresh();
  }).catch(function (error) { if (main) main.hidden = true; message(error && error.message || "Administrator access could not be checked.", true); });
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var data = new FormData(form);
    var button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await window.GMTPortalApi.updateUserAccess({ name: data.get("name"), upn: data.get("upn"), oid: data.get("oid"), role: data.get("role"), action: "grant" });
      form.reset();
      message("Role granted and recorded in the audit.", false);
      await refresh();
    } catch (error) { message(error && error.message || "Could not grant the role.", true); }
    finally { button.disabled = false; }
  });
  list.addEventListener("click", async function (event) {
    var button = event.target.closest("[data-revoke]");
    if (!button) return;
    button.disabled = true;
    try {
      await window.GMTPortalApi.updateUserAccess({ name: button.dataset.name, upn: button.dataset.upn, oid: button.dataset.oid, role: button.dataset.role, action: "revoke" });
      message("Role removed and recorded in the audit.", false);
      await refresh();
    } catch (error) { message(error && error.message || "Could not remove the role.", true); button.disabled = false; }
  });
  document.querySelector("[data-users-refresh]").addEventListener("click", refresh);
}());
