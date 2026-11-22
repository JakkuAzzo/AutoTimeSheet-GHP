// Validates only the consistency of prepared attachments against the supplied
// structured source. This does not establish source completeness, provider
// permissions, or authority to send a held correction.
import * as XLSX from 'xlsx';
import {preflightWorkbookBytes} from './timesheet-workbook-readback.js';

const invalid=()=>new Error('Prepared workbook attachments do not match their source');
const columns=['Date','Start','Finish','Break','Absence','Total hours','Notes','Source basic hours','Source overtime 1.5× hours','Source overtime 2× hours'];
const weeklyColumns=['Week Start','Week End','Total hours'];
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const minutes=value=>Number.isInteger(value)&&value>=0&&value<=1440;
const hours=value=>typeof value==='number'?`${Math.floor(value/60)}h ${String(value%60).padStart(2,'0')}m`:'';
function bounds(value){const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);const start=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+6);return {start,end:d.toISOString().slice(0,10)};}
function matrices(source){
 if(!source||source.schemaVersion!==3||!date(source.cycleStart)||!date(source.cycleEnd)||source.cycleStart>source.cycleEnd||
  Date.parse(source.cycleEnd)-Date.parse(source.cycleStart)>62*86400000||!Array.isArray(source.rows)||!source.rows.length||source.rows.length>62)throw invalid();
 const weeks=new Map(),first=bounds(source.cycleStart).start,last=bounds(source.cycleEnd).start;
 for(let day=first;day<=last;){const b=bounds(day);weeks.set(day,{end:b.end,total:0,known:false});const next=new Date(day+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+7);day=next.toISOString().slice(0,10);}
 const daily=[columns];let previous='',total=0,known=false;
 for(const row of source.rows){
  if(!row||!date(row.date)||row.date<source.cycleStart||row.date>source.cycleEnd||row.date<=previous||
   !['startTime','finishTime','absenceReason','note'].every(k=>typeof row[k]==='string'&&row[k].length<=5000)||
   !(row.breakMinutes===''||minutes(row.breakMinutes))||!(row.totalMinutes===''||minutes(row.totalMinutes))||
   !['sourceBasicMinutes','sourceOt15Minutes','sourceOt20Minutes'].every(k=>row[k]===null||minutes(row[k])))throw invalid();
  previous=row.date;const week=weeks.get(bounds(row.date).start);if(!week)throw invalid();
  if(minutes(row.totalMinutes)){week.total+=row.totalMinutes;week.known=true;total+=row.totalMinutes;known=true;}
  daily.push([row.date,row.startTime,row.finishTime,row.breakMinutes,row.absenceReason,hours(row.totalMinutes),row.note,hours(row.sourceBasicMinutes),hours(row.sourceOt15Minutes),hours(row.sourceOt20Minutes)]);
 }
 daily.push(['Pay month total','','','','',known?hours(total):'','','','','']);
 const weekly=[weeklyColumns,...Array.from(weeks,([start,w])=>[start,w.end,w.known?hours(w.total):'']),['Month total','',known?hours(total):'']];
 return {daily,weekly};
}
function checkSheet(sheet,expected){
 if(!sheet||typeof sheet['!ref']!=='string'||sheet['!rows']?.some(r=>r?.hidden)||sheet['!cols']?.some(c=>c?.hidden))throw invalid();
 const range=XLSX.utils.decode_range(sheet['!ref']);
 if(range.s.r!==0||range.s.c!==0||range.e.r!==expected.length-1||range.e.c!==expected[0].length-1)throw invalid();
 for(const [address,cell] of Object.entries(sheet)){
  if(address.startsWith('!'))continue;
  if(!/^[A-Z]+[1-9][0-9]*$/.test(address)||cell.f!==undefined||cell.F!==undefined||cell.l||cell.c)throw invalid();
  const pos=XLSX.utils.decode_cell(address);if(pos.r>=expected.length||pos.c>=expected[0].length)throw invalid();
 }
 for(let r=0;r<expected.length;r++)for(let c=0;c<expected[r].length;c++){
  const cell=sheet[XLSX.utils.encode_cell({r,c})],actual=cell?.v??'';
  if(cell?.t==='e'||actual!==expected[r][c])throw invalid();
 }
}
export async function verifyPreparedAttachments(source,{xlsx,csv}={}){
 const expected=matrices(source);
 if(!(xlsx instanceof Uint8Array)||xlsx.length<4||xlsx.length>1024*1024||!(csv instanceof Uint8Array)||csv.length>1024*1024)throw invalid();
 let csvText;try{csvText=new TextDecoder('utf-8',{fatal:true}).decode(csv);}catch(_){throw invalid();}
 const canonical=expected.daily.map(row=>row.map(value=>'"'+String(value??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
 if(csvText!==canonical)throw invalid();
 await preflightWorkbookBytes(xlsx);
 let book;try{book=XLSX.read(xlsx,{type:'array',cellFormula:true,cellDates:false,cellStyles:true,bookVBA:true,nodim:true});}catch(_){throw invalid();}
 if(book.vbaraw||book.Workbook?.WBProps?.date1904||book.SheetNames.length!==2||book.SheetNames[0]!=='Daily Entries'||book.SheetNames[1]!=='Weekly Totals'||book.Workbook?.Sheets?.some(sheet=>sheet.Hidden))throw invalid();
 checkSheet(book.Sheets['Daily Entries'],expected.daily);checkSheet(book.Sheets['Weekly Totals'],expected.weekly);
 return true;
}
