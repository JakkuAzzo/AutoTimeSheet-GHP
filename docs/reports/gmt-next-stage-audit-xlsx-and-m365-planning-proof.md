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
- Added mobile homepage stability fixes for orientation changes, Leaflet map resizing, and horizontal overflow.
- Changed the public homepage services section to a manual mobile carousel while keeping the desktop grid.
- Polished the public homepage headline, mobile carousel controls, and Leaflet map control rendering.
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
node --check public-site.js
Playwright local homepage run: 390x844, 844x390, 390x844 after rotation, and 1366x900
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
- Mobile homepage carousel first slide: `docs/reports/assets/public-homepage-mobile-carousel-first.png`
- Mobile homepage carousel later slide: `docs/reports/assets/public-homepage-mobile-carousel-later.png`
- Mobile homepage landscape after resize: `docs/reports/assets/public-homepage-mobile-landscape.png`
- Mobile homepage portrait after landscape rotation: `docs/reports/assets/public-homepage-mobile-portrait-after-rotate.png`
- Desktop services grid layout: `docs/reports/assets/public-homepage-desktop-services-layout.png`
- Mobile polished heading and map: `docs/reports/assets/public-homepage-polish-mobile-heading-map.png`
- Mobile polished carousel controls: `docs/reports/assets/public-homepage-polish-mobile-carousel-controls.png`
- Mobile polished map close view: `docs/reports/assets/public-homepage-polish-mobile-map.png`
- Landscape polished map: `docs/reports/assets/public-homepage-polish-landscape-map.png`
- Mobile staff portal dashboard: `docs/reports/assets/portal-dashboard-mobile.png`
- Desktop staff portal dashboard: `docs/reports/assets/portal-dashboard-desktop.png`

## Public Homepage Mobile Stability Proof

| Check | Result |
| --- | --- |
| iPhone portrait 390x844 | Passed: no horizontal overflow, map visible, pin visible, carousel controls visible |
| Carousel first to later slide | Passed: dot moved from 1 to 2, track translated by one card width |
| iPhone landscape 844x390 | Passed: no horizontal overflow, map visible at 240px height, carousel controls still visible |
| Portrait after landscape rotation | Passed: no horizontal overflow, map visible, pin visible, carousel retained a valid slide |
| Carousel after rotation | Passed: next button still advanced the slide |
| Desktop 1366x900 | Passed: services remained a grid, carousel controls hidden, no horizontal overflow |
| Console/page errors | Passed: none captured during local Playwright run |

## Public Homepage Polish Proof

| Check | Result |
| --- | --- |
| Mobile heading | Passed: heading reads `Motor, pump, fan and gearbox specialists since 1985` |
| Mobile carousel controls | Passed: previous/next controls are equal 44x44 compact buttons with aria labels |
| Mobile map controls | Passed: Leaflet zoom controls measured 28x28 in portrait and 30x30 in landscape |
| Mobile attribution | Passed: attribution stays compact while preserving OpenStreetMap and CARTO text |
| Mobile zoom simulation | Passed: no horizontal overflow after page scale factor 1.35 |
| Rotation | Passed: portrait -> landscape -> portrait kept map, marker, carousel, and links stable |

## Remaining Manual Gates

- Real iPhone Safari upload for the same source types.
- Real FormSubmit delivery for audit and job card business routes after each alias/token is activated.
- Microsoft 365 tenant admin, licensing, plus-addressing, SharePoint, Lists, and Power Automate checks.
- Public website redesign approval before changing `gmt-services.co.uk`.
