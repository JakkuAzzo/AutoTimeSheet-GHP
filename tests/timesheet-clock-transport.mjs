import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const transport = require('./timesheet-clock-transport.js');

const form = {
  action: 'https://formsubmit.co/ajax/accounts@example.test',
  target: 'original-target',
  children: [],
  querySelector(selector) {
    return this.children.find((child) => selector === 'input[name="_next"]' && child.name === '_next') || null;
  },
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  },
  removeChild(child) {
    this.children = this.children.filter((current) => current !== child);
    child.parentNode = null;
    return child;
  }
};

const listeners = new Map();
const frame = {
  name: 'timesheet-frame',
  contentWindow: { location: { href: 'https://formsubmit.co/success' } },
  addEventListener(type, listener) { listeners.set(type, listener); },
  removeEventListener(type) { listeners.delete(type); }
};

const nativeForm = { prototype: { submit() {} } };
const result = await transport.submitNativeForm(form, frame, {
  location: { protocol: 'https:', origin: 'https://gmt.example', href: 'https://gmt.example/portal/' },
  document: { createElement: () => ({}) },
  htmlForm: nativeForm,
  timeoutMs: 1
});

assert.equal(result.success, false, 'a timeout must not be reported as confirmed success');
assert.equal(result.uncertain, true, 'a missing same-origin redirect leaves delivery unconfirmed');
assert.equal(result.transport, 'native-form');
assert.match(result.message, /did not receive.*confirmation|could not be confirmed/i);
assert.equal(form.action, 'https://formsubmit.co/ajax/accounts@example.test', 'native delivery restores the original form action');
assert.equal(form.target, 'original-target', 'native delivery restores the original form target');
assert.equal(form.children.length, 0, 'native delivery removes the temporary redirect field');
assert.equal(listeners.size, 0, 'native delivery removes its iframe listeners after timeout');

console.log('Clock native transport timeout is reported as unconfirmed: PASS');
