import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// Literal examples returned by the fictional Excel Online probe. The sheet
// adapter models the workbook API; both guards below are the actual scripts.
const fixtures = [
  {minutes: 440, finish: '16:20', literal: '0.305555555555555'},
  {minutes: 375, finish: '15:15', literal: '0.260416666666666'},
];
function dailySheet(fixture, formula) {
  const rows = [
    ['Date','Start','Finish','Break','Absence','Total hours','Notes'],
    ['2026-10-05','09:00',fixture.finish,0,'NA',fixture.minutes / 1440,'']
  ];
  return {
    getUsedRange: () => ({getRowIndex:()=>0,getRowCount:()=>2,getColumnIndex:()=>0,getColumnCount:()=>7}),
    getRange(ref) {
      const m=/^([A-Z])(\d+):([A-Z])(\d+)$/.exec(ref);
      if (!m) throw Error(`Unexpected range ${ref}`);
      const r0=Number(m[2])-1,r1=Number(m[4])-1,c0=m[1].charCodeAt(0)-65,c1=m[3].charCodeAt(0)-65;
      const values=()=>Array.from({length:r1-r0+1},(_,r)=>Array.from({length:c1-c0+1},(_,c)=>rows[r0+r]?.[c0+c]??''));
      return {getValues:values,getFormulas:()=>{
        const result=values();
        if (r0<=1 && r1>=1 && c0<=5 && c1>=5) result[1-r0][5-c0]=formula;
        return result;
      }};
    }
  };
}
for (const file of ['upsert-pay-month-register.ts','verify-pay-month-register-readonly.ts']) {
  const source=stripTypeScriptTypes(readFileSync(new URL(`../power-platform/office-scripts/${file}`,import.meta.url),'utf8'));
  const context={}; vm.runInNewContext(source+'\nthis.readRows=currentRows;',context);
  for (const fixture of fixtures) test(`${file} accepts Excel's returned ${fixture.minutes}-minute formula`,()=>{
    const formula=`=IF(E2<>"NA",0,IF(OR(B2="",C2="",D2=""),${fixture.literal},MOD(C2-B2,1)-D2/1440))`;
    assert.equal(context.readRows(dailySheet(fixture,formula),'2026-10')[0].totalMinutes,fixture.minutes);
    assert.throws(()=>context.readRows(dailySheet(fixture,formula.replace('MOD(C2-B2,1)','MOD(C2-B2,2)')),'2026-10'),/formula.*review/i);
    assert.throws(()=>context.readRows(dailySheet(fixture,formula.replace(fixture.literal,'0.9')),'2026-10'),/formula.*review/i);
  });
}
