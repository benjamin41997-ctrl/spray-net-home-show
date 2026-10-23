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

-- Minimal, private usage accounting remains after staff delete a lead.
-- Quota keys are hashes of the normalized phone/event; no contact fields,
-- photos or visitor access tokens are retained in these tables.
CREATE TABLE IF NOT EXISTS render_quotas (
  quota_key TEXT PRIMARY KEY,event_id TEXT NOT NULL,allowance INTEGER NOT NULL CHECK(allowance>=0),
  consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0),attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
  attempt_limit INTEGER NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS render_quota_leads (
  lead_id TEXT PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  quota_key TEXT NOT NULL REFERENCES render_quotas(quota_key)
);
CREATE INDEX IF NOT EXISTS render_quota_members ON render_quota_leads(quota_key);
CREATE TABLE IF NOT EXISTS render_event_usage (
  event_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),attempt_limit INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS render_limits BEFORE INSERT ON renders BEGIN
  SELECT CASE WHEN NEW.status<>'pending' THEN RAISE(ABORT,'INVALID_STATUS') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM render_quota_leads m JOIN render_quotas q ON q.quota_key=m.quota_key
    WHERE m.lead_id=NEW.lead_id AND q.consumed<q.allowance) THEN RAISE(ABORT,'NO_CREDITS') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM render_quota_leads m JOIN render_quotas q ON q.quota_key=m.quota_key
    WHERE m.lead_id=NEW.lead_id AND q.attempts>=q.attempt_limit) THEN RAISE(ABORT,'PHONE_ATTEMPT_CAP') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM leads l JOIN render_event_usage e ON e.event_id=l.event_id
    WHERE l.id=NEW.lead_id AND e.attempts<e.attempt_limit) THEN RAISE(ABORT,'EVENT_CAP') END;
  SELECT CASE WHEN COALESCE((SELECT attempts FROM daily_attempts WHERE day=NEW.day),0)>=NEW.daily_limit THEN RAISE(ABORT,'DAILY_CAP') END;
END;
CREATE TRIGGER IF NOT EXISTS render_reserve AFTER INSERT ON renders BEGIN
  UPDATE render_quotas SET consumed=consumed+1,attempts=attempts+1,updated_at=NEW.updated_at
    WHERE quota_key=(SELECT quota_key FROM render_quota_leads WHERE lead_id=NEW.lead_id);
  UPDATE leads SET remaining_renders=(SELECT MAX(0,q.allowance-q.consumed) FROM render_quotas q JOIN render_quota_leads m ON m.quota_key=q.quota_key WHERE m.lead_id=leads.id)
    WHERE id IN(SELECT lead_id FROM render_quota_leads WHERE quota_key=(SELECT quota_key FROM render_quota_leads WHERE lead_id=NEW.lead_id));
  UPDATE render_event_usage SET attempts=attempts+1 WHERE event_id=(SELECT event_id FROM leads WHERE id=NEW.lead_id);
  INSERT INTO daily_attempts(day,attempts) VALUES(NEW.day,1) ON CONFLICT(day) DO UPDATE SET attempts=attempts+1;
END;
CREATE TRIGGER IF NOT EXISTS render_refund AFTER UPDATE OF status ON renders WHEN OLD.status='pending' AND NEW.status='failed' BEGIN
  UPDATE render_quotas SET consumed=MAX(0,consumed-1),updated_at=NEW.updated_at
    WHERE quota_key=(SELECT quota_key FROM render_quota_leads WHERE lead_id=NEW.lead_id);
  UPDATE leads SET remaining_renders=(SELECT MAX(0,q.allowance-q.consumed) FROM render_quotas q JOIN render_quota_leads m ON m.quota_key=q.quota_key WHERE m.lead_id=leads.id)
    WHERE id IN(SELECT lead_id FROM render_quota_leads WHERE quota_key=(SELECT quota_key FROM render_quota_leads WHERE lead_id=NEW.lead_id));
END;
