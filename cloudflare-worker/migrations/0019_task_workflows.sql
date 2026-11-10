CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  requester_oid TEXT NOT NULL,
  requester_upn TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  title TEXT NOT NULL,
  job_reference TEXT NOT NULL DEFAULT '',
  requested_assignee_upn TEXT NOT NULL DEFAULT '',
  assignee_upn TEXT NOT NULL DEFAULT '',
  due_date TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Urgent')),
  status TEXT NOT NULL CHECK (status IN ('Pending approval', 'To-Do', 'In-Progress', 'Completed', 'Cancelled')),
  sharepoint_item_id TEXT NOT NULL DEFAULT '',
  outlook_event_id TEXT NOT NULL DEFAULT '',
  calendar_sync_status TEXT NOT NULL DEFAULT 'pending',
  calendar_sync_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_requester ON tasks(requester_upn, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_upn, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks(status, due_date);

CREATE TABLE IF NOT EXISTS task_workflow_outbox (
  action_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  signature TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'failed', 'synced')),
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  response_json TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_outbox_pending ON task_workflow_outbox(actor_oid, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_outbox_task ON task_workflow_outbox(task_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS task_activity (
  activity_id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL UNIQUE,
  task_id TEXT NOT NULL,
  actor_oid TEXT NOT NULL,
  actor_upn TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  old_status TEXT NOT NULL DEFAULT '',
  new_status TEXT NOT NULL DEFAULT '',
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id, created_at DESC, activity_id DESC);
