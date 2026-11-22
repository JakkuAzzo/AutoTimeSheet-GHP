'use strict';
importScripts('../vendor/xlsx-0.20.3.min.js');
self.onmessage = function (event) {
  try {
    const {content,format}=event.data;
    const wb=XLSX.read(content,format==='csv'?{type:'string'}:{type:'array',cellDates:true,cellNF:true});
    if(wb.SheetNames.length>100)throw new Error('Spreadsheet has too many sheets.');
    let totalCells=0;
    for(const name of wb.SheetNames){
      const ref=wb.Sheets[name]['!ref'];if(!ref)continue;
      const range=XLSX.utils.decode_range(ref),rows=range.e.r-range.s.r+1,cols=range.e.c-range.s.c+1;
      if(rows>10000 || cols>256 || rows<0 || cols<0 || (totalCells+=rows*cols)>250000)throw new Error('Spreadsheet exceeds the row or cell limit.');
    }
    const preferred=['All','Daily Entries','Daily entries','Timesheet','Timesheets'].filter(name=>wb.SheetNames.includes(name));
    const names=format==='csv' ? wb.SheetNames.slice(0,1) : preferred.length ? preferred : wb.SheetNames;
    const metaName=['Totals','Summary','Notes'].find(name=>wb.SheetNames.includes(name));
    // Excel stores a duration as a fraction of a day. With cellDates enabled,
    // SheetJS returns time-formatted durations as Date objects; the importer
    // must not interpret their numeric fraction as decimal hours. Only accept
    // unambiguous minute-precision duration formats in named rate columns.
    function rateHeader(value){
      const key=String(value??'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}' -]/gu,' ').replace(/\s+/g,' ').trim().replace(/[^a-z0-9]/g,'');
      return /^(?:source)?(?:(?:paid)?basic(?:hours?|hrs?)?|(?:ot|overtime)x?15(?:hours?|hrs?)?|(?:ot|overtime)x?(?:20|2)(?:hours?|hrs?)?)$/.test(key);
    }
    function rowsFor(name){
      const sheet=wb.Sheets[name],ref=sheet['!ref'];
      if(format!=='csv'&&ref){
        const range=XLSX.utils.decode_range(ref);
        for(let col=range.s.c;col<=range.e.c;col++){
          const header=sheet[XLSX.utils.encode_cell({r:range.s.r,c:col})];
          if(!header||!rateHeader(header.v))continue;
          for(let row=range.s.r+1;row<=range.e.r;row++){
            const address=XLSX.utils.encode_cell({r:row,c:col}),cell=sheet[address];
            const safeFormat=/^\s*(?:(?:\[h\]|h|hh):mm|\[h\]"h "mm"m")\s*$/i.test(String(cell?.z||''));
            const safeDisplay=/^(?:\d+:\d{2}|\d+h\s*\d{1,2}m)$/.test(String(cell?.w||''));
            if(!cell||cell.t!=='d'||!(cell.v instanceof Date)||!safeFormat||!safeDisplay||
              cell.v.getUTCSeconds()!==0||cell.v.getUTCMilliseconds()!==0)continue;
            sheet[address]={t:'s',v:cell.w};
          }
        }
      }
      return XLSX.utils.sheet_to_json(sheet,{defval:''});
    }
    self.postMessage({sheets:names.map(name=>({name,rows:rowsFor(name)})),metaRows:metaName?XLSX.utils.sheet_to_json(wb.Sheets[metaName],{header:1,defval:''}):[],appGenerated:!!wb.Sheets.All});
  } catch(error) { self.postMessage({error:String(error?.message || 'Spreadsheet could not be read.')}); }
};
