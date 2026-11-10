-- Review requests: the column that records "a review was already asked for".
-- It was listed in CLAUDE.md but never run in prod, so:
--   - scheduleReviewRequest (lib/payment-fulfillment.ts) selected it, the
--     query failed, and NO automated review request was ever queued;
--   - the Request review sheet's "asked" stamp failed silently, so the app
--     kept offering to ask again.
-- Safe to re-run.
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ;
