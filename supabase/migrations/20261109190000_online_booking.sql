-- Online booking (/book/[slug]) — NOT yet run in prod. Safe to re-run.
-- Everything is additive with defaults; the feature stays OFF for every
-- business until the owner flips Ops → Settings → Online booking.

-- Per-business booking settings.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS booking_enabled BOOLEAN DEFAULT FALSE;
-- Work windows per weekday, "0" = Sunday … "6" = Saturday, each [start, end]
-- in 24h "HH:MM" local time. Default: Mon–Fri 9:30–12:00 and 1:30–6:00
-- (lunch 12–1:30 kept clear).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS booking_hours JSONB DEFAULT '{
  "0": [],
  "1": [["09:30","12:00"],["13:30","18:00"]],
  "2": [["09:30","12:00"],["13:30","18:00"]],
  "3": [["09:30","12:00"],["13:30","18:00"]],
  "4": [["09:30","12:00"],["13:30","18:00"]],
  "5": [["09:30","12:00"],["13:30","18:00"]],
  "6": []
}'::jsonb;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS booking_slot_min INTEGER DEFAULT 120;         -- appointment length offered
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS booking_buffer_min INTEGER DEFAULT 30;        -- gap kept around every visit
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS booking_min_notice_hours INTEGER DEFAULT 24;  -- no bookings sooner than this
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS booking_days_ahead INTEGER DEFAULT 21;        -- how far out the page shows
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS booking_tz TEXT DEFAULT 'America/Chicago';   -- zone the hours are in

-- Schedule rows get a real start time + length (until now the time lived only
-- inside the note text, "🕐 13:30 · …"). Existing rows are NOT backfilled: the
-- slot finder (src/lib/booking.ts visitFromRow) falls back to the note's time.
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS start_time TEXT;        -- "HH:MM" 24h
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS duration_min INTEGER;
-- 'requested' = an online booking holding the slot until the owner confirms;
-- 'confirmed' = owner said yes. NULL = an ordinary schedule entry.
ALTER TABLE schedule ADD COLUMN IF NOT EXISTS booking_status TEXT;
DO $$ BEGIN
  ALTER TABLE schedule ADD CONSTRAINT schedule_booking_status_chk
    CHECK (booking_status IS NULL OR booking_status IN ('requested', 'confirmed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Two customers can't grab the same start at the same moment: only one online
-- booking per business per day + start time.
CREATE UNIQUE INDEX IF NOT EXISTS schedule_one_booking_per_slot
  ON schedule (org_id, sched_date, start_time)
  WHERE booking_status IS NOT NULL;
