import test from 'node:test';
import assert from 'node:assert/strict';
import * as fixtureModule from '../cloudflare-worker/src/synthetic-portal-fixture.js';
import {syntheticAttachmentExample} from './helpers/synthetic-attachments.mjs';

test('only exact fictional workbook, CSV and source data match the saved correction',async()=>{
  assert.equal(typeof fixtureModule.validateSyntheticAttachments,'function');
  const {body,payload}=syntheticAttachmentExample();
  assert.equal(await fixtureModule.validateSyntheticAttachments(body,payload),true);
  const changed=fn=>{const copy=structuredClone(body);fn(copy);return copy;};
  const flipByte=(item,index)=>{const bytes=Buffer.from(item.contentBase64,'base64');bytes[index]^=1;item.contentBase64=bytes.toString('base64');};
  for(const invalid of [
    changed(x=>x.attachments.pop()),changed(x=>x.attachments.push(x.attachments[0])),
    changed(x=>x.attachments[0].contentBase64=Buffer.from('other workbook').toString('base64')),
    changed(x=>x.attachments[1].contentBase64=Buffer.from('private data').toString('base64')),
    changed(x=>x.attachments[2].contentBase64=Buffer.from('{}').toString('base64')),
    changed(x=>flipByte(x.attachments[0],100)),changed(x=>flipByte(x.attachments[1],10)),changed(x=>flipByte(x.attachments[2],10)),
    changed(x=>x.attachments[0].fileName='other.xlsx'),changed(x=>x.attachments[1].sizeBytes++),
    changed(x=>x.attachments[0].contentBase64+='!'),changed(x=>x.extra='private data'),
    changed(x=>x.attachments[0].extra='private data')
  ]) assert.equal(await fixtureModule.validateSyntheticAttachments(invalid,payload),false);
  const badPayload=structuredClone(payload);badPayload.rows[1].lunchMinutes=0;
  assert.equal(await fixtureModule.validateSyntheticAttachments(body,badPayload),false);
});
