# Newest-first Xero invoice linking

## Goal
Start the invoice cross-linking pass with the newest invoice dates, while preserving the current rule that only exact, unique matches are automatically confirmed.

## Steps
1. Add a tested, deterministic invoice date-descending ordering helper.
2. Use it in the Accounts invoice register so newest invoices are at the top after SharePoint load and filtering.
3. Run invoice UI/contract tests and deploy the verified change to the public portal.
4. In the authenticated Accounts portal, open newest invoices in order; the existing detail route fetches the authoritative Xero record and persists exact estimate/job-card/email/conversation links. Record ambiguous and unmatched results without forcing associations.
