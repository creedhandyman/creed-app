-- supabase/migrations/20261118_material_spec_files.sql
-- Keep the original uploaded files with a customer's material spec
-- (docs/claude/customer-material-specs.md, "Original files"). Safe to re-run.
-- Needs 20261117_customer_material_specs.sql first.
--
-- 1. material_specs.files: the list of stored originals
--    [{path, name, size, type, uploaded_at}] (lib/spec-import.ts SpecFile).
-- 2. A PRIVATE bucket "spec-files", 25 MB per file, PDFs / spreadsheets /
--    photos / text only. Files live at {org_id}/{spec_id}/{time}-{name}.
-- 3. Storage RLS: everyone in the org can read their org's folder (signed
--    links from the app); only owners / managers can add or remove files.

ALTER TABLE material_specs ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]'::jsonb;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'spec-files', 'spec-files', false, 26214400,
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv', 'text/plain',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS spec_files_select ON storage.objects;
CREATE POLICY spec_files_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'spec-files' AND (storage.foldername(name))[1] = auth_org_id()::text);

DROP POLICY IF EXISTS spec_files_insert ON storage.objects;
CREATE POLICY spec_files_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'spec-files'
    AND (storage.foldername(name))[1] = auth_org_id()::text
    AND auth_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS spec_files_update ON storage.objects;
CREATE POLICY spec_files_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'spec-files'
    AND (storage.foldername(name))[1] = auth_org_id()::text
    AND auth_role() IN ('owner', 'manager')
  )
  WITH CHECK (
    bucket_id = 'spec-files'
    AND (storage.foldername(name))[1] = auth_org_id()::text
    AND auth_role() IN ('owner', 'manager')
  );

DROP POLICY IF EXISTS spec_files_delete ON storage.objects;
CREATE POLICY spec_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'spec-files'
    AND (storage.foldername(name))[1] = auth_org_id()::text
    AND auth_role() IN ('owner', 'manager')
  );
