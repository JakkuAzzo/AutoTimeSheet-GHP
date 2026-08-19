(function () {
  "use strict";

  var storageKey = "gmt.portal.profile.v1";
  var form = document.getElementById("portal-profile-form");
  var nameInput = document.getElementById("portal-profile-name");
  var loginEmailInput = document.getElementById("portal-profile-login-email");
  var emailInput = document.getElementById("portal-profile-email");
  var status = document.getElementById("portal-profile-status");

  if (!form || !nameInput || !loginEmailInput || !emailInput) return;

  function readProfile() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch (_) {
      return {};
    }
  }

  function render(profile) {
    nameInput.value = profile.name || "";
    loginEmailInput.value = profile.username || "";
    emailInput.value = profile.notificationEmail || "";
  }

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function saveProfile(profile) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(profile));
      return true;
    } catch (_) {
      return false;
    }
  }

  render(readProfile());

  document.addEventListener("gmtportalidentity", function (event) {
    var identity = event.detail || {};
    var profile = readProfile();
    var previousUsername = profile.username || "";
    var previousSubject = profile.subject || "";
    var legacyContactEmail = profile.contactEmail || "";
    var identityName = String(identity.name || "").trim();
    // A tenant may have no display name and return the sign-in address as
    // account.name. Never present that address as the employee's full name.
    // Preserve a manually entered name only for the same authenticated user.
    profile.name = !looksLikeEmail(identityName)
      ? identityName
      : (previousSubject === (identity.subject || "") && !looksLikeEmail(profile.name) ? profile.name : "");
    profile.username = identity.username || "";
    profile.subject = identity.subject || "";
    // Migrate the old contactEmail field only when it was genuinely a
    // separate address; previous versions used it for the GMT login.
    if (!profile.notificationEmail && legacyContactEmail && legacyContactEmail !== previousUsername) {
      profile.notificationEmail = legacyContactEmail;
    }
    delete profile.contactEmail;
    saveProfile(profile);
    render(profile);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var profile = readProfile();
    profile.name = nameInput.value.trim();
    profile.notificationEmail = emailInput.value.trim();
    if (profile.notificationEmail && !emailInput.checkValidity()) {
      status.textContent = "Enter a valid personal email address.";
      return;
    }
    if (!saveProfile(profile)) {
      status.textContent = "This browser could not save your profile.";
      return;
    }
    status.textContent = "Account settings saved on this device.";
  });
}());
