PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  request_key TEXT,
  input_hash TEXT,
  email_normalized TEXT NOT NULL,
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
  timeline TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  event_label TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  remaining_renders INTEGER NOT NULL CHECK (remaining_renders >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (email_normalized, event_id)
);

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
