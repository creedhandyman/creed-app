-- Run in prod 2026-11-15. Safe to re-run.
-- One review request per job, one membership row per Stripe subscription
-- (the app checked-then-inserted, so two runs at once could write two).
CREATE UNIQUE INDEX IF NOT EXISTS review_requests_job_uniq ON review_requests (job_id);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_sub_uniq ON customer_memberships (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
-- The public photo bucket: images and PDFs only, 25 MB each.
UPDATE storage.buckets SET file_size_limit = 26214400, allowed_mime_types = ARRAY['image/*','application/pdf'] WHERE id = 'receipts';
