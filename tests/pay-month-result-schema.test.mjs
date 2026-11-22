import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRegisterWorkbook,runRegisterOfficeScript} from './helpers/pay-month-register-office-script.mjs';

const schema=JSON.parse(readFileSync(new URL('../power-platform/pay-month-register-result.schema.json',import.meta.url),'utf8'));
const recordId='schema-fixture';
const source={mode:'replace-pay-month',recordId,employeeName:'Fictional',payMonth:'2026-10',rows:[
  {recordId:`${recordId}|2026-10-01`,date:'2026-10-01',start:'09:00',finish:'12:00',breakMinutes:0,note:'Fictional'},
  {recordId:`${recordId}|2026-10-02`,date:'2026-10-02',start:'09:00',finish:'12:00',breakMinutes:'',note:'Break not recorded'}
]};
const output=JSON.parse(JSON.stringify(runRegisterOfficeScript(createRegisterWorkbook('Fictional','2026-10'),source)));
assert.equal(typeof output.verifiedRowsJson,'string','full-row evidence is returned as JSON text to avoid unsupported nullable Office Script return types');
const proofRows=JSON.parse(output.verifiedRowsJson);
assert.equal(proofRows[0].breakMinutes,0,'a recorded zero break remains zero');
assert.equal(proofRows[1].breakMinutes,null,'an unrecorded break remains null');
function check(value,rule){
  const types=Array.isArray(rule.type)?rule.type:[rule.type];
  const actual=value===null?'null':Array.isArray(value)?'array':Number.isInteger(value)?'integer':typeof value;
  if(!types.includes(actual))return false;
  if(actual==='object')return (rule.required||[]).every(key=>Object.hasOwn(value,key)) && Object.entries(rule.properties||{}).every(([key,child])=>!Object.hasOwn(value,key)||check(value[key],child));
  if(actual==='array')return value.every(item=>check(item,rule.items));
  return true;
}
assert.equal(check(output,schema),true,'the actual register output and unknown-break nulls fit the proposed flow schema');
const missing=structuredClone(output);delete missing.verifiedRowsJson;
assert.equal(check(missing,schema),false,'the flow schema requires the full-row evidence field');
assert.deepEqual(JSON.parse(output.verifiedRecordIdsJson),output.verifiedRecordIds,'both serialized proof fields identify the same rows');
const connector=JSON.parse(readFileSync(new URL('../power-platform/synthetic-delivery-connector.openapi.json',import.meta.url),'utf8'));
const properties=connector.paths['/api/integrations/timesheet-delivery-receipts'].post.parameters[0].schema.properties;
assert.equal(properties.verifiedRowsJson.type,'string','serialized proof remains available for nullable values');
for(const key of ['sourceBasicMinutes','sourceOt15Minutes','sourceOt20Minutes'])assert.deepEqual(properties.verifiedRows.items.properties[key],{type:'integer','x-nullable':true},'structured preview preserves nullable source rates');
console.log('PASS: proposed flow schema covers actual full-row and unknown-break Office Script output');
