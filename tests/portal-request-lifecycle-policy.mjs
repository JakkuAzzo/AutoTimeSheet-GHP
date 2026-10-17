import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canAccessRecord, normaliseInput, validatePortalRequestMutation } from '../cloudflare-worker/src/index.js';

const employee = {
  oid: 'employee-oid',
  upn: 'employee@gmt-services.co.uk',
  name: 'GMT Employee',
  isAdmin: false,
  isOperationsAdmin: false
};
assert.equal(canAccessRecord(employee, { kind: 'tasks', owner_oid: employee.oid, owner_upn: employee.upn, action: 'create_request' }), true);
assert.equal(canAccessRecord(employee, { kind: 'tasks', owner_oid: 'another-employee', owner_upn: 'another@gmt-services.co.uk', action: 'create_request' }), false, 'a staff member cannot mutate another requester’s task');

assert.doesNotThrow(() => validatePortalRequestMutation({
  kind: 'calendar', action: 'create_request', status: 'Pending approval'
}));
assert.doesNotThrow(() => validatePortalRequestMutation({
  kind: 'tasks', action: 'update_request', payload: { title: 'Repair pump' }
}, { kind: 'tasks', status: 'Pending approval' }));
assert.doesNotThrow(() => validatePortalRequestMutation({
  kind: 'calendar', action: 'update_request', status: 'Cancelled'
}, { kind: 'calendar', status: 'Pending approval' }));

for (const status of ['Approved', 'Rejected', 'Submitted', 'Saved', 'To-Do', 'In-Progress', 'Completed', 'Cancelled']) {
  if (status === 'Cancelled') continue;
  assert.throws(() => validatePortalRequestMutation({
    kind: 'calendar', action: 'create_request', status
  }), (error) => error.status === 403, `new requests cannot set ${status}`);
  assert.throws(() => validatePortalRequestMutation({
    kind: 'tasks', action: 'update_request', payload: { status }
  }, { kind: 'tasks', status: 'Pending approval' }), (error) => error.status === 403, `pending requests cannot be changed to ${status}`);
}

for (const status of ['Approved', 'Rejected', 'Cancelled', 'Completed']) {
  assert.throws(() => validatePortalRequestMutation({
    kind: 'calendar', action: 'update_request', payload: { title: 'Changed' }
  }, { kind: 'calendar', status }), (error) => error.status === 409, `decided ${status} requests cannot be edited`);
}

assert.throws(() => validatePortalRequestMutation({ kind: 'tasks', action: 'approve_request' }), (error) => error.status === 400);
assert.throws(() => validatePortalRequestMutation({ kind: 'tasks', status: 'Pending approval' }), (error) => error.status === 400);
assert.throws(() => validatePortalRequestMutation({ kind: 'calendar', action: 'create_request' }, { kind: 'tasks', status: 'Pending approval' }), (error) => error.status === 409);
assert.throws(() => validatePortalRequestMutation({ kind: 'timesheets', action: 'update_request', status: 'Approved' }, { kind: 'tasks', status: 'Pending approval' }), (error) => error.status === 409);

const legacyPending = normaliseInput({
  recordId: 'task-legacy', action: 'update_request', payload: { title: 'Repair pump' }
}, employee, { kind: 'tasks', status: 'Saved', record_id: 'task-legacy', owner_oid: employee.oid, owner_upn: employee.upn });
assert.equal(legacyPending.kind, 'tasks', 'an update that omits kind preserves the existing request category');
assert.equal(legacyPending.status, 'Saved', 'an edit with no status preserves the existing request state');

const worker = readFileSync(new URL('../cloudflare-worker/src/index.js', import.meta.url), 'utf8');
assert.equal((worker.match(/validatePortalRequestMutation\(body, existing\)/g) || []).length, 2, 'upsert and PATCH routes call the request lifecycle policy');

console.log('Portal request lifecycle policy checks: PASS');
