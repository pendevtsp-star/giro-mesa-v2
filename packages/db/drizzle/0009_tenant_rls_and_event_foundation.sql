DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_app') THEN
    CREATE ROLE giromesa_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_migrator') THEN
    CREATE ROLE giromesa_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_worker') THEN
    CREATE ROLE giromesa_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_identity') THEN
    CREATE ROLE giromesa_identity NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_public') THEN
    CREATE ROLE giromesa_public NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_internal') THEN
    CREATE ROLE giromesa_internal NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'giromesa_legacy_transition') THEN
    CREATE ROLE giromesa_legacy_transition NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint

ALTER ROLE giromesa_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;--> statement-breakpoint
ALTER ROLE giromesa_migrator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION BYPASSRLS;--> statement-breakpoint
ALTER ROLE giromesa_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;--> statement-breakpoint
ALTER ROLE giromesa_identity NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;--> statement-breakpoint
ALTER ROLE giromesa_public NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;--> statement-breakpoint
ALTER ROLE giromesa_internal NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;--> statement-breakpoint
ALTER ROLE giromesa_legacy_transition NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO giromesa_app;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal, giromesa_legacy_transition;--> statement-breakpoint
GRANT SELECT ON public.memberships, public.role_bindings, public.units, public.public_menus TO giromesa_migrator;--> statement-breakpoint

ALTER TABLE public.outbox_events ADD COLUMN organization_id uuid;--> statement-breakpoint
ALTER TABLE public.outbox_events ADD COLUMN unit_id uuid;--> statement-breakpoint
UPDATE public.outbox_events AS event
SET organization_id = organization.id
FROM public.organizations AS organization
WHERE event.organization_id IS NULL
  AND organization.id = CASE
    WHEN event.payload ->> 'organizationId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (event.payload ->> 'organizationId')::uuid
    ELSE NULL
  END;--> statement-breakpoint
UPDATE public.outbox_events AS event
SET unit_id = unit.id
FROM public.units AS unit
WHERE event.unit_id IS NULL
  AND event.organization_id = unit.organization_id
  AND unit.id = CASE
    WHEN event.payload ->> 'unitId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN (event.payload ->> 'unitId')::uuid
    ELSE NULL
  END;--> statement-breakpoint
ALTER TABLE public.outbox_events ADD CONSTRAINT outbox_events_organization_id_organizations_id_fk
  FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.outbox_events ADD CONSTRAINT outbox_events_unit_id_units_id_fk
  FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE public.outbox_events ADD CONSTRAINT outbox_events_organization_unit_fk
  FOREIGN KEY (organization_id, unit_id) REFERENCES public.units(organization_id, id) ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX outbox_organization_idx ON public.outbox_events USING btree (organization_id, created_at);--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_public_menu_scope(requested_slug text)
