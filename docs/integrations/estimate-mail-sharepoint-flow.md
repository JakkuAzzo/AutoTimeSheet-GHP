# Estimate mail to SharePoint flow

Target design; the Power Automate flow is not yet configured or verified. The Accounts-owned intake must watch `info@gmt-services.co.uk`, `accounts@gmt-services.co.uk`, and `acc.gmtelect@outlook.com` for both incoming and outgoing estimate messages and attachments. Use a mailbox-and-folder trigger for each accessible Inbox and Sent Items location, all writing to the shared GMT SharePoint estimate/document area. Do not assume a single shared-mailbox trigger watches the other mailboxes.

## Trigger and extraction

1. Trigger on new Inbox and Sent Items messages in each approved mailbox, including messages with attachments. Filter for estimate/quote/quotation messages before archiving so unrelated attachments are not copied.
2. Extract the Outlook message ID, Graph `internetMessageId`, web link, sender, recipients, sent/received time, subject, body preview, attachments, estimate number, client name, client email, job/reference terms, and estimate date.
3. Use Graph `internetMessageId` as the cross-mailbox duplicate identity where available; otherwise use the mailbox-local Outlook message ID. Repeated copies update one index row.
4. Preserve revised estimate numbers in `number_aliases` rather than replacing the canonical number. Link job cards, estimates, invoices, and messages only when the reference/client match is confident; leave ambiguous matches for Accounts review.

## SharePoint upsert

Store the original message URL and each estimate attachment in `Shared Documents/Estimates/Incoming`, then upsert the canonical index row with source `email`, mailbox-local Outlook message ID, `internet_message_id`, SharePoint URLs, and `correlation_status`. Make the archive readable to the authenticated GMT Staff Portal audience through the existing SharePoint site membership. Use message identity plus attachment hash as the duplicate guard. The flow is safe to retry: repeated delivery updates the same row and does not create another document.

## Failures

Transient Graph/SharePoint failures retry with the platform policy. After retries are exhausted, write the message ID, error, and payload summary to the Accounts review queue. Do not delete or mark the source email as processed until the SharePoint write and index upsert succeed.

App-created estimates send the same index fields through the authenticated portal API with source `app`. The portal estimate index is available to authenticated portal identities; the linked SharePoint files and job/invoice records must preserve that same audience boundary.
