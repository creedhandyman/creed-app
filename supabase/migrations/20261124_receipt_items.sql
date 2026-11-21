-- supabase/migrations/20261124_receipt_items.sql
-- A receipt keeps the item list its scan read, so it can be opened again
-- later (Jobs -> Receipts -> tap a receipt). Safe to re-run.
--
-- receipts.items   the scanned lines: [{ name, product, sku, qty, price }]
--                  (price = the LINE total; null on receipts saved before this)
-- receipts.vendor  the store name the scan read
--
-- No policy change: the columns follow the receipts table's existing RLS.

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS items JSONB;
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS vendor TEXT;
