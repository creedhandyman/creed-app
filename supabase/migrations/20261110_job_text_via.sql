-- How the job card's Text chip and Message customer button send.
--   'phone'    (default) = open the phone's Messages app, as before.
--   'business' = Send text from the business number (Twilio). Also needs
--                organizations.auto_sms_enroute = true (Ops > Settings >
--                Automatic Texts); while that's off the buttons use the phone.
-- Safe to run more than once.
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS job_text_via TEXT NOT NULL DEFAULT 'phone';
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_job_text_via_check;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_job_text_via_check CHECK (job_text_via IN ('phone', 'business'));
