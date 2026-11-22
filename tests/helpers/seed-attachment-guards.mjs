// Fixtures that begin after queueing need the same complete evidence as a
// real guarded queue transaction. The tests never use this with live data.
export function seedAttachmentGuards(sql) {
  const records=sql.prepare('SELECT DISTINCT record_id FROM record_attachments').all();
  const read=sql.prepare('SELECT field_name,file_name,content_type,content_base64,size_bytes FROM record_attachments WHERE record_id=?');
  const insert=sql.prepare('INSERT INTO timesheet_queue_attachment_guards(record_id,manifest_json) VALUES(?,?) ON CONFLICT(record_id) DO UPDATE SET manifest_json=excluded.manifest_json');
  for (const {record_id} of records) {
    const manifest=read.all(record_id).map(row=>({fieldName:row.field_name,fileName:row.file_name,contentType:row.content_type,contentBase64:row.content_base64,sizeBytes:row.size_bytes}));
    insert.run(record_id,JSON.stringify(manifest));
  }
}