RETURNS TABLE (organization_id uuid, unit_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT menu.organization_id, menu.unit_id
  FROM public.public_menus AS menu
  WHERE menu.slug = requested_slug
    AND menu.active = true
    AND menu.published_at IS NOT NULL
  LIMIT 1
$$;--> statement-breakpoint
ALTER FUNCTION public.giromesa_public_menu_scope(text) OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_public_menu_scope(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_public_menu_scope(text) TO giromesa_public;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.giromesa_tenant_context_authorized(
  expected_organization_id uuid,
  expected_unit_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    expected_organization_id IS NOT NULL
    AND nullif(current_setting('app.current_organization_id', true), '')::uuid = expected_organization_id
    AND (
      expected_unit_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.units AS expected_unit
        WHERE expected_unit.id = expected_unit_id
          AND expected_unit.organization_id = expected_organization_id
      )
    )
    AND (
      (
        current_setting('app.current_context_source', true) = 'job'
        AND pg_has_role(session_user, 'giromesa_worker', 'member')
      )
      OR (
        current_setting('app.current_context_source', true) = 'internal'
        AND pg_has_role(session_user, 'giromesa_internal', 'member')
      )
      OR (
        current_setting('app.current_context_source', true) = 'public'
        AND EXISTS (
          SELECT 1
          FROM public.giromesa_public_menu_scope(
            current_setting('app.current_public_menu_slug', true)
          ) AS public_scope
          WHERE public_scope.organization_id = expected_organization_id
            AND public_scope.unit_id = expected_unit_id
        )
      )
      OR (
        nullif(current_setting('app.current_actor_identity_id', true), '')::uuid IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.memberships AS membership
          JOIN public.role_bindings AS binding ON binding.membership_id = membership.id
          WHERE membership.organization_id = expected_organization_id
            AND membership.identity_id = nullif(
              current_setting('app.current_actor_identity_id', true),
              ''
            )::uuid
            AND membership.status = 'active'
            AND (
              expected_unit_id IS NULL
              OR binding.unit_id IS NULL
              OR binding.unit_id = expected_unit_id
            )
        )
      )
    )
$$;--> statement-breakpoint

ALTER FUNCTION public.giromesa_tenant_context_authorized(uuid, uuid) OWNER TO giromesa_migrator;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.giromesa_tenant_context_authorized(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.giromesa_tenant_context_authorized(uuid, uuid) TO giromesa_app;--> statement-breakpoint

DO $$
DECLARE
  tenant_table record;
  row_scope text;
  tenant_scope text;
  app_read_insert_tables text[] := ARRAY[
    'billing_checkouts', 'device_enrollments', 'growth_campaign_deliveries',
    'growth_coupon_redemptions', 'growth_coupons', 'growth_customer_consents',
    'growth_customer_segments', 'growth_customers', 'growth_delivery_dispatches',
    'growth_delivery_orders', 'growth_delivery_zones', 'growth_integrations',
    'growth_inventory_transfer_lines', 'growth_inventory_transfers', 'growth_loyalty_ledger',
    'growth_loyalty_programs', 'growth_marketing_campaigns', 'growth_marketing_opt_out_tokens',
    'growth_public_api_keys', 'growth_reservations', 'growth_unit_price_overrides',
    'growth_waitlist_entries', 'growth_webhook_endpoints', 'growth_webhook_publications',
    'hub_commands', 'hub_heartbeats', 'legal_entities', 'management_accounts_payable',
    'management_accounts_receivable', 'management_cash_movements', 'management_cash_shifts',
    'management_commission_rules', 'management_commissions', 'management_idempotency',
    'management_inventory_event_lines', 'management_inventory_events',
    'management_inventory_items', 'management_inventory_movements',
    'management_payable_payments', 'management_people', 'management_purchase_order_items',
    'management_purchase_orders', 'management_purchase_receipt_lines',
    'management_purchase_receipts', 'management_receivable_lines',
    'management_receivable_payments', 'management_recipe_components',
    'management_recipe_versions', 'management_reconciliation_entries',
    'management_reconciliation_imports', 'management_schedules', 'management_stock_balances',
    'management_stock_locations', 'management_suppliers', 'management_time_entries',
    'membership_invitations', 'memberships', 'onboarding_records', 'operational_commands',
    'pos_allergens', 'pos_catalog_categories', 'pos_dining_rooms', 'pos_dining_tables',
    'pos_idempotency_receipts', 'pos_kds_ticket_items', 'pos_kds_tickets', 'pos_manager_pins',
    'pos_modifier_groups', 'pos_modifier_options', 'pos_operation_approvals',
    'pos_order_item_modifiers', 'pos_order_items', 'pos_orders', 'pos_product_allergens',
    'pos_product_availability', 'pos_product_modifier_groups', 'pos_product_prices',
    'pos_product_stations', 'pos_production_stations', 'pos_products', 'pos_recipe_components',
    'pos_tab_events', 'pos_tabs', 'provider_customers', 'public_menus', 'subscriptions',
    'trials', 'units'
  ];
  app_update_tables text[] := ARRAY[
    'device_enrollments', 'growth_campaign_deliveries', 'growth_customers',
    'growth_delivery_orders', 'growth_integrations', 'growth_inventory_transfers',
    'growth_loyalty_programs', 'growth_marketing_campaigns', 'growth_marketing_opt_out_tokens',
    'growth_public_api_keys', 'growth_reservations', 'growth_unit_price_overrides',
    'growth_waitlist_entries', 'hub_commands', 'hub_heartbeats', 'management_accounts_payable',
    'management_accounts_receivable', 'management_cash_shifts',
    'management_purchase_order_items', 'management_purchase_orders',
    'management_recipe_versions', 'management_reconciliation_entries',
    'management_stock_balances', 'management_time_entries', 'membership_invitations',
    'memberships', 'onboarding_records', 'operational_commands', 'pos_dining_tables',
    'pos_kds_tickets', 'pos_manager_pins', 'pos_order_item_modifiers', 'pos_order_items',
    'pos_orders', 'pos_product_availability', 'pos_product_prices', 'pos_tabs'
  ];
  app_delete_tables text[] := ARRAY['pos_product_stations'];
BEGIN
  FOR tenant_table IN
    SELECT
      columns.table_name,
      bool_or(columns.column_name = 'unit_id') AS has_unit_id
    FROM information_schema.columns AS columns
    JOIN information_schema.tables AS tables
      ON tables.table_schema = columns.table_schema
      AND tables.table_name = columns.table_name
      AND tables.table_type = 'BASE TABLE'
    WHERE columns.table_schema = 'public'
      AND columns.column_name IN ('organization_id', 'unit_id')
      AND columns.table_name <> 'outbox_events'
    GROUP BY columns.table_name
    HAVING bool_or(columns.column_name = 'organization_id')
  LOOP
    row_scope := format(
      'organization_id = nullif(current_setting(''app.current_organization_id'', true), '''')::uuid%s',
      CASE
        WHEN tenant_table.has_unit_id THEN
          ' AND (unit_id IS NULL OR unit_id = nullif(current_setting(''app.current_unit_id'', true), '''')::uuid)'
        ELSE ''
      END
    );
    tenant_scope := format(
      '(%s AND public.giromesa_tenant_context_authorized('
      || 'nullif(current_setting(''app.current_organization_id'', true), '''')::uuid, '
      || 'nullif(current_setting(''app.current_unit_id'', true), '''')::uuid))',
      row_scope
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tenant_table.table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tenant_table.table_name);
    IF tenant_table.table_name = 'audit_events' THEN
      EXECUTE 'GRANT INSERT ON public.audit_events TO giromesa_app';
    ELSIF tenant_table.table_name = ANY(app_read_insert_tables) THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.%I TO giromesa_app', tenant_table.table_name);
    ELSE
      RAISE EXCEPTION 'tenant privilege matrix is missing table %', tenant_table.table_name;
    END IF;
    IF tenant_table.table_name = ANY(app_update_tables) THEN
      EXECUTE format('GRANT UPDATE ON public.%I TO giromesa_app', tenant_table.table_name);
    END IF;
    IF tenant_table.table_name = ANY(app_delete_tables) THEN
      EXECUTE format('GRANT DELETE ON public.%I TO giromesa_app', tenant_table.table_name);
    END IF;
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO giromesa_legacy_transition',
      tenant_table.table_name
    );
    EXECUTE format(
      'CREATE POLICY giromesa_legacy_transition ON public.%I AS PERMISSIVE FOR ALL TO giromesa_legacy_transition '
      || 'USING (true) WITH CHECK (true)',
      tenant_table.table_name
    );
    EXECUTE format(
      'CREATE POLICY giromesa_tenant_scope ON public.%I AS PERMISSIVE FOR ALL TO giromesa_app '
      || 'USING %s WITH CHECK %s',
      tenant_table.table_name,
      tenant_scope,
      tenant_scope
    );
  END LOOP;
END
$$;--> statement-breakpoint

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.organizations TO giromesa_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO giromesa_legacy_transition;--> statement-breakpoint
CREATE POLICY giromesa_legacy_transition ON public.organizations AS PERMISSIVE FOR ALL TO giromesa_legacy_transition
  USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON public.organizations AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(
      id,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  )
  WITH CHECK (
    id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND public.giromesa_tenant_context_authorized(
      id,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  );--> statement-breakpoint

ALTER TABLE public.role_bindings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.role_bindings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON public.role_bindings TO giromesa_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_bindings TO giromesa_legacy_transition;--> statement-breakpoint
CREATE POLICY giromesa_legacy_transition ON public.role_bindings AS PERMISSIVE FOR ALL TO giromesa_legacy_transition
  USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON public.role_bindings AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    EXISTS (
      SELECT 1 FROM public.memberships AS membership
      WHERE membership.id = membership_id
        AND membership.organization_id = nullif(
          current_setting('app.current_organization_id', true),
          ''
        )::uuid
    )
    AND public.giromesa_tenant_context_authorized(
      nullif(current_setting('app.current_organization_id', true), '')::uuid,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.memberships AS membership
      WHERE membership.id = membership_id
        AND membership.organization_id = nullif(
          current_setting('app.current_organization_id', true),
          ''
        )::uuid
    )
    AND public.giromesa_tenant_context_authorized(
      nullif(current_setting('app.current_organization_id', true), '')::uuid,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  );--> statement-breakpoint

ALTER TABLE public.charges ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.charges FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.charges TO giromesa_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.charges TO giromesa_legacy_transition;--> statement-breakpoint
CREATE POLICY giromesa_legacy_transition ON public.charges AS PERMISSIVE FOR ALL TO giromesa_legacy_transition
  USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY giromesa_tenant_scope ON public.charges AS PERMISSIVE FOR ALL TO giromesa_app
  USING (
    EXISTS (
      SELECT 1 FROM public.subscriptions AS subscription
      WHERE subscription.id = subscription_id
        AND subscription.organization_id = nullif(
          current_setting('app.current_organization_id', true),
          ''
        )::uuid
    )
    AND public.giromesa_tenant_context_authorized(
      nullif(current_setting('app.current_organization_id', true), '')::uuid,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.subscriptions AS subscription
      WHERE subscription.id = subscription_id
        AND subscription.organization_id = nullif(
          current_setting('app.current_organization_id', true),
          ''
        )::uuid
    )
    AND public.giromesa_tenant_context_authorized(
      nullif(current_setting('app.current_organization_id', true), '')::uuid,
      nullif(current_setting('app.current_unit_id', true), '')::uuid
    )
  );
--> statement-breakpoint

ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.outbox_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT INSERT ON public.outbox_events TO giromesa_app;--> statement-breakpoint
GRANT SELECT, UPDATE ON public.outbox_events TO giromesa_worker;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outbox_events TO giromesa_legacy_transition;--> statement-breakpoint
CREATE POLICY giromesa_outbox_tenant_insert ON public.outbox_events
  AS PERMISSIVE FOR INSERT TO giromesa_app
  WITH CHECK (
    organization_id IS NOT NULL
    AND organization_id = nullif(current_setting('app.current_organization_id', true), '')::uuid
    AND (unit_id IS NULL OR unit_id = nullif(current_setting('app.current_unit_id', true), '')::uuid)
    AND public.giromesa_tenant_context_authorized(organization_id, unit_id)
  );--> statement-breakpoint
CREATE POLICY giromesa_outbox_worker ON public.outbox_events
  AS PERMISSIVE FOR ALL TO giromesa_worker USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY giromesa_outbox_legacy_transition ON public.outbox_events
  AS PERMISSIVE FOR ALL TO giromesa_legacy_transition USING (true) WITH CHECK (true);
--> statement-breakpoint

GRANT SELECT ON public.identities, public.membership_invitations TO giromesa_worker;--> statement-breakpoint
GRANT SELECT ON public.organizations, public.trials TO giromesa_worker;--> statement-breakpoint
CREATE POLICY giromesa_worker_maintenance_read ON public.organizations
  AS PERMISSIVE FOR SELECT TO giromesa_worker USING (true);--> statement-breakpoint
CREATE POLICY giromesa_worker_maintenance_read ON public.trials
  AS PERMISSIVE FOR SELECT TO giromesa_worker USING (true);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.identities,
  public.password_credentials,
  public.oauth_accounts,
  public.auth_sessions,
  public.password_reset_tokens,
  public.mfa_factors,
  public.mfa_challenges
TO giromesa_identity;--> statement-breakpoint
GRANT SELECT ON public.memberships, public.role_bindings, public.organizations, public.units,
  public.membership_invitations TO giromesa_identity;--> statement-breakpoint
GRANT INSERT, UPDATE ON public.membership_invitations TO giromesa_identity;--> statement-breakpoint
GRANT SELECT, INSERT ON public.organizations, public.legal_entities, public.units,
  public.memberships, public.role_bindings, public.onboarding_records TO giromesa_identity;--> statement-breakpoint
GRANT INSERT ON public.audit_events, public.outbox_events TO giromesa_identity;--> statement-breakpoint

CREATE POLICY giromesa_identity_scope ON public.memberships FOR SELECT TO giromesa_identity
  USING (identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY giromesa_identity_bootstrap ON public.memberships FOR INSERT TO giromesa_identity
  WITH CHECK (
    identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
    AND organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid
  );--> statement-breakpoint
CREATE POLICY giromesa_identity_scope ON public.organizations FOR SELECT TO giromesa_identity
  USING (
    id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM public.memberships AS own_membership
      WHERE own_membership.organization_id = id
        AND own_membership.identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
        AND own_membership.status = 'active'
    )
  );--> statement-breakpoint
CREATE POLICY giromesa_identity_bootstrap ON public.organizations FOR INSERT TO giromesa_identity
  WITH CHECK (nullif(current_setting('app.current_actor_identity_id', true), '')::uuid IS NOT NULL);--> statement-breakpoint
CREATE POLICY giromesa_identity_scope ON public.units FOR SELECT TO giromesa_identity
  USING (
    organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM public.memberships AS own_membership
      WHERE own_membership.organization_id = units.organization_id
        AND own_membership.identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
        AND own_membership.status = 'active'
    )
  );--> statement-breakpoint
CREATE POLICY giromesa_identity_bootstrap ON public.units FOR INSERT TO giromesa_identity
  WITH CHECK (organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY giromesa_identity_scope ON public.role_bindings FOR SELECT TO giromesa_identity
  USING (EXISTS (
    SELECT 1 FROM public.memberships AS own_membership
    WHERE own_membership.id = membership_id
      AND own_membership.identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
  ));--> statement-breakpoint
CREATE POLICY giromesa_identity_bootstrap ON public.role_bindings FOR INSERT TO giromesa_identity
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.memberships AS own_membership
    WHERE own_membership.id = membership_id
      AND own_membership.identity_id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
      AND own_membership.organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid
  ));--> statement-breakpoint
