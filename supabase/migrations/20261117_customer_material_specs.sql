-- supabase/migrations/20261117_customer_material_specs.sql
-- Approved 2026-11-17 (plan: docs/claude/customer-material-specs.md). Safe to re-run.

-- Per-customer material specs. Org-scoped RLS like the rest of the app:
-- everyone in the org can READ (anyone who quotes needs them); only owners
-- and managers can WRITE. A spec must belong to a customer in the same org,
-- and an item to a spec in the same org.

CREATE TABLE IF NOT EXISTS material_specs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Material spec',
  active BOOLEAN NOT NULL DEFAULT true,
  source TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS material_specs_customer_idx
  ON material_specs (org_id, customer_id);

CREATE TABLE IF NOT EXISTS material_spec_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  spec_id UUID NOT NULL REFERENCES material_specs(id) ON DELETE CASCADE,
  trade TEXT,
  category TEXT,
  name TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  sku TEXT,
  store TEXT,
  unit TEXT,
  unit_price NUMERIC(10,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  pack_size NUMERIC(10,3) CHECK (pack_size IS NULL OR pack_size > 0),
  pack_label TEXT,
  coverage NUMERIC(10,3) CHECK (coverage IS NULL OR coverage > 0),
  coverage_unit TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  companions JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS material_spec_items_spec_idx
  ON material_spec_items (spec_id, sort);
CREATE INDEX IF NOT EXISTS material_spec_items_org_idx
  ON material_spec_items (org_id);

ALTER TABLE material_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_spec_items ENABLE ROW LEVEL SECURITY;

-- material_specs
DROP POLICY IF EXISTS material_specs_select ON material_specs;
CREATE POLICY material_specs_select ON material_specs FOR SELECT TO authenticated
  USING (org_id = auth_org_id());

DROP POLICY IF EXISTS material_specs_insert ON material_specs;
CREATE POLICY material_specs_insert ON material_specs FOR INSERT TO authenticated
  WITH CHECK (
    org_id = auth_org_id() AND auth_role() IN ('owner', 'manager')
    AND EXISTS (SELECT 1 FROM customers c
                WHERE c.id = customer_id AND c.org_id = auth_org_id())
  );

DROP POLICY IF EXISTS material_specs_update ON material_specs;
CREATE POLICY material_specs_update ON material_specs FOR UPDATE TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'))
  WITH CHECK (
    org_id = auth_org_id() AND auth_role() IN ('owner', 'manager')
    AND EXISTS (SELECT 1 FROM customers c
                WHERE c.id = customer_id AND c.org_id = auth_org_id())
  );

DROP POLICY IF EXISTS material_specs_delete ON material_specs;
CREATE POLICY material_specs_delete ON material_specs FOR DELETE TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));

-- material_spec_items
DROP POLICY IF EXISTS material_spec_items_select ON material_spec_items;
CREATE POLICY material_spec_items_select ON material_spec_items FOR SELECT TO authenticated
  USING (org_id = auth_org_id());

DROP POLICY IF EXISTS material_spec_items_insert ON material_spec_items;
CREATE POLICY material_spec_items_insert ON material_spec_items FOR INSERT TO authenticated
  WITH CHECK (
    org_id = auth_org_id() AND auth_role() IN ('owner', 'manager')
    AND EXISTS (SELECT 1 FROM material_specs s
                WHERE s.id = spec_id AND s.org_id = auth_org_id())
  );

DROP POLICY IF EXISTS material_spec_items_update ON material_spec_items;
CREATE POLICY material_spec_items_update ON material_spec_items FOR UPDATE TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'))
  WITH CHECK (
    org_id = auth_org_id() AND auth_role() IN ('owner', 'manager')
    AND EXISTS (SELECT 1 FROM material_specs s
                WHERE s.id = spec_id AND s.org_id = auth_org_id())
  );

DROP POLICY IF EXISTS material_spec_items_delete ON material_spec_items;
CREATE POLICY material_spec_items_delete ON material_spec_items FOR DELETE TO authenticated
  USING (org_id = auth_org_id() AND auth_role() IN ('owner', 'manager'));
