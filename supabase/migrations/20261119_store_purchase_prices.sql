-- supabase/migrations/20261119_store_purchase_prices.sql
-- Store purchase price import (lib/purchase-import.ts). Safe to re-run.
-- Needs 20261117_customer_material_specs.sql first (adds two columns to
-- material_spec_items).
--
-- material_price_history  every purchase line imported (Home Depot / Lowe's
--                         export or receipt), one row per line, never edited.
--                         line_hash makes re-importing the same purchases a no-op.
-- material_prices         the org's CURRENT price per product (newest purchase),
--                         one row per (org, product_key). Quotes read this.
-- material_spec_items     + price_updated_at / price_source: when and where a
--                         spec item's unit_price last came from a purchase.
--
-- RLS like the rest of the app: everyone in the org reads; owners / managers write.

CREATE TABLE IF NOT EXISTS material_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  product_key TEXT NOT NULL,
  line_hash TEXT NOT NULL,
  store TEXT,
  sku TEXT,
  model TEXT,
  description TEXT NOT NULL,
  qty NUMERIC(12,3),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  total NUMERIC(12,2),
  purchased_on DATE,
  job_ref TEXT,
  po TEXT,
  department TEXT,
  source TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS material_price_history_line_uq
  ON material_price_history (org_id, line_hash);
CREATE INDEX IF NOT EXISTS material_price_history_product_idx
  ON material_price_history (org_id, product_key, purchased_on DESC);

CREATE TABLE IF NOT EXISTS material_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  product_key TEXT NOT NULL,
  store TEXT,
  sku TEXT,
  model TEXT,
  description TEXT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  purchased_on DATE,
  job_ref TEXT,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS material_prices_product_uq
  ON material_prices (org_id, product_key);

ALTER TABLE material_spec_items ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMPTZ;
ALTER TABLE material_spec_items ADD COLUMN IF NOT EXISTS price_source TEXT;

ALTER TABLE material_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_prices ENABLE ROW LEVEL SECURITY;

-- material_price_history (append-only from the app: no UPDATE policy)
DROP POLICY IF EXISTS material_price_history_select ON material_price_history;
CREATE POLICY material_price_history_select ON material_price_history FOR SELECT TO authenticated
  USING (org_id = auth_org_id());

DROP POLICY IF EXISTS material_price_history_insert ON material_price_history;
CREATE POLICY material_price_history_insert ON material_price_history FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS material_price_history_delete ON material_price_history;
CREATE POLICY material_price_history_delete ON material_price_history FOR DELETE TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));

-- material_prices
DROP POLICY IF EXISTS material_prices_select ON material_prices;
CREATE POLICY material_prices_select ON material_prices FOR SELECT TO authenticated
  USING (org_id = auth_org_id());

DROP POLICY IF EXISTS material_prices_insert ON material_prices;
CREATE POLICY material_prices_insert ON material_prices FOR INSERT TO authenticated
  WITH CHECK (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS material_prices_update ON material_prices;
CREATE POLICY material_prices_update ON material_prices FOR UPDATE TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'))
  WITH CHECK (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));

DROP POLICY IF EXISTS material_prices_delete ON material_prices;
CREATE POLICY material_prices_delete ON material_prices FOR DELETE TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));
