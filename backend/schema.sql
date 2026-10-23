PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  request_key TEXT,
  input_hash TEXT,
  lead_identity TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  event_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  service TEXT NOT NULL,
  capture_mode TEXT NOT NULL DEFAULT 'mobile' CHECK (capture_mode IN ('mobile', 'tablet', 'unknown')),
  consultation_preference TEXT NOT NULL DEFAULT 'contact_me'
    CHECK (consultation_preference IN ('contact_me', 'schedule_now')),
  timeline TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  event_label TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  remaining_renders INTEGER NOT NULL CHECK (remaining_renders >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (lead_identity, event_id)
);
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
CREATE TABLE IF NOT EXISTS confirmation_drafts (
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  booking_transaction_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
  drafted_at TEXT NOT NULL,
  PRIMARY KEY (lead_id,booking_transaction_id,channel)
);
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
CREATE TABLE IF NOT EXISTS booking_time_blocks (
  id TEXT PRIMARY KEY,
  calendar_key TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_blocks_calendar_time
  ON booking_time_blocks(calendar_key, start_at, end_at);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (lead_id, content_hash)
);
CREATE INDEX IF NOT EXISTS photos_lead ON photos(lead_id);
CREATE TRIGGER IF NOT EXISTS photos_limit BEFORE INSERT ON photos BEGIN
  SELECT CASE WHEN (SELECT COUNT(*) FROM photos WHERE lead_id = NEW.lead_id) >= 8
    THEN RAISE(ABORT, 'PHOTO_LIMIT') END;
END;

CREATE TABLE IF NOT EXISTS daily_attempts (
  day TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS renders (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  photo_id TEXT NOT NULL REFERENCES photos(id),
  request_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  day TEXT NOT NULL,
  daily_limit INTEGER NOT NULL,
  color_name TEXT NOT NULL,
  color_hex TEXT NOT NULL,
  surface TEXT NOT NULL,
  object_key TEXT,
  mime_type TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (lead_id, request_key)
);
CREATE INDEX IF NOT EXISTS renders_lead ON renders(lead_id);
CREATE INDEX IF NOT EXISTS renders_pending ON renders(status, updated_at);

-- A single INSERT and its triggers reserve BOTH limits atomically. A failed
-- INSERT rolls back all changes, including under concurrent Worker requests.
CREATE TRIGGER IF NOT EXISTS render_limits BEFORE INSERT ON renders BEGIN
  SELECT CASE WHEN NEW.status <> 'pending' THEN RAISE(ABORT, 'INVALID_STATUS') END;
  SELECT CASE WHEN (SELECT remaining_renders FROM leads WHERE id = NEW.lead_id) <= 0
    THEN RAISE(ABORT, 'NO_CREDITS') END;
  SELECT CASE WHEN COALESCE((SELECT attempts FROM daily_attempts WHERE day = NEW.day), 0) >= NEW.daily_limit
    THEN RAISE(ABORT, 'DAILY_CAP') END;
END;
CREATE TRIGGER IF NOT EXISTS render_reserve AFTER INSERT ON renders BEGIN
  UPDATE leads SET remaining_renders = remaining_renders - 1 WHERE id = NEW.lead_id;
  INSERT INTO daily_attempts(day, attempts) VALUES (NEW.day, 1)
    ON CONFLICT(day) DO UPDATE SET attempts = attempts + 1;
END;
-- Refund visitor credit once, but never refund the global paid-attempt cap:
-- a timed-out upstream request may still incur provider charges.
CREATE TRIGGER IF NOT EXISTS render_refund AFTER UPDATE OF status ON renders
  WHEN OLD.status = 'pending' AND NEW.status = 'failed' BEGIN
  UPDATE leads SET remaining_renders = remaining_renders + 1 WHERE id = NEW.lead_id;
END;
CREATE TRIGGER IF NOT EXISTS render_terminal BEFORE UPDATE OF status ON renders
  WHEN OLD.status <> 'pending' AND NEW.status <> OLD.status BEGIN
  SELECT RAISE(ABORT, 'TERMINAL_RENDER');
END;

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lead_visits (
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  visit_id TEXT NOT NULL,
  accessed_at TEXT NOT NULL,
  PRIMARY KEY (lead_id, visit_id)
);
CREATE INDEX IF NOT EXISTS lead_visits_latest ON lead_visits(lead_id, accessed_at);
CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO app_metadata(key,value)
  VALUES ('activity_tracking_started_at',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE IF NOT EXISTS lead_media_cleanup (
  lead_id TEXT PRIMARY KEY,
  object_keys TEXT NOT NULL,
  requested_at TEXT NOT NULL
);
