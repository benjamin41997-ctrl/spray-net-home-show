-- Apply to an existing phone-identity/booking database before enabling BOOKING_PROVIDER=internal.
-- Additive only: existing leads, visitor token hashes, bookings, and private media are unchanged.
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
