#!/usr/bin/env python3
"""Rehearse migrations in an in-memory SQLite clone of a read-only schema export.

The export must contain sqlite_master objects only. No production rows are
loaded or written. SQLite is not a substitute for a Cloudflare D1 rehearsal.
"""
import argparse
import glob
import json
from pathlib import Path
import sqlite3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", required=True, help="Read-only schema metadata JSON")
    parser.add_argument("--migrations", default=str(Path(__file__).resolve().parents[1] / "cloudflare-worker/migrations"))
    args = parser.parse_args()
    document = json.loads(Path(args.schema).read_text())
    objects = document["objects"]
    if not isinstance(objects, list) or not any(x.get("name") == "records" for x in objects):
        raise ValueError("Schema inventory is incomplete")

    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys=ON")
    for kind in ("table", "index", "trigger"):
        for obj in objects:
            name = obj["name"]
            if obj["type"] != kind or name in ("sqlite_sequence", "_cf_KV"):
                continue
            # SQLite creates these FTS5 shadow tables when the virtual table is
            # created; recreating their metadata a second time would fail.
            if kind == "table" and name.startswith("job_card_archive_fts_"):
                continue
            try:
                db.execute(obj["sql"])
            except sqlite3.Error as error:
                raise RuntimeError(f"Could not clone {kind} {name}: {error}") from error

    for status, attempts in (("queued", 0), ("skipped", 0), ("sending", 1), ("sent", 1), ("failed", 1), ("failed", 0)):
        record_id = f"fictional-{status}-{attempts}"
        db.execute("""INSERT INTO records(record_id,owner_oid,owner_upn,employee_name,kind,action,status,submitted_at,updated_at,payload_json)
          VALUES(?,?,?,?,'timesheets','pay_month_correction','Queued for Accounts','2026-11-01','2026-11-01','{}')""",
                   (record_id, f"fixture-{record_id}", f"{record_id}@example.invalid", "Fictional"))
        db.execute("""INSERT INTO dispatch_queue(record_id,status,queued_at,updated_at,attempts,next_attempt_at)
          VALUES(?,?,'2026-11-01','2026-11-01',?,'2026-11-01')""", (record_id, status, attempts))
        db.execute("""INSERT INTO record_attachments(record_id,field_name,file_name,content_type,content_base64,size_bytes,created_at)
          VALUES(?,'attachment_csv','fictional.csv','text/csv','YWJj',3,'2026-11-01')""", (record_id,))
    db.commit()
    before_records = db.execute("SELECT * FROM records ORDER BY record_id").fetchall()
    before_attachments = db.execute("SELECT * FROM record_attachments ORDER BY record_id,field_name").fetchall()
    before_queue = db.execute("SELECT * FROM dispatch_queue ORDER BY record_id").fetchall()
    migrations = sorted(Path(p) for p in glob.glob(str(Path(args.migrations) / "*.sql")) if int(Path(p).name[:4]) >= 18)
    if not migrations:
        raise ValueError("No pending migrations found")
    for migration in migrations:
        try:
            db.executescript(migration.read_text())
        except sqlite3.Error as error:
            raise RuntimeError(f"Local rehearsal failed at {migration.name}: {error}") from error

    assert db.execute("SELECT * FROM records ORDER BY record_id").fetchall() == before_records
    assert db.execute("SELECT * FROM record_attachments ORDER BY record_id,field_name").fetchall() == before_attachments
    after_queue = db.execute("SELECT * FROM dispatch_queue ORDER BY record_id").fetchall()
    expected_queue = [tuple("uncertain" if i == 1 and row[0] == "fictional-failed-1" else value
                            for i, value in enumerate(row)) for row in before_queue]
    assert after_queue == expected_queue
    assert not db.execute("PRAGMA foreign_key_check").fetchall()

    def insert_review(record_id, revision):
        db.execute("""INSERT INTO timesheet_ownership_reviews(record_id,record_revision,payload_sha256,subject_oid,reviewer_oid,evidence_reference,reviewed_at)
          VALUES(?,?,?,'fictional-subject','fictional-reviewer','fictional evidence','2026-11-01')""", (record_id, revision, "a" * 64))

    def must_hold(record_id, revision):
        try:
            insert_review(record_id, revision)
        except sqlite3.IntegrityError:
            return
        raise AssertionError(f"The fictional review unexpectedly succeeded for {record_id}")

    for state in ("sending-1", "sent-1", "failed-1"):
        held_id = "fictional-" + state
        held_revision = db.execute("SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?", (held_id,)).fetchone()[0]
        must_hold(held_id, held_revision)

    record_id = "fictional-queued-0"
    revision = db.execute("SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?", (record_id,)).fetchone()[0]
    insert_review(record_id, revision)
    must_hold(record_id, revision)  # duplicate active decision
    review = db.execute("SELECT review_id FROM timesheet_ownership_reviews WHERE record_id=?", (record_id,)).fetchone()[0]
    assert db.execute("SELECT event_type FROM timesheet_ownership_review_events WHERE review_id=? ORDER BY event_id", (review,)).fetchall() == [("adopted",)]
    db.execute("UPDATE records SET payload_json=? WHERE record_id=?", ('{"fictional":true}', record_id))
    assert db.execute("SELECT event_type FROM timesheet_ownership_review_events WHERE review_id=? ORDER BY event_id", (review,)).fetchall() == [("adopted",), ("invalidated",)]
    assert db.execute("SELECT revision FROM timesheet_review_record_revisions WHERE record_id=?", (record_id,)).fetchone()[0] == revision + 1
    must_hold(record_id, revision)  # stale decision after the edit
    assert db.execute("SELECT owner_oid,owner_upn FROM records WHERE record_id=?", (record_id,)).fetchone() == ("fixture-" + record_id, record_id + "@example.invalid")
    print(json.dumps({"schema_export_time": document.get("at"), "migrations_rehearsed": len(migrations),
                      "fictional_records_and_attachments_preserved": True,
                      "queue_preserved_except_expected_attempted_failure_hold": True,
                      "fictional_review_invalidated_on_change": True, "stale_duplicate_and_inflight_reviews_held": True,
                      "foreign_key_violations": 0, "provider_or_real_data_modified": False}))


if __name__ == "__main__":
    main()
