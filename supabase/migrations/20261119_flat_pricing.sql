-- Flat-price quotes (2026-11-19). One switch per business, Operations ->
-- Settings -> Pricing & taxes: customers see one price per quote line, never
-- the hours or the hourly rate (quote PDF, /status, portal copy, invoice).
-- Hours x rate still price every line. OFF unless the business turns it on;
-- each quote has its own switch and saves its choice on the quote blob.
-- Safe to re-run. Until it runs the app reads the default as OFF (the public
-- quote page and portal read the column best-effort), and the Settings switch
-- can't save.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS flat_pricing BOOLEAN NOT NULL DEFAULT false;
