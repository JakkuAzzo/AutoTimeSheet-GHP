export function privateTimesheetWorkbookStore(DB,now){
  return {
    async getMarker(employeeId,payMonth){
      return await DB.prepare(`SELECT employee_oid AS employeeId,pay_month AS payMonth,employee_folder_id AS rootId,
        file_name AS fileName,state,month_folder_id AS folderId,workbook_id AS workbookId
        FROM private_timesheet_workbooks WHERE employee_oid=? AND pay_month=?`).bind(employeeId,payMonth).first() || null;
    },
    async reserve(value){
      const at=now();
      const result=await DB.prepare(`INSERT INTO private_timesheet_workbooks
        (employee_oid,pay_month,employee_folder_id,file_name,state,created_at,updated_at)
        VALUES (?,?,?,?,'reserved',?,?) ON CONFLICT(employee_oid,pay_month) DO NOTHING`)
        .bind(value.employeeId,value.payMonth,value.rootId,value.fileName,at,at).run();
      return Number(result?.meta?.changes||0)===1;
    },
    async markReady(value){
      const result=await DB.prepare(`UPDATE private_timesheet_workbooks SET state='ready',month_folder_id=?,workbook_id=?,updated_at=?
        WHERE employee_oid=? AND pay_month=? AND employee_folder_id=? AND file_name=? AND state='reserved'`)
        .bind(value.folderId,value.workbookId,now(),value.employeeId,value.payMonth,value.rootId,value.fileName).run();
      if(Number(result?.meta?.changes||0)!==1)throw new Error('The reserved workbook identity changed');
    }
  };
}
