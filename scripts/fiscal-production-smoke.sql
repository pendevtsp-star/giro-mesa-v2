\set ON_ERROR_STOP on

DO $fiscal_schema$
BEGIN
  IF to_regclass('public.fiscal_document_artifacts') IS NULL
    OR to_regclass('public.fiscal_number_invalidations') IS NULL
    OR to_regclass('public.fiscal_document_artifacts_kind_unique') IS NULL
    OR to_regclass('public.fiscal_number_invalidations_idempotency_unique') IS NULL THEN
    RAISE EXCEPTION 'FISCAL_PRODUCTION_SCHEMA_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fiscal_documents' AND column_name = 'tab_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fiscal_documents' AND column_name = 'xml_storage_key'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'accounting_exports' AND column_name = 'storage_key'
  ) THEN
    RAISE EXCEPTION 'FISCAL_PRODUCTION_COLUMNS_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_document_artifacts_document_fk'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_number_invalidations_unit_fk'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_tab_fk'
  ) THEN
    RAISE EXCEPTION 'FISCAL_PRODUCTION_CONSTRAINTS_MISSING';
  END IF;
END
$fiscal_schema$;

SELECT 'FISCAL_PRODUCTION_SCHEMA_READY';