CREATE POLICY giromesa_identity_bootstrap ON public.legal_entities FOR ALL TO giromesa_identity
  USING (organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY giromesa_identity_bootstrap ON public.onboarding_records FOR ALL TO giromesa_identity
  USING (organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY giromesa_identity_audit_insert ON public.audit_events FOR INSERT TO giromesa_identity
  WITH CHECK (
    organization_id IS NULL
    OR organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid
  );--> statement-breakpoint
CREATE POLICY giromesa_identity_outbox_insert ON public.outbox_events FOR INSERT TO giromesa_identity
  WITH CHECK (
    (
      organization_id IS NULL AND unit_id IS NULL
      AND topic IN ('identity.registered', 'auth.password_reset_requested')
    )
    OR (
      organization_id = nullif(current_setting('app.bootstrap_organization_id', true), '')::uuid
      AND topic = 'organization.created'
    )
  );--> statement-breakpoint
CREATE POLICY giromesa_identity_invitation_accept ON public.membership_invitations
  FOR SELECT TO giromesa_identity
  USING (email = (
    SELECT own_identity.email FROM public.identities AS own_identity
    WHERE own_identity.id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
  ));--> statement-breakpoint
CREATE POLICY giromesa_identity_invitation_update ON public.membership_invitations
  FOR UPDATE TO giromesa_identity
  USING (email = (
    SELECT own_identity.email FROM public.identities AS own_identity
    WHERE own_identity.id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
  ))
  WITH CHECK (email = (
    SELECT own_identity.email FROM public.identities AS own_identity
    WHERE own_identity.id = nullif(current_setting('app.current_actor_identity_id', true), '')::uuid
  ));--> statement-breakpoint

GRANT SELECT ON public.commercial_catalog_versions, public.commercial_plans TO giromesa_public;--> statement-breakpoint
GRANT INSERT ON public.trial_applications, public.contact_requests, public.outbox_events TO giromesa_public;--> statement-breakpoint
CREATE POLICY giromesa_public_outbox_insert ON public.outbox_events FOR INSERT TO giromesa_public
  WITH CHECK (
    organization_id IS NULL AND unit_id IS NULL
    AND topic IN ('trial.application_created', 'contact.request_created')
  );
