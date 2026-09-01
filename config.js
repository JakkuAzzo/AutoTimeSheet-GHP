const GMT_SITE_BASE_PATH = /(^|\.)gmt-services\.co\.uk$/i.test(window.location.hostname)
  ? ""
  : "/AutoTimeSheet-GHP";

window.GMT_APP_CONFIG = {
  timesheetFormSubmitEndpoint: "https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe",
  auditFormSubmitEndpoint: "",
  jobCardFormSubmitEndpoint: "",
  taskFormSubmitEndpoint: "",
  calendarFormSubmitEndpoint: "",
  // Leave blank until the dedicated estimate intake mailbox/token and filing flow are approved.
  estimateFormSubmitEndpoint: "",
  fallbackFormSubmitEndpoint: "https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe",
  legacyPersonalAccountsEmail: "acc.gmtelect@outlook.com",
  formSubmitEndpoint: "https://formsubmit.co/ajax/acc.gmtelect@outlook.com",
  formSubmitTimesheetEndpoint: "https://formsubmit.co/7aa066a9c2d177d1c0702281ab88d0fe",
  contactFormSubmitEndpoint: "https://formsubmit.co/ajax/a78f2a7fcd2b433809c0ee4f5d7a8cbe",
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
