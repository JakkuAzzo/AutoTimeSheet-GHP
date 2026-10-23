import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../tools/invoices.js', import.meta.url), 'utf8');
const start = source.indexOf('  function recordOptionLabel(record) {');
const end = source.indexOf('  function applyRecordPage(', start);
assert.notEqual(start, -1, 'invoice record option renderer exists');
assert.notEqual(end, -1, 'invoice record option renderer has a stable boundary');

function decodeHtml(value) {
  return String(value).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

const recordSelect = {
  _options: [
    { value: 'estimate-104', textContent: 'Estimate · EST-104 · North & South · £1,200', selected: true },
    { value: 'job-card-205', textContent: 'Job card · JOB-205 · OCR candidate', selected: true }
  ],
  get selectedOptions() { return this._options.filter((option) => option.selected); },
  get options() { return this._options; },
  set innerHTML(value) {
    this.html = value;
    this._options = Array.from(value.matchAll(/<option value="([^"]*)"( selected)?>(.*?)<\/option>/g), (match) => ({
      value: decodeHtml(match[1]),
      textContent: decodeHtml(match[3]),
      selected: Boolean(match[2])
    }));
  }
};
const context = {
  recordSelect,
  recordRows: [{ record_id: 'new-page-record', kind: 'job-cards', title: 'New page record' }],
  recordHasMore: false,
  recordLoadMore: { hidden: false },
  safe(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
};
vm.runInNewContext(`${source.slice(start, end)}\nthis.renderRecordOptions = renderRecordOptions;`, context);

const expectedLabels = new Map([
  ['estimate-104', 'Estimate · EST-104 · North & South · £1,200'],
  ['job-card-205', 'Job card · JOB-205 · OCR candidate']
]);
for (let searchPage = 0; searchPage < 3; searchPage += 1) {
  context.recordRows = [{ record_id: `new-page-${searchPage}`, kind: 'job-cards', title: `New page ${searchPage}` }];
  context.renderRecordOptions();
  for (const option of recordSelect.selectedOptions) {
    assert.equal(option.textContent, expectedLabels.get(option.value), `${option.value} keeps its original label after search page ${searchPage + 1}`);
  }
}

console.log('Xero invoice selected-record labels: PASS');
