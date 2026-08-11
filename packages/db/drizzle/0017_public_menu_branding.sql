DO $$ BEGIN
  CREATE TYPE public.public_menu_asset_kind AS ENUM ('logo', 'cover', 'product');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

ALTER TABLE public.public_menus
  ADD COLUMN IF NOT EXISTS published_version_id uuid,
  ADD COLUMN IF NOT EXISTS publish_epoch integer NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE public.public_menus
  ADD CONSTRAINT public_menus_scope_id_unique UNIQUE (organization_id, unit_id, id);--> statement-breakpoint

CREATE TABLE public.public_menu_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  kind public.public_menu_asset_kind NOT NULL,
  sha256 varchar(64) NOT NULL,
  storage_key varchar(240) NOT NULL,
  mime_type varchar(40) NOT NULL,
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  bytes bytea NOT NULL,
  created_by_identity_id uuid REFERENCES public.identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_menu_media_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT public_menu_media_scope_hash_unique UNIQUE (organization_id, unit_id, sha256, kind),
  CONSTRAINT public_menu_media_storage_key_unique UNIQUE (storage_key),
  CONSTRAINT public_menu_media_unit_tenant_fk FOREIGN KEY (organization_id, unit_id)
    REFERENCES public.units(organization_id, id) ON DELETE CASCADE
);--> statement-breakpoint

CREATE TABLE public.public_menu_drafts (
  menu_id uuid PRIMARY KEY REFERENCES public.public_menus(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  branding jsonb NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource_version integer NOT NULL DEFAULT 0 CHECK (resource_version >= 0),
  preview_token_hash varchar(64),
  preview_expires_at timestamptz,
  updated_by_identity_id uuid REFERENCES public.identities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_menu_drafts_scope_id_unique UNIQUE (organization_id, unit_id, menu_id),
  CONSTRAINT public_menu_drafts_menu_tenant_fk FOREIGN KEY (organization_id, unit_id, menu_id)
    REFERENCES public.public_menus(organization_id, unit_id, id) ON DELETE CASCADE
);--> statement-breakpoint

CREATE TABLE public.public_menu_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  menu_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  source_resource_version integer NOT NULL,
  checksum varchar(64) NOT NULL,
  branding jsonb NOT NULL,
  items jsonb NOT NULL,
  created_by_identity_id uuid REFERENCES public.identities(id),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_menu_versions_scope_id_unique UNIQUE (organization_id, unit_id, id),
  CONSTRAINT public_menu_versions_menu_version_unique UNIQUE (menu_id, version),
  CONSTRAINT public_menu_versions_menu_checksum_unique UNIQUE (menu_id, checksum),
  CONSTRAINT public_menu_versions_menu_tenant_fk FOREIGN KEY (organization_id, unit_id, menu_id)
    REFERENCES public.public_menus(organization_id, unit_id, id) ON DELETE CASCADE
);--> statement-breakpoint

ALTER TABLE public.public_menus
  ADD CONSTRAINT public_menus_published_version_scope_fk
  FOREIGN KEY (organization_id, unit_id, published_version_id)
  REFERENCES public.public_menu_versions(organization_id, unit_id, id)
  ON DELETE RESTRICT;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_reject_immutable_menu_asset_change()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'public menu media assets are immutable' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

CREATE TRIGGER public_menu_media_assets_immutable
BEFORE UPDATE OR DELETE ON public.public_menu_media_assets
FOR EACH ROW EXECUTE FUNCTION public.giromesa_reject_immutable_menu_asset_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_guard_public_menu_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'public menu versions are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.published_at IS NULL
     AND NEW.published_at IS NOT NULL
     AND (to_jsonb(NEW) - 'published_at') = (to_jsonb(OLD) - 'published_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'public menu versions are immutable' USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint

CREATE TRIGGER public_menu_versions_immutable
BEFORE UPDATE OR DELETE ON public.public_menu_versions
FOR EACH ROW EXECUTE FUNCTION public.giromesa_guard_public_menu_version();--> statement-breakpoint

ALTER TABLE public.public_menu_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_menu_media_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.public_menu_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_menu_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.public_menu_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_menu_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint

GRANT SELECT, INSERT ON public.public_menu_media_assets TO giromesa_app;
GRANT SELECT, INSERT, UPDATE ON public.public_menu_drafts TO giromesa_app;
GRANT SELECT, INSERT ON public.public_menu_versions TO giromesa_app;
GRANT UPDATE (published_at) ON public.public_menu_versions TO giromesa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.public_menu_media_assets,
  public.public_menu_drafts,
  public.public_menu_versions
TO giromesa_legacy_transition;--> statement-breakpoint

CREATE POLICY giromesa_tenant_scope ON public.public_menu_media_assets
FOR ALL TO giromesa_app
USING (
  organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
  AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
  AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
)
WITH CHECK (
  organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
  AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
  AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
);--> statement-breakpoint

CREATE POLICY giromesa_tenant_scope ON public.public_menu_drafts
FOR ALL TO giromesa_app
USING (
  organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
  AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
  AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
)
WITH CHECK (
  organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
  AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
  AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
);--> statement-breakpoint

CREATE POLICY giromesa_tenant_scope ON public.public_menu_versions
FOR ALL TO giromesa_app
USING (
  organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
  AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
  AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
)
WITH CHECK (
  organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
  AND unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid
  AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
);--> statement-breakpoint

CREATE POLICY giromesa_legacy_transition ON public.public_menu_media_assets
FOR ALL TO giromesa_legacy_transition USING (true) WITH CHECK (true);
CREATE POLICY giromesa_legacy_transition ON public.public_menu_drafts
FOR ALL TO giromesa_legacy_transition USING (true) WITH CHECK (true);
CREATE POLICY giromesa_legacy_transition ON public.public_menu_versions
FOR ALL TO giromesa_legacy_transition USING (true) WITH CHECK (true);
