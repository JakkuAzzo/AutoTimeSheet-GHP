import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initialisePrototype,selectGeneration,recordVerifiedCopy,publishVerifiedCopy,readPointer} from '../tools/prototypes/timesheet-publication-guard.mjs';

const a='a'.repeat(64),b='b'.repeat(64),fileA='fictional-copy-a',fileB='fictional-copy-b';
function fixture(){const db=new DatabaseSync(':memory:');initialisePrototype(db);return db;}
test('a later publication cannot be replaced by an earlier completed copy',()=>{
 const db=fixture();selectGeneration(db,'fictional',0,a);recordVerifiedCopy(db,'fictional',1,a,fileA,'etag-a');
 selectGeneration(db,'fictional',1,b);recordVerifiedCopy(db,'fictional',2,b,fileB,'etag-b');
 assert.equal(publishVerifiedCopy(db,'fictional',2,b,fileB,'etag-b'),true);
 assert.equal(publishVerifiedCopy(db,'fictional',1,a,fileA,'etag-a'),false);
 assert.deepEqual({...readPointer(db,'fictional')},{revision:2,generation:b,item_id:fileB,etag:'etag-b'});db.close();
});
test('a verified copy cannot publish after a new source was selected',()=>{
 const db=fixture();selectGeneration(db,'fictional',0,a);recordVerifiedCopy(db,'fictional',1,a,fileA,'etag-a');
 selectGeneration(db,'fictional',1,b);assert.equal(publishVerifiedCopy(db,'fictional',1,a,fileA,'etag-a'),false);
 assert.equal(readPointer(db,'fictional'),null);db.close();
});
test('publication binds exact generation, copy and version and is idempotent only for that copy',()=>{
 const db=fixture();selectGeneration(db,'fictional',0,a);recordVerifiedCopy(db,'fictional',1,a,fileA,'etag-a');
 assert.equal(publishVerifiedCopy(db,'fictional',1,a,fileA,'etag-wrong'),false);
 assert.equal(publishVerifiedCopy(db,'fictional',1,b,fileA,'etag-a'),false);
 assert.equal(publishVerifiedCopy(db,'fictional',1,a,fileA,'etag-a'),true);
 assert.equal(publishVerifiedCopy(db,'fictional',1,a,fileA,'etag-a'),true);
 assert.throws(()=>recordVerifiedCopy(db,'fictional',1,a,'different-copy','etag-other'));
 assert.equal(publishVerifiedCopy(db,'fictional',1,a,'different-copy','etag-other'),false);db.close();
});
test('a stale source selector cannot advance or reset a newer revision',()=>{
 const db=fixture();assert.equal(selectGeneration(db,'fictional',0,a),1);assert.equal(selectGeneration(db,'fictional',1,b),2);
 assert.equal(selectGeneration(db,'fictional',1,a),null);db.close();
});
test('the old pointer is held while a newer source revision is waiting',()=>{
 const db=fixture();selectGeneration(db,'fictional',0,a);recordVerifiedCopy(db,'fictional',1,a,fileA,'etag-a');
 assert.equal(publishVerifiedCopy(db,'fictional',1,a,fileA,'etag-a'),true);
 selectGeneration(db,'fictional',1,b);assert.equal(readPointer(db,'fictional'),null);db.close();
});
test('retrying the same verification after a lost response does not create another candidate',()=>{
 const db=fixture();selectGeneration(db,'fictional',0,a);
 recordVerifiedCopy(db,'fictional',1,a,fileA,'etag-a');recordVerifiedCopy(db,'fictional',1,a,fileA,'etag-a');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM verified_copy').get().n,1);
 assert.throws(()=>recordVerifiedCopy(db,'fictional',1,a,fileA,'etag-changed'));db.close();
});
