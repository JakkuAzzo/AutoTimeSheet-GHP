# GMT Timesheet Checker & Builder

Static, client-side web app for validating GMT weekly timesheets and building them in the browser.

Highlights:
- Upload Word `.docx` weekly timesheets (GMT template). The browser uses Mammoth.js to convert to HTML and parses the table.
- Manual entry: add/edit rows for Date, Day, Week, Start, Finish, Lunch, Basic, OT 1.5, OT 2.0, Notes.
- Recalculate totals and flag discrepancies between worked time (Finish − Start − Lunch) and entered (Basic + OT1.5 + OT2.0).
- Export current table to CSV.
- 100% local — no servers or backend.

## Project structure

- `index.html` — UI markup and CDN import of Mammoth.js
- `styles.css` — dark UI styling
- `script.js` — core logic, parsing, calculations, CSV export, and `.docx` processing

## Run locally

Just open `index.html` in a modern browser (Chrome, Edge, Safari, Firefox).

Optionally start a local static server on macOS:

```zsh
# Python 3
python3 -m http.server 8080
# Then visit http://localhost:8080/
```

## GitHub Pages

Enable Pages for this repository:
1. GitHub → Settings → Pages
2. Source: Deploy from a branch
3. Branch: `main`
4. Folder: `/` (root)

After publishing, share the site URL with the team.

## Supported inputs

1. Manual entry in the browser form.
2. Upload Word `.docx` GMT weekly timesheet using the standard table:

```
DATE | WORKSITE ADDRESS | START | FINISH | LUNCH | BASIC HRS | O/T 1.5 | O/T 2.0
```

PDFs are not parsed automatically; please upload the original Word document or enter data manually.

## Notes

- Mammoth.js (browser build via CDN) converts `.docx` → HTML.
- Parsing heuristics look for the table whose first row resembles a timesheet header and read subsequent rows.
- Week label is extracted from nearby text (e.g., "Week Number:" or "Week Beginning:"), if present.
- Times and durations accept `HH:MM` or minutes where appropriate.
