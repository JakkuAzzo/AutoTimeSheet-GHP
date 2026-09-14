(function () {
  "use strict";

  var storageKey = "gmt.portal.profile.v1";
  var form = document.getElementById("portal-profile-form");
  var nameInput = document.getElementById("portal-profile-name");
  var loginEmailInput = document.getElementById("portal-profile-login-email");
  var emailInput = document.getElementById("portal-profile-email");
  var status = document.getElementById("portal-profile-status");

  if (!form || !nameInput || !loginEmailInput || !emailInput) return;

  function readLocalProfile() {
    try {
      var profile = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return profile && typeof profile === "object" && !Array.isArray(profile) ? profile : {};
    } catch (_) {
      return {};
    }
  }

  function writeLocalProfile(profile) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(profile || {}));
      return true;
    } catch (_) {
      return false;
    }
  }

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function render(profile) {
    var value = profile || {};
    nameInput.value = value.name || "";
    loginEmailInput.value = value.username || "";
    emailInput.value = value.notificationEmail || "";
  }

  function applyIdentity(identity) {
    var profile = readLocalProfile();
    var previousUsername = profile.username || "";
    var previousSubject = profile.subject || "";
    var legacyContactEmail = profile.contactEmail || "";
    var identityName = String(identity && identity.name || "").trim();
    var sameAccount = previousSubject && previousSubject === String(identity && identity.subject || "");
    // The Worker-backed setting remains authoritative for the same account;
    // only use Microsoft's name when this is a new account or no saved name
    // exists yet.
    if (!sameAccount || !profile.name || looksLikeEmail(profile.name)) {
      profile.name = !looksLikeEmail(identityName) ? identityName : "";
    }
    profile.username = String(identity && identity.username || "").trim();
    profile.subject = String(identity && identity.subject || "").trim();
    if (!profile.notificationEmail && legacyContactEmail && legacyContactEmail !== previousUsername) {
      profile.notificationEmail = legacyContactEmail;
    }
    delete profile.contactEmail;
    writeLocalProfile(profile);
    render(profile);
  }

  function applyRemoteProfile(remote) {
    var profile = readLocalProfile();
    var value = remote && typeof remote === "object" ? remote : {};
    if (Object.prototype.hasOwnProperty.call(value, "name")) {
      var name = String(value.name || "").trim();
      profile.name = looksLikeEmail(name) ? "" : name;
    }
    if (Object.prototype.hasOwnProperty.call(value, "notificationEmail")) {
      profile.notificationEmail = String(value.notificationEmail || "").trim();
    }
    if (!profile.username && value.username) profile.username = String(value.username).trim();
    writeLocalProfile(profile);
    render(profile);
  }

  render(readLocalProfile());

  document.addEventListener("gmtportalidentity", function (event) {
    applyIdentity(event.detail || {});
  });
  document.addEventListener("gmtportalprofile", function (event) {
    applyRemoteProfile(event.detail || {});
  });
  if (window.GMT_PORTAL_PROFILE_READY && typeof window.GMT_PORTAL_PROFILE_READY.then === "function") {
    window.GMT_PORTAL_PROFILE_READY.then(applyRemoteProfile).catch(function () {});
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var name = nameInput.value.trim();
    var notificationEmail = emailInput.value.trim();
    if (notificationEmail && !emailInput.checkValidity()) {
      status.textContent = "Enter a valid personal email address.";
      return;
    }
    if (!window.GMTPortalApi || typeof window.GMTPortalApi.enabled !== "function" || !window.GMTPortalApi.enabled() || typeof window.GMTPortalApi.saveProfile !== "function") {
      status.textContent = "GMT app profile service is not connected.";
      return;
    }
    status.textContent = "Saving account settings…";
    try {
      var result = await window.GMTPortalApi.saveProfile({ name: name, notificationEmail: notificationEmail });
      var saved = result && result.profile && typeof result.profile === "object" ? result.profile : { name: name, notificationEmail: notificationEmail };
      applyRemoteProfile(saved);
      status.textContent = "Account settings saved to your GMT app profile.";
    } catch (error) {
      status.textContent = error && error.message ? error.message : "Account settings could not be saved to the GMT app.";
    }
  });
}());
