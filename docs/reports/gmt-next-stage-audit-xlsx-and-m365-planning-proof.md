# GMT Next Stage Audit XLSX and Microsoft 365 Planning Proof

## Summary

This change adds the next-stage planning documents, extends the audit checker to treat app-generated XLSX timesheets as first-class audit sources, and adds the first static public-site remake with the staff tools behind `/portal/`.

Browser proof used Playwright because the in-app Browser surface was not available in this session.

## Changed Areas

- Added Microsoft 365 business mailbox, Outlook, SharePoint, Lists, and Power Automate migration planning.
- Added public website redesign and Staff Portal integration planning.
- Added audit usability and source-format validation planning.
- Added audit parser support for app-generated XLSX files using the `All` sheet and `Totals` metadata fallback.
- Added regression fixture coverage for clean app-generated XLSX and mixed Word + XLSX ZIP.
- Added a customer-facing GMT public homepage at `/`.
- Moved the staff dashboard entry point to `/portal/`.
- Imported useful service imagery from the supplied `gmt-services.co.uk` asset ZIP into `assets/website/`.
- Kept the existing higher-quality `image.png` logo and ignored the lower-quality `asset-20.png` duplicate logo.

## Fixture Proof

| Case | Result |
| --- | --- |
| Ainsley clean Word | 5 rows, 0 warnings, 0 parse errors, no horizontal overflow |
| Jason issue ZIP | 20 rows, 3 warnings, 0 parse errors, no horizontal overflow |
| App-generated XLSX clean | 5 rows, 0 warnings, 0 parse errors, source type shown as app-generated XLSX |
| Mixed Word + XLSX ZIP | 10 rows, 0 warnings, 0 parse errors, source summary shows Word and app-generated XLSX |

## Commands

```text
npm run test:audit:fixtures
AUDIT_ZIP_PATH=/tmp/codex-remote-attachments/019f039e-fc5f-76c1-8bd0-c3139147a1ea/A4885FD6-2643-4FF6-82CF-0326555F8A4C/1-Jason-June-26-Time-Sheets.zip npm run test:audit:jason-zip
npm run test:timesheets:daily-calculation
npm run test:timesheets:email-routing
npm run test:jobs:email-routing
git diff --check
```

## Screenshot Evidence

- Mobile Ainsley clean Word: `docs/reports/assets/audit-proof-mobile-ainsley-clean-word.png`
- Mobile Jason issue ZIP: `docs/reports/assets/audit-proof-mobile-jason-issue-zip.png`
- Desktop app-generated XLSX clean: `docs/reports/assets/audit-proof-desktop-app-xlsx-clean.png`
- Desktop mixed Word + XLSX: `docs/reports/assets/audit-proof-desktop-mixed-word-xlsx.png`
- Mobile public site: `docs/reports/assets/public-site-mobile.png`
- Laptop public site: `docs/reports/assets/public-site-laptop.png`
- Desktop public site: `docs/reports/assets/public-site-desktop.png`
- Public site embedded Leaflet map proof: `docs/reports/assets/public-site-map-element.png`
- Mobile staff portal dashboard: `docs/reports/assets/portal-dashboard-mobile.png`
- Desktop staff portal dashboard: `docs/reports/assets/portal-dashboard-desktop.png`

## Remaining Manual Gates

- Real iPhone Safari upload for the same source types.
- Real FormSubmit delivery for audit and job card business routes after each alias/token is activated.
- Microsoft 365 tenant admin, licensing, plus-addressing, SharePoint, Lists, and Power Automate checks.
- Public website redesign approval before changing `gmt-services.co.uk`.
