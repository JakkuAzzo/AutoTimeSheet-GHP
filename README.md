# GMT Timesheet Checker & Builder

Guest-first web application for GMT weekly timesheets.

Employees can submit timesheets without an account. The public form is designed for mobile and laptop use and supports day-by-day entries with:

- employee name required before submission
- week start date
- location / site per day
- start and finish time per day
- lunch yes/no and lunch length
- absent yes/no
- work description / notes
- image uploads per day
- plus button to add the next day
- local draft save
- calculated Basic / OT x1.5 / OT x2.0 totals
- FormSubmit email submission

## GMT overtime rules

The app uses these GMT rules:

- Weekday hours count toward the 40h weekly basic threshold.
- Weekday hours above 40h are OT x1.5.
- Saturday before 13:00 is OT x1.5.
- Saturday after 13:00 is OT x2.0.
- Sunday is OT x2.0 all day.
- Hours over 50 are not automatically OT x2.0.

## Configuration

Copy `config.example.js` to `config.js` for deployment and set:

```js
window.GMT_APP_CONFIG = {
  formSubmitEndpoint: "https://formsubmit.co/ajax/YOUR_SUBMISSION_MAILBOX",
  formSubmitCc: "OPTIONAL_CC_MAILBOX",
  allowedAdminEmails: [],
  magicLinkApiBase: ""
};
```

Do not commit private tokens or secrets to a public repository.

Submission email routing uses plus-addressed aliases derived from `formSubmitEndpoint` so Outlook or Power Automate can filter by recipient:

- To contains `+timesheets` -> Timesheets folder
- To contains `+audit` -> Audit folder
- To contains `+jobcards` -> Job Cards folder
- To contains `+jobcard-images` -> Job Card Images folder

FormSubmit may treat each plus-addressed alias as a separate destination. Confirm one test email to each alias before relying on the rules in production.

## Current structure

- `index.html` — guest employee timesheet form
- `script.js` — guest form logic, calculations, draft save, FormSubmit submission
- `styles.css` — responsive mobile/laptop styling
- `config.example.js` — safe deployment configuration template
- `audit/index.html` — browser-side archive audit/reconciliation tool
- `docs/admin-magic-link-encrypted-storage.md` — secure admin storage and magic-link backend design
- `server.js` — legacy Express/SQLite backend retained for reference during migration

## Admin records and encrypted GitHub storage

The requested admin feature requires a backend. GitHub Pages alone cannot securely:

- send one-time admin access links
- verify admin identity
- hold a GitHub write token
- write employee records into GitHub
- decrypt records only for verified admins

See `docs/admin-magic-link-encrypted-storage.md` for the backend contract and secure architecture.

## Local development

Static guest form:

```bash
npx serve .
```

Legacy backend, if needed:

```bash
npm install
npm start
```

## Browser compatibility

Requires a modern browser with:

- ES6+ JavaScript
- Fetch API
- LocalStorage
- CSS Grid/Flexbox

## License

ISC
