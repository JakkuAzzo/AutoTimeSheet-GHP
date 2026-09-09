const GMT_SITE_BASE_PATH = /(^|\.)gmt-services\.co\.uk$/i.test(window.location.hostname)
  ? ""
  : "/AutoTimeSheet-GHP";

window.GMT_APP_CONFIG = {
  // The public FormSubmit route is retained as a delivery fallback until the
  // tenant-only Power Automate intake route has a licensed owner and a
  // server-side secret store. The client always uses its JSON response path
  // and only reports success after a 2xx response.
  timesheetIntakeEndpoint: "",
  timesheetIntakeScopes: [],
  timesheetFormSubmitEndpoint: "https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe",
  auditFormSubmitEndpoint: "",
  jobCardFormSubmitEndpoint: "",
  taskFormSubmitEndpoint: "",
  calendarFormSubmitEndpoint: "",
  // Estimate sending/history stay blank until the dedicated Microsoft 365
  // intake and protected read route are approved and tested.
  estimateFormSubmitEndpoint: "",
  estimateSendEndpoint: "",
  estimateHistoryEndpoint: "",
  estimateHistoryScopes: [],
  // Never fall back to a personal mailbox for client delivery. Populate this
  // only with the approved Accounts BCC route.
  estimateAccountsBcc: "",
  fallbackFormSubmitEndpoint: "https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe",
  legacyPersonalAccountsEmail: "acc.gmtelect@outlook.com",
  formSubmitEndpoint: "https://formsubmit.co/ajax/acc.gmtelect@outlook.com",
  formSubmitTimesheetEndpoint: "https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe",
  contactFormSubmitEndpoint: "https://formsubmit.co/ajax/a78f2a7fcd2b433809c0ee4f5d7a8cbe",
  // Server-enforced, tenant-only Power Automate history route.
  timesheetHistoryEndpoint: "https://b7db48c95976ef8e943878dfe20987.42.environment.api.powerplatform.com:443/powerautomate/automations/direct/cu/15/workflows/e25c8f033575417ea40c1ef91d2c852b/triggers/manual/paths/invoke?api-version=1",
  timesheetHistoryDetailEndpoint: "",
  // OAuth audience exposed by the Power Automate HTTP trigger.
  timesheetHistoryScopes: ["https://service.flow.microsoft.com//.default"],
  timesheetHistoryAppUrl: "https://make.powerautomate.com/",
  // Drafts must be persisted by an Entra-authenticated route before they are
  // treated as shared or recoverable across devices.
  timesheetDraftEndpoint: "",
  umami: {
    enabled: true,
    scriptUrl: "https://cloud.umami.is/script.js",
    websiteId: "3b22159f-da25-4ae0-93f1-beeaf858b685"
  },
  // Leave empty until accounts@gmt-services.co.uk is a mail-enabled Exchange mailbox.
  formSubmitCc: "",
  allowedAdminEmails: [],
  magicLinkApiBase: "",
  entraSpaAuth: {
    enabled: true,
    tenantId: "8b182d6b-6f34-4ca2-84ad-50ca712b5488",
    clientId: "01b5a6c6-f6c1-47cb-aebe-67f07f415e4b",
    // GitHub Pages uses the project subpath; the production custom domain does not.
    // Keeping this host-aware prevents Entra from returning staff to a non-existent
    // /AutoTimeSheet-GHP/portal/ route when they use https://gmt-services.co.uk/.
    redirectPath: /(^|\.)gmt-services\.co\.uk$/i.test(window.location.hostname)
      ? "/portal/"
      : "/AutoTimeSheet-GHP/portal/",
    allowedGroupIds: []
  }
};
