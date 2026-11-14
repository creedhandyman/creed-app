-- Three-tier quotes as the default (Bernard, 2026-11-14). One switch per
-- business, Operations -> Settings -> Pricing & taxes: new quotes with 2+
-- lines start as Essential / Complete / Premium. ON for every business unless
-- they turn it off; each quote still has its own On / One price switch.
-- Safe to re-run. The app reads a missing column / NULL as ON.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tiered_quotes_default BOOLEAN NOT NULL DEFAULT true;
