# Per-customer material specs: plan

Status (2026-11-17): PLAN, not built. Waiting on Bernard's OK. SQL below is
NOT run. For every org on Creed, not just Creed Handyman.

Why: commercial clients (e.g. Grid Property Management) hand over a material
spec (Shaw Infinium carpet tile, Roppe 4" charcoal base, Behr Marquee Satin,
Halco LED wraparounds, Schlage Elan sets). Quotes today use generic
residential materials and come in short of the spec.

## What the quoter uses today (so the plan fits it)

- **Material prices** come from `lib/materials-db.ts` (a hardcoded shop list,
  the same for every org) + this org's receipt prices from `price_corrections`.
  `quote-grounding.ts shopPricesFor` sends the matching ones to the AI;
  `parser.ts estimateMaterials` uses the same list for the non-AI path.
- **`price_book`** is the repair knowledge base: labor HOURS per task, not
  material products. It stays as it is.
- Quote lines carry `materials: { n, c, qty?, unitPrice? }[]` per line, and
  the quote PDF's breakdown prints each material name (merged across rooms).
- A quote knows its customer (`customerId` in QuoteForge, `jobs.customer_id`).

## Design

### Data
- `material_specs`: one row per spec, belongs to a customer (a customer can
  have more than one, e.g. "Grid: units" and "Grid: common areas"; all
  ACTIVE specs of the customer apply). Name, active, source ("Grid spec
  2026.pdf" / "pasted" / "CSV"), notes.
- `material_spec_items`: the products. name, brand, model, sku, store, trade,
  category, unit (ea / gal / sqft / lf / box), unit_price (cost, before
  markup; may be empty), pack_size + pack_label (120 / "120 ft coil"),
  coverage + coverage_unit (350 / "sqft per gal"), keywords (extra match
  words, e.g. "baseboard, cove base"), companions, notes.
- Companions (nice-to-have, included): JSON list on the item, e.g. carpet
  tile → `{name: "Shaw 4151 adhesive", qty: 1, per: 400}` (1 pail per 400
  sqft); LED-ready fixture → `{name: "Halco T8 LED tube", qty: 2, per: 1}`.
  A companion can point at another spec item (`item_id`) to take its price.

### Import (Customers tab → customer → "Material spec" card)
- Owner/manager only. Card shows "Grid spec: 42 items, imported Nov 17",
  with Import, View/edit, and an Active switch.
- **Import sheet**, three ways in, one review screen out:
  1. **CSV / Excel**: read in the browser. If the headers are recognizable
     (name, brand, model, price, unit…) columns map directly, no AI. Messy
     sheets go to the AI with the rows as text. Excel needs one small
     library (`read-excel-file`, loaded only when an Excel file is picked).
  2. **PDF**: sent to a new server route `/api/specs/extract`, which hands the
     PDF to Claude (via `callClaude`, logged as `spec_import`).
  3. **Pasted text**: same route.
- The AI returns items in the fields above. Rules: never invent a price (no
  price on the spec = empty, shown "price needed"); keep brand/model exactly
  as written; one item per distinct product/color/size; fill
  trade/category; guess pack size + coverage only when the spec states them.
- **Review screen** before anything saves: an editable table (fix any field,
  untick rows to skip, "price needed" highlighted), then Save. Re-importing
  into an existing spec offers "add to it" or "replace it".

### Quoting with a spec
1. When QuoteForge (or a lead draft) parses a job whose customer has an
   active spec, the parser loads that customer's spec items (new
   `ParserDeps.getCustomerSpec`; the app reads them through RLS).
2. **Prompt**: a new CLIENT MATERIAL SPEC block goes FIRST in the grounding,
   before shop prices: "This client requires these exact products. Any line
   that uses a material of these kinds uses the spec product, written exactly
   as listed, in its unit. Don't substitute." Small specs (≤150 items) are
   sent whole, so "baseboard" still finds "Roppe 4in charcoal base"; bigger
   ones send the items matched to the request plus every item in a matched
   category.
3. **Deterministic pass after the AI** (`lib/material-spec.ts applySpec`,
   pure, tested), the part that makes it reliable: each material on each line
   is matched to a spec item (exact name / model / keywords). A match stamps
   the spec item onto the material, takes the spec price (when it has one),
   rounds the quantity up to the pack (150 ft of base → 2 × 120 ft coils;
   paint → whole gallons), and adds companions (rounded the same way).
4. **Fallback**: anything with no spec match goes through today's flow (shop
   list, receipts, generic tables). A spec item with no price keeps the spec
   name and uses the normal price, flagged "spec price needed" in the
   "Check before you send" card.
5. **Manual entry**: the Materials sheet's type-ahead lists the customer's
   spec items first, then the shop list. An "Apply client spec" button in
   QuoteForge runs step 3 on an already-built quote (e.g. the customer was
   picked after generating).
6. **Saved quotes keep what they were priced with** (same rule as
   `pricedRates`): the spec data is stored on each material in the quote, so
   editing the spec later never changes a sent quote.

### Showing the spec on the quote (point 4)
- `Material` gets an optional `spec: { itemId, brand?, model? }`. The name
  shown becomes e.g. "Roppe 700 Series 4in wall base, charcoal (2 × 120 ft
  coil)".
- QuoteForge: a small "Spec" tag on matched materials, and a count on the
  quote ("18 of 20 materials match Grid's spec").
- Quote PDF breakdown: the full spec name + model, marked "client spec".
  The merge-across-rooms logic already keys on name + unit price, so spec
  items merge correctly.

### Unchanged
The pricing cascade (`pricing.ts`): spec prices are COST, the org's markup +
material tax apply as today. `price_book` hours. Orgs/customers with no spec
see no change at all.

## SQL for review (NOT run; file will be
`supabase/migrations/20261117_customer_material_specs.sql`)

```sql
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
```

The server lead-draft path reads specs with the service role, filtered by
the job's org + customer explicitly. Preflight `DB_CHECKS` gets both tables.

## Build order (after OK)
1. `lib/material-spec.ts` (pure): match, pack rounding, companions,
   `applySpec(rooms, items)`; CSV header mapping. Tests first.
2. Grounding block + `ParserDeps.getCustomerSpec` + the after-AI pass in
   the parser; lead-draft wiring. Tests.
3. `/api/specs/extract` (PDF / text → items).
4. Customer → Material spec card, import sheet, review table, editor.
5. QuoteForge: Spec tags, match count, "Apply client spec", Materials sheet
   type-ahead; PDF naming.
6. i18n (en + es), type-check, tests, then push.

## Open questions (none block the plan)
- Should a spec be allowed per PROPERTY too (some managers spec by
  building)? v1: per customer only; a property override can come later.
- Techs: can they see the spec card (read-only), or owner/manager only? v1:
  owner/manager see the card; everyone's quotes USE the spec.
- Keep the original spec file? v1 stores only its name; storing the PDF in
  Supabase Storage is easy to add.

## Separate thing noticed
`materials-db.ts` is Creed's own shop list, hardcoded, and every org's quotes
use its prices (not just Creed's). Worth its own fix later (per-org shop
list). Not part of this feature.
