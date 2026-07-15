// Copy this file to config.js in deployment, then set the live values.
// Do not commit private tokens or secrets to a public repository.

window.GMT_APP_CONFIG = {
  // Category-specific FormSubmit endpoints. Fill these as each mailbox/alias is activated.
  // Timesheets may use an activated token URL. Audit and Job Cards should stay blank until confirmed.
  timesheetFormSubmitEndpoint: "",
  auditFormSubmitEndpoint: "",
  jobCardFormSubmitEndpoint: "",

  // Last-resort fallback for an already approved FormSubmit route.
  fallbackFormSubmitEndpoint: "",

  // Reference only, used during migration planning. Do not put mailbox passwords or secrets here.
  legacyPersonalAccountsEmail: "",

  // Example: "https://formsubmit.co/ajax/your-submission-mailbox@example.com"
  // Kept for deriving plus-addressed routes while business endpoints are not yet activated.
  formSubmitEndpoint: "",

  // Backward-compatible alias for older deployments. Prefer timesheetFormSubmitEndpoint.
  // Example: "https://formsubmit.co/YOUR_ACTIVATED_TIMESHEET_TOKEN"
  formSubmitTimesheetEndpoint: "",

  // Example: "second-admin@example.com"
  formSubmitCc: "",

  // Admin emails allowed to request magic links.
  // This list is public and is not authentication by itself.
  allowedAdminEmails: [],

  // Future backend endpoint for sending magic links and reading encrypted GitHub records.
  magicLinkApiBase: "",

  // Microsoft Entra SPA sign-in for the staff portal. Client and tenant IDs are
  // public identifiers, but no Graph permission, secret or mailbox token belongs here.
  entraSpaAuth: {
    enabled: false,
    tenantId: "",
    clientId: "",
    redirectPath: "/AutoTimeSheet-GHP/portal/",
    allowedGroupIds: []
  }
};
