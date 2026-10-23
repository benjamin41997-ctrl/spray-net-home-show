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
-- Add two credits to the previous three-credit allowance, preserving all
-- completed/pending usage. A rerun cannot reset a mapped durable balance.
UPDATE leads SET remaining_renders=MAX(0,5-MAX(
  (SELECT COUNT(*) FROM renders r JOIN leads other ON other.id=r.lead_id
    WHERE other.event_id=leads.event_id AND other.phone_normalized=leads.phone_normalized AND r.status IN ('completed','pending')),
  COALESCE((SELECT q.consumed FROM render_quotas q JOIN render_quota_leads m ON m.quota_key=q.quota_key WHERE m.lead_id=leads.id),0)));
UPDATE render_quotas SET allowance=MAX(allowance,5);
DROP TRIGGER IF EXISTS render_limits;
DROP TRIGGER IF EXISTS render_reserve;
DROP TRIGGER IF EXISTS render_refund;
CREATE TRIGGER render_limits BEFORE INSERT ON renders BEGIN
  SELECT CASE WHEN NEW.status<>'pending' THEN RAISE(ABORT,'INVALID_STATUS') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM render_quota_leads m JOIN render_quotas q ON q.quota_key=m.quota_key
    WHERE m.lead_id=NEW.lead_id AND q.consumed<q.allowance) THEN RAISE(ABORT,'NO_CREDITS') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM render_quota_leads m JOIN render_quotas q ON q.quota_key=m.quota_key
    WHERE m.lead_id=NEW.lead_id AND q.attempts>=q.attempt_limit) THEN RAISE(ABORT,'PHONE_ATTEMPT_CAP') END;
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM leads l JOIN render_event_usage e ON e.event_id=l.event_id
    WHERE l.id=NEW.lead_id AND e.attempts<e.attempt_limit) THEN RAISE(ABORT,'EVENT_CAP') END;
  SELECT CASE WHEN COALESCE((SELECT attempts FROM daily_attempts WHERE day=NEW.day),0)>=NEW.daily_limit THEN RAISE(ABORT,'DAILY_CAP') END;
END;
CREATE TRIGGER render_reserve AFTER INSERT ON renders BEGIN
  UPDATE render_quotas SET consumed=consumed+1,attempts=attempts+1,updated_at=NEW.updated_at
    WHERE quota_key=(SELECT quota_key FROM render_quota_leads WHERE lead_id=NEW.lead_id);
  UPDATE leads SET remaining_renders=(SELECT MAX(0,q.allowance-q.consumed) FROM render_quotas q JOIN render_quota_leads m ON m.quota_key=q.quota_key WHERE m.lead_id=leads.id)
    WHERE id IN(SELECT lead_id FROM render_quota_leads WHERE quota_key=(SELECT quota_key FROM render_quota_leads WHERE lead_id=NEW.lead_id));
  UPDATE render_event_usage SET attempts=attempts+1 WHERE event_id=(SELECT event_id FROM leads WHERE id=NEW.lead_id);
  INSERT INTO daily_attempts(day,attempts) VALUES(NEW.day,1) ON CONFLICT(day) DO UPDATE SET attempts=attempts+1;
END;
CREATE TRIGGER render_refund AFTER UPDATE OF status ON renders WHEN OLD.status='pending' AND NEW.status='failed' BEGIN
  UPDATE render_quotas SET consumed=MAX(0,consumed-1),updated_at=NEW.updated_at
    WHERE quota_key=(SELECT quota_key FROM render_quota_leads WHERE lead_id=NEW.lead_id);
  UPDATE leads SET remaining_renders=(SELECT MAX(0,q.allowance-q.consumed) FROM render_quotas q JOIN render_quota_leads m ON m.quota_key=q.quota_key WHERE m.lead_id=leads.id)
    WHERE id IN(SELECT lead_id FROM render_quota_leads WHERE quota_key=(SELECT quota_key FROM render_quota_leads WHERE lead_id=NEW.lead_id));
END;
