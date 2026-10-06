# Estimate mail to SharePoint flow

This document defines the archive and client-send contracts. `acc.gmtelect@outlook.com` is excluded because Amanda's work account cannot access it. The approved mailboxes are `info@gmt-services.co.uk` and `accounts@gmt-services.co.uk`; source mail must remain untouched. Use a mailbox-and-folder trigger for each accessible Inbox and Sent Items location, all writing to the GMT SharePoint estimate area. Do not assume a single shared-mailbox trigger watches the other mailboxes.

## Trigger and extraction

1. Trigger on new Inbox and Sent Items messages in each approved mailbox. Search using `estimate` plus known company reference patterns, then inspect message direction, sender, recipients, body context, and attachment names/content. Do not classify solely because a message contains `quote` or `quotation`.
2. Classify high-confidence sent customer estimates separately from related customer replies/POs and supplier quotations. Once a real estimate conversation is identified, archive related messages by `conversationId` only when the customer/job relationship is corroborated. Send ambiguous matches to review; do not archive unrelated mailbox attachments.
3. Extract the Outlook message ID, Graph `internetMessageId`, conversation ID, web link, sender, recipients, sent/received time, subject, full body, attachments, estimate number, client name, client email, job/reference terms, and estimate date. Retrieve original MIME content for `.eml` storage rather than synthesizing an EML from a body preview.
4. Use Graph `internetMessageId` as the cross-mailbox duplicate identity where available; otherwise use the mailbox-local Outlook message ID. Keep every source mailbox occurrence and preserve revised estimates as distinct messages/attachment versions.
5. Preserve revised estimate numbers in `number_aliases` rather than replacing the canonical number. Link job cards, estimates, invoices, and messages only on confident reference/client evidence; leave ambiguous matches for Accounts review.

## SharePoint upsert

Store the original `.eml`, each relevant attachment, and a searchable manifest under `Shared Documents/Estimates/Incoming`, then upsert the canonical index row with source `email`, mailbox-local Outlook message ID, `internet_message_id`, conversation ID, SharePoint item IDs, and classification state. Keep the SharePoint library service-restricted; authenticated portal users retrieve files through the Worker, which verifies tenant identity and streams file content without returning provider IDs or public SharePoint URLs. Use message identity plus attachment hash as the duplicate guard. Retries must update an existing item or use deterministic names so they do not create duplicate documents.

Historical backfill pages through Inbox and Sent Items for both approved mailboxes with persisted continuation/delta state. Report per-mailbox totals for scanned, confirmed estimates, related conversation messages, duplicate copies, excluded supplier/unrelated mail, needs-review items, and failures. Preserve the cursor and make retries idempotent. Do not report completion until every folder has a reconciled result.

## Failures

Transient Graph/SharePoint failures retry with the platform policy. After retries are exhausted, write the mailbox/source ID, error, and non-sensitive payload summary to a restricted Accounts review queue. Do not delete, move, mark, or categorize the source email.

App-created estimates send the same index fields through the authenticated portal API with source `app`. Estimates, job cards, conversation metadata, and attachment/EML downloads are visible to authenticated portal users. Xero financial actions remain Accounts-only.

## Portal-created client delivery

The estimate builder creates a protected estimate record, files the generated document in `Shared Documents/Estimates/Sent from Portal`, and only then calls the authenticated Worker `POST /api/estimates/send` route. The Worker refuses to send unless it can find the matching app archive record and a configured `ESTIMATE_SEND_FLOW_URL` secret. The browser must show a review confirmation containing estimate number, client, recipient, Accounts copy, and total before calling the route. The browser obtains a delegated Flow Service access token for the signed-in employee only when Send is selected; it sends that token separately from the portal API token. The Worker verifies the signature, tenant, Flow Service audience, issuer, validity period, and that the Flow token object ID matches the signed-in portal identity, then forwards it as the Power Automate bearer token. It never accepts a trigger URL from the browser.

Configure the Power Automate **When an HTTP request is received** trigger with **Any user in my tenant**. Do not use **Anyone**. The trigger must accept these top-level JSON properties: `idempotencyKey`, `recordId`, `to`, `bcc`, `subject`, `message`, `number`, `date`, `company`, `attention`, `reference`, `total`, `fileName`, `contentType`, `contentBase64`, and `requestedAt`. The deployed Worker scope is `https://service.flow.microsoft.com//.default`; Power Automate validates the resulting bearer token audience as `https://service.flow.microsoft.com/` (including the final slash).

The Outlook action sends from the approved `info@gmt-services.co.uk` company mailbox. Map **To** to `to`, **Subject** to `subject`, **Body** to `message`, BCC to the fixed `accounts@gmt-services.co.uk` Accounts copy, attachment **Name** to `fileName`, and attachment **Content** to `base64ToBinary(triggerBody()?['contentBase64'])`. Do not allow a request to change the sender or remove the Accounts copy. The Worker records `recordId` as its idempotency key and blocks repeats once sending has started; the flow must not add an automatic retry around the mail-send action. Add a Response action after the mail-send action and return HTTP 200 JSON `{ "success": true, "sentAt": "<UTC ISO-8601 timestamp>" }` only on success. On failure, return a non-2xx response with a non-sensitive message. Do not configure a personal mailbox or generic public endpoint.

The current Safari editor showed the trigger set to **Any user in my tenant**, but the flow remains an unsaved draft. The live send action was not saved or run, the trigger URL has not been stored in the Worker secret, and the email mapping is not yet verified. Do not claim client sending works until the flow is saved, `ESTIMATE_SEND_FLOW_URL` is set as a Cloudflare Worker secret, and the pipeline is verified without sending to a real client.
