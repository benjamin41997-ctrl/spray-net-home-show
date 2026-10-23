-- Additive: existing leads, access tokens, bookings and media are preserved.
CREATE TABLE IF NOT EXISTS lead_visits (
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  visit_id TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  PRIMARY KEY (lead_id, visit_id)
);
CREATE INDEX IF NOT EXISTS lead_visits_latest ON lead_visits(lead_id, accessed_at);
CREATE TABLE IF NOT EXISTS app_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_metadata(key,value)
  VALUES ('activity_tracking_started_at',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
