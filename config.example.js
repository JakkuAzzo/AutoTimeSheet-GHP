// Copy this file to config.js in deployment, then set the live values.
// Do not commit private tokens or secrets to a public repository.

window.GMT_APP_CONFIG = {
  // Example: "https://formsubmit.co/ajax/your-submission-mailbox@example.com"
  formSubmitEndpoint: "",

  // Optional activated FormSubmit token endpoint for timesheets.
  // Example: "https://formsubmit.co/YOUR_ACTIVATED_TIMESHEET_TOKEN"
  formSubmitTimesheetEndpoint: "",

  // Example: "second-admin@example.com"
  formSubmitCc: "",

  // Admin emails allowed to request magic links.
  // This list is public and is not authentication by itself.
  allowedAdminEmails: [],

  // Future backend endpoint for sending magic links and reading encrypted GitHub records.
  magicLinkApiBase: ""
};
