# bOnline WordPress Handover Plan

## Decision

The GitHub project remains the working reference and staff-portal prototype.
The public GMT website should be rebuilt natively in WordPress by bOnline or a
WordPress developer with appropriate theme/plugin/server access.

Do not paste the static prototype wholesale into a standard WordPress page editor.
That approach bypasses the theme layout system and produces fragile, poorly
responsive pages. The supplied package is a design/content/asset reference, not
a request to embed the GitHub site in an iframe.

## What bOnline Should Build

- A modern public homepage using the GMT logo and approved content.
- Responsive service sections/pages for motor rewind, electrical motor repair,
  fan repair and installation, pump repairs and installations, kitchen
  extractors, and mechanical gearbox repair.
- Contact details and workshop location:
  `93-95 Gloucester Rd, Croydon CR0 2DN`.
- A visible map implemented through the WordPress-approved map method.
- Public navigation, contact calls to action, SEO metadata and accessibility.
- A subtle Staff Portal link only. The portal must not expose private records.

## What Should Remain Separate Initially

- Timesheet creation and export.
- Audit checker and Word/XLSX parsing.
- Job Cards, Tasks and Calendar.
- FormSubmit endpoints, Microsoft 365 routes and Power Automate.

The prototype can be linked as `Staff Portal` during the trial. It should move
under the GMT domain only after authentication and secure operational storage
are approved.

## Handover ZIP Contents

The final handover archive should include:

- Public-site HTML, CSS, JavaScript and approved images.
- Logo (`image.png`) and an asset inventory with source/usage notes.
- Screenshot references for desktop and mobile layouts.
- Service copy, contact details and proposed page structure.
- Portal link and route recommendations.
- Accessibility/responsive requirements.
- This handover plan.

The archive must exclude:

- `config.js` and any active FormSubmit endpoint or token.
- `.git`, `node_modules`, private test attachments, local browser data and
  generated temporary files.
- Microsoft 365 credentials, Power Automate connection details and mailbox data.

Use `config.example.js` only where a configuration example is useful.

## Proposed Public Sitemap

```text
Home
Services
  Motor Rewind
  Electrical Motor Repair
  Fan Repair and Installation
  Pump Repairs and Installations
  Kitchen Extractors
  Mechanical Gearbox Repair
About
Contact
Staff Portal (subtle external/internal link)
```

## Acceptance Checks for bOnline

- No horizontal scroll at mobile widths.
- Public contact actions are visible and tappable.
- The address and map are accurate.
- The logo is crisp and correctly proportioned.
- Images have meaningful captions/alt text where needed.
- Public pages have no links to internal source data or private submissions.
- Staff Portal is visible but not presented as a public customer service.
- WordPress page content is editable through the approved theme/page-builder
  workflow, rather than an unsupported raw-code block.

## Deliverables Requested From bOnline

- Staging URL for review before replacing the current homepage.
- Theme/page-builder changes documented.
- Image/media optimisation details.
- Backup/export of the existing public site before go-live.
- Post-launch access and maintenance instructions.
