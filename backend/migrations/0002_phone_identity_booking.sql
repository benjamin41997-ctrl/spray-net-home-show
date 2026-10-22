-- Apply ONCE to an existing pre-phone-identity database, during a brief write pause.
-- Fresh databases use backend/schema.sql instead; never apply both initialization and this migration.
-- Back up the database using the approved account tooling first. Do not export lead PII to logs.
-- No table is dropped/rebuilt, so IDs, token hashes, existing media, and their foreign keys survive.
ALTER TABLE leads RENAME COLUMN email_normalized TO lead_identity;
-- Existing duplicate-phone leads must all survive; each receives a unique legacy identity.
UPDATE leads SET lead_identity = 'legacy:' || id;
ALTER TABLE leads ADD COLUMN phone_normalized TEXT NOT NULL DEFAULT '';
ALTER TABLE leads ADD COLUMN capture_mode TEXT NOT NULL DEFAULT 'unknown'
  CHECK (capture_mode IN ('mobile', 'tablet', 'unknown'));
-- Match runtime normalization even if old phone values contain Unicode whitespace.
WITH RECURSIVE phone_digits(lead_id, rest, digits) AS (
  SELECT id, phone, '' FROM leads
  UNION ALL
  SELECT lead_id, SUBSTR(rest, 2), digits || CASE
    WHEN SUBSTR(rest, 1, 1) GLOB '[0-9]' THEN SUBSTR(rest, 1, 1) ELSE '' END
  FROM phone_digits WHERE rest <> ''
)
UPDATE leads SET phone_normalized = (
  SELECT digits FROM phone_digits WHERE lead_id = leads.id AND rest = ''
);
UPDATE leads SET phone_normalized = '1' || phone_normalized WHERE LENGTH(phone_normalized) = 10;
CREATE INDEX IF NOT EXISTS leads_phone_event ON leads(phone_normalized, event_id);

CREATE TABLE IF NOT EXISTS consultation_bookings (
  lead_id TEXT PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  calendar_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled')),
  graph_event_id TEXT,
  transaction_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  request_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  attendee_email TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS consultation_calendar_status_time
  ON consultation_bookings(calendar_key, status, start_at, end_at);
CREATE TABLE IF NOT EXISTS booking_calendar_locks (
  calendar_key TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS booking_tokens (
  calendar_key TEXT PRIMARY KEY,
  refresh_cipher TEXT NOT NULL,
  access_cipher TEXT,
  expires_at INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
