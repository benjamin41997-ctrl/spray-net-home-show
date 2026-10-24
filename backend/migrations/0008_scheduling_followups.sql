CREATE TABLE IF NOT EXISTS scheduling_followups (
  lead_id TEXT PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  requested_at TEXT NOT NULL
);
