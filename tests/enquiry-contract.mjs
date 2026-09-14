import assert from 'node:assert/strict';
import { canAccessRecord, projectRow } from '../cloudflare-worker/src/index.js';

const enquiry = {
  owner_oid: 'accounts-oid',
  owner_upn: 'acc.gmtelect@gmt-services.co.uk',
  employee_name: 'GMT Accounts',
  kind: 'enquiries',
  action: 'website_enquiry',
  status: 'New',
  start_date: '',
  end_date: '',
  record_date: '2026-09-14',
  submitted_at: '2026-09-14T10:00:00.000Z',
  updated_at: '2026-09-14T10:00:00.000Z',
  issue: '',
  record_id: 'enquiry-demo-001',
  payload_json: JSON.stringify({
    enquiryId: 'enquiry-demo-001',
    customerName: 'Example customer',
    customerEmail: 'customer@example.com',
    requestType: 'General enquiry',
    message: 'Please call me about a pump repair.',
    conversationUrl: 'https://outlook.office.com/mail/inbox/id/example',
    conversationId: 'conversation-demo-001',
    inboxStatus: 'Linked to inbox',
    messages: [
      { direction: 'inbound', author: 'Example customer', body: 'Please call me about a pump repair.', at: '2026-09-14T10:00:00.000Z' },
      { direction: 'outbound', author: 'GMT team', body: 'Thanks, we will review this.', at: '2026-09-14T10:05:00.000Z' }
    ]
  })
};

const office = { oid: 'info-oid', upn: 'info@gmt-services.co.uk', isAdmin: false, isOperationsAdmin: true, isJobCardAdmin: true };
assert.equal(canAccessRecord(office, enquiry), true);
const projected = projectRow(enquiry);
assert.equal(projected.kind, 'enquiries');
assert.equal(projected.customer_name, 'Example customer');
assert.equal(projected.customer_email, 'customer@example.com');
assert.equal(projected.conversation_id, 'conversation-demo-001');
assert.equal(projected.messages.length, 2);
assert.equal(projected.messages[1].direction, 'outbound');
assert.equal(projected.conversation_url, 'https://outlook.office.com/mail/inbox/id/example');
console.log('Enquiry projection and access: PASS');
