-- Manual compose-action markers only. These do not claim sending or delivery.
-- Scope each channel to the booking transaction so a new booking starts fresh.
CREATE TABLE IF NOT EXISTS confirmation_drafts (
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  booking_transaction_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('email','sms')),
  drafted_at TEXT NOT NULL,
  PRIMARY KEY (lead_id,booking_transaction_id,channel)
);
