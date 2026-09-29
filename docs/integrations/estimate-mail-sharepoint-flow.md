# Estimate mail to SharePoint flow

The Accounts-owned flow watches `info@gmt-services.co.uk` for estimate messages and attachments. It must use the existing Microsoft 365 connection and write only to the GMT SharePoint estimate/document area.

## Trigger and extraction

1. Trigger on a new message in the mailbox (including messages with attachments).
2. Extract the Outlook message ID, web link, sender, recipients, received time, subject, body preview, attachments, estimate number, client name, client email, job/reference terms, and estimate date.
3. Set `canonical_id` from the explicit estimate number and client identity; when no stable number exists, use a deterministic hash of message ID and attachment hash.
4. Preserve revised numbers in `number_aliases` rather than replacing the canonical number.

## SharePoint upsert

Store the original message URL and each estimate attachment, then upsert the canonical index row with source `email`, Outlook message ID, SharePoint URLs, and `correlation_status`. Use message ID plus attachment hash as the duplicate guard. The flow is safe to retry: repeated delivery updates the same row and does not create another document.

## Failures

Transient Graph/SharePoint failures retry with the platform policy. After retries are exhausted, write the message ID, error, and payload summary to the Accounts review queue. Do not delete or mark the source email as processed until the SharePoint write and index upsert succeed.

App-created estimates send the same index fields through the authenticated portal API with source `app`.
