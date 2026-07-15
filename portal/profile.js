(function () {
  "use strict";

  var storageKey = "gmt.portal.profile.v1";
  var form = document.getElementById("portal-profile-form");
  var nameInput = document.getElementById("portal-profile-name");
  var emailInput = document.getElementById("portal-profile-email");
  var status = document.getElementById("portal-profile-status");

  if (!form || !nameInput || !emailInput) return;

  function readProfile() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch (_) {
      return {};
    }
  }

  function render(profile) {
    nameInput.value = profile.name || "";
    emailInput.value = profile.contactEmail || "";
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
    profile.name = profile.name || identity.name || "";
    profile.username = identity.username || profile.username || "";
    profile.subject = identity.subject || profile.subject || "";
    saveProfile(profile);
    render(profile);
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var profile = readProfile();
    profile.name = nameInput.value.trim();
    profile.contactEmail = emailInput.value.trim();
    if (!profile.name) {
      status.textContent = "Enter your name before saving your profile.";
      return;
    }
    if (!saveProfile(profile)) {
      status.textContent = "This browser could not save your profile.";
      return;
    }
    status.textContent = "Profile saved on this device.";
  });
}());
