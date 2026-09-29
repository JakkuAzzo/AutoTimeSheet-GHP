# Invoice and GMT Record Linking Design

## Goal

Make the authenticated Accounts invoice workflow usable for day-to-day work and make the relationship between Xero invoices, GMT job cards, and estimates visible and editable from either side.

## Scope

The change covers the protected invoice workspace, existing job-card and estimate detail views, the portal API, Worker persistence, and responsive presentation. Xero remains the financial source of truth. Only Accounts administrators may create, edit, send, delete, or link invoices.

## User experience

The invoice page becomes a responsive two-pane workspace. The left pane contains a searchable invoice register with status, customer, date, amount due, and linked-record count. The right pane shows the selected invoice, line items, Xero status, audit history, and actions. Loading, empty, disconnected, forbidden, and error states are explicit.

Each invoice has a Linked GMT records section. Accounts users can search and add estimates or job cards, remove links, and open the source record. Existing links are labelled by type and deduplicated.

Job-card and estimate detail views receive an Invoice links section showing linked invoice number, Xero status, total, amount due, and a link to the invoice workspace. Accounts users can attach an existing invoice, detach it, or open the invoice. Non-Accounts users can see only the links permitted by existing record access rules.

## Data and API

Reuse the existing Xero invoice and GMT record projections. Add narrowly scoped lookup/link endpoints only where the current endpoints cannot support reverse lookup or search. Persist invoice-record relationships in the existing invoice-link table with a uniqueness constraint on invoice ID, record kind, and record ID. Every add/remove operation writes the existing audit record with actor identity and timestamp.

Invoice mutations continue to call Xero and then refresh the GMT projection and audit trail. Failed Xero calls must not create a partial GMT link state. Link operations do not mutate Xero financial data.

## Permissions and errors

The Worker enforces Accounts administrator access for invoice mutations and link changes. Existing record-level access checks remain in force for job cards and estimates. The UI must surface 401/403, unavailable Xero connection, validation, and conflict responses without losing unsaved editor state.

## Testing and release checks

Add focused contract tests for reverse link lookup, deduplication, permission enforcement, and audit writes. Add browser/static checks for the invoice workspace and record detail link panels, including mobile layout. Run the existing Xero integration contract, Worker deployment checks, syntax checks, and diff checks. Verify the public Pages deployment and the protected Worker route after release.
