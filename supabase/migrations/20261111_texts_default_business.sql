-- Texts screen (build 2 of "receiving Twilio replies"): switch the job card's
-- Text chip and Message customer button to send from the business number for
-- businesses that already text from it, so customer replies land in Texts
-- (Bernard, 2026-11-10: "Default: switch the buttons to the business number
-- once replies work? Yes").
--
-- Data only, no schema change. Run ONCE in the Supabase SQL editor after
-- merging. Only touches businesses with texting from the business number
-- turned on (auto_sms_enroute) that are still on 'phone'. Anyone can switch
-- back in Ops, Business settings, Automatic Texts; running this again would
-- switch them to the business number again.
UPDATE organizations
   SET job_text_via = 'business'
 WHERE auto_sms_enroute = true
   AND job_text_via = 'phone';
