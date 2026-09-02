-- Lets reconcile skip files that haven't changed since the last scan,
-- and re-scan ones that have (e.g. a retagged file re-uploaded to the same key).
ALTER TABLE tracks ADD COLUMN r2_etag TEXT;

-- Tracks progress of a manual R2 <-> D1 reconciliation run across multiple
-- bounded steps, so it can be resumed/polled from a browser without needing
-- one huge request that would blow the Workers free-tier CPU budget.
CREATE TABLE IF NOT EXISTS reconcile_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_cursor TEXT,
  scanned INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
