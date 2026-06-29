# GMT Website Redesign and Portal Integration Plan

## Current Sites

- Prototype app: `https://jakkuazzo.github.io/AutoTimeSheet-GHP/`
- Public website: `https://gmt-services.co.uk`

The public website should remain a customer-facing brochure/contact site. The staff portal should be integrated deliberately and should not expose operational records publicly.

## Content to Preserve

- GMT established in 1985.
- Motor rewind.
- Electrical motor repair.
- Fan repair and installation.
- Pump repairs and installations.
- Kitchen extractors.
- Mechanical gearbox repair.
- Contact details.
- Address: `93-95 Gloucester Rd, Croydon CR0 2DN`.

## Proposed Public Sitemap

```text
Home
Services
  Motor Rewind
  Electrical Motor Repair
  Fan Repair & Installation
  Pump Repairs & Installations
  Kitchen Extractors
  Mechanical Gearbox Repair
About
Contact
Staff Portal
```

## Design Goals

- Modern mobile-first design.
- Real GMT logo.
- Fast page loads.
- Strong contact call-to-action.
- Clear service cards.
- Address and phone/email visible.
- Urgent repair messaging where appropriate.
- Better SEO titles and descriptions.
- Accessible headings, links, forms, colors, and focus states.
- No sensitive staff, payroll, audit, task, or job-card data on public pages.

## Staff Portal Routes

Current GitHub Pages trial routes:

```text
/portal
/timesheets
/timesheets/create.html
/audit
/jobs
/tools
/tasks
/calendar
```

Longer-term portal routes should move behind a consistent portal prefix:

```text
/portal
/portal/timesheets
/portal/timesheets/create
/portal/audit
/portal/job-cards
/portal/tasks
/portal/calendar
```

Current GitHub Pages routes can remain during trial, but the public website should link to a clear Staff Portal entry point.

## Supplied Website Asset ZIP

The exported `gmt-services.co.uk` asset ZIP contains useful service imagery and a lower-resolution duplicate logo file.

- Keep using the existing repo `image.png` logo.
- Do not use the lower-quality `asset-20.png` logo from the ZIP.
- Useful service images can be copied into `assets/website/` with descriptive names.
- Do not import the old WordPress/Divi JavaScript bundle into the GitHub Pages app.
- Keep the remade public site static, lightweight, and separate from staff workflow scripts.

## Short-Term Integration

- Keep the GitHub Pages prototype running.
- Add a Staff Portal link on the public site that points to `/portal/`.
- Keep portal access minimally exposed while trialling.
- Keep Tasks and Calendar labelled as in progress.
- Do not publish private Microsoft, payroll, OneDrive, SharePoint, Lists, or audit data.

## Medium-Term Integration

Move the portal under either:

```text
gmt-services.co.uk/portal
```

or:

```text
portal.gmt-services.co.uk
```

Add authentication before operational records are exposed.

## Long-Term Integration

- Replace FormSubmit with a secure backend or worker.
- Use Microsoft Graph only from backend or worker code.
- Read/write selected records through Microsoft Lists or SharePoint securely.
- Keep frontend code free of secrets.
- Use an exported public-safe JSON index only if direct private data access is not required.

## Implementation Guardrails

- Do not change the production public website without explicit approval.
- Do not move the app under the main domain until routing, auth, and cache behavior are agreed.
- Do not add Microsoft Graph or OneDrive tokens to frontend JavaScript.
- Do not expose employee, payroll, job-card, or audit records publicly.

## Acceptance Criteria

- Public website redesign plan is documented.
- Portal route strategy is clear.
- Short, medium, and long-term portal options are separated.
- Sensitive data remains private.
- No production website changes are made without approval.
