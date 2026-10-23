-- Preserve a bounded private-media cleanup manifest after deleting its lead.
-- No customer contact details or access tokens are stored in this queue.
CREATE TABLE IF NOT EXISTS lead_media_cleanup (
  lead_id TEXT PRIMARY KEY,
  object_keys TEXT NOT NULL,
  requested_at TEXT NOT NULL
);
