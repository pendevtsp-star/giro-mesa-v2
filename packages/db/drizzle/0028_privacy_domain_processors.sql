CREATE FUNCTION public.giromesa_privacy_reference_inventory(
  p_organization_id uuid,
  p_subject_identity_id uuid,
  p_domain varchar
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  reference record;
  matched_rows bigint;
  result jsonb := '[]'::jsonb;
BEGIN
  IF p_domain NOT IN ('operations', 'management_finance', 'growth_crm', 'objects_media', 'offline_edge') THEN
    RAISE EXCEPTION 'PRIVACY_DOMAIN_INVALID' USING ERRCODE = '22023';
  END IF;

  FOR reference IN
    SELECT DISTINCT relation.relname AS table_name, attribute.attname AS column_name
    FROM pg_constraint constraint_record
    JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace_record ON namespace_record.oid = relation.relnamespace
    JOIN unnest(constraint_record.conkey) WITH ORDINALITY AS key_column(attnum, ordinal) ON true
    JOIN pg_attribute attribute
      ON attribute.attrelid = relation.oid AND attribute.attnum = key_column.attnum
    WHERE constraint_record.contype = 'f'
      AND constraint_record.confrelid = 'public.identities'::regclass
      AND namespace_record.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM pg_attribute tenant_column
        WHERE tenant_column.attrelid = relation.oid
          AND tenant_column.attname = 'organization_id'
          AND NOT tenant_column.attisdropped
      )
      AND CASE p_domain
        WHEN 'operations' THEN
          relation.relname ~ '^(pos_|service_|area_|table_|salon_|dispatch_|production_)'
          AND relation.relname NOT LIKE 'table_service_%'
          AND relation.relname <> 'staff_presence_leases'
        WHEN 'management_finance' THEN
          relation.relname ~ '^(financial_|payment_|fiscal_|management_|remuneration_)'
        WHEN 'growth_crm' THEN
          relation.relname ~ '^(growth_|customer_|loyalty_|coupon_|marketing_|campaign_|reservation|waitlist_|delivery_|inventory_transfer_|public_api_|webhook_|public_menu_|table_service_)'
          AND relation.relname <> 'public_menu_media_assets'
        WHEN 'objects_media' THEN relation.relname = 'public_menu_media_assets'
        WHEN 'offline_edge' THEN relation.relname = 'staff_presence_leases'
        ELSE false
      END
    ORDER BY relation.relname, attribute.attname
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I WHERE organization_id = $1 AND %I = $2',
      reference.table_name,
      reference.column_name
    ) INTO matched_rows USING p_organization_id, p_subject_identity_id;

    IF matched_rows > 0 THEN
      result := result || jsonb_build_array(jsonb_build_object(
        'table', reference.table_name,
        'roleColumn', reference.column_name,
        'recordCount', matched_rows
      ));
    END IF;
  END LOOP;

  RETURN result;
END
$$;
--> statement-breakpoint

CREATE FUNCTION public.giromesa_privacy_export_domain(
  p_organization_id uuid,
  p_request_id uuid,
  p_attempt integer,
  p_domain varchar
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  subject_id uuid;
  subject_email varchar;
  result jsonb;
BEGIN
  SELECT request.subject_identity_id, identity.email
  INTO subject_id, subject_email
  FROM public.privacy_requests request
  JOIN public.identities identity ON identity.id = request.subject_identity_id
  WHERE request.organization_id = p_organization_id
    AND request.id = p_request_id
    AND request.state = 'processing'
    AND request.attempts = p_attempt;

  IF subject_id IS NULL THEN
    RAISE EXCEPTION 'PRIVACY_PROCESSING_CONTEXT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_domain IN ('operations', 'management_finance') THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'personalReferences', public.giromesa_privacy_reference_inventory(
        p_organization_id,
        subject_id,
        p_domain
      )
    );
  END IF;

  IF p_domain = 'growth_crm' THEN
    SELECT jsonb_build_object(
      'schemaVersion', 1,
      'profiles', COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
        'id', customer.id,
        'defaultUnitId', customer.default_unit_id,
        'name', customer.name,
        'email', customer.email,
        'phone', customer.phone,
        'birthDate', customer.birth_date,
        'marketingOptIn', customer.marketing_opt_in,
        'archivedAt', customer.archived_at,
        'createdAt', customer.created_at,
        'updatedAt', customer.updated_at
      )) FILTER (WHERE customer.id IS NOT NULL), '[]'::jsonb),
      'consents', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', consent.id,
          'customerId', consent.customer_id,
          'purpose', consent.purpose,
          'decision', consent.decision,
          'channel', consent.channel,
          'source', consent.source,
          'legalBasis', consent.legal_basis,
          'policyVersion', consent.policy_version,
          'occurredAt', consent.occurred_at
        ) ORDER BY consent.occurred_at)
        FROM public.growth_customer_consents consent
        WHERE consent.organization_id = p_organization_id
          AND consent.customer_id IN (
            SELECT id FROM public.growth_customers
            WHERE organization_id = p_organization_id AND lower(email) = lower(subject_email)
          )
      ), '[]'::jsonb),
      'loyaltyEntries', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', entry.id,
          'unitId', entry.unit_id,
          'programId', entry.program_id,
          'customerId', entry.customer_id,
          'sourceRef', entry.source_ref,
          'type', entry.type,
          'amount', entry.amount,
          'description', entry.description,
          'reversalOfId', entry.reversal_of_id,
          'expiresAt', entry.expires_at,
          'createdAt', entry.created_at
        ) ORDER BY entry.created_at)
        FROM public.growth_loyalty_ledger entry
        WHERE entry.organization_id = p_organization_id
          AND entry.customer_id IN (
            SELECT id FROM public.growth_customers
            WHERE organization_id = p_organization_id AND lower(email) = lower(subject_email)
          )
      ), '[]'::jsonb),
      'reservations', COALESCE((
        SELECT jsonb_agg(to_jsonb(reservation) - ARRAY['idempotency_key', 'request_fingerprint'])
        FROM public.growth_reservations reservation
        WHERE reservation.organization_id = p_organization_id
          AND reservation.customer_id IN (
            SELECT id FROM public.growth_customers
            WHERE organization_id = p_organization_id AND lower(email) = lower(subject_email)
          )
      ), '[]'::jsonb),
      'waitlistEntries', COALESCE((
        SELECT jsonb_agg(to_jsonb(waitlist) - ARRAY['idempotency_key', 'request_fingerprint'])
        FROM public.growth_waitlist_entries waitlist
        WHERE waitlist.organization_id = p_organization_id
          AND waitlist.customer_id IN (
            SELECT id FROM public.growth_customers
            WHERE organization_id = p_organization_id AND lower(email) = lower(subject_email)
          )
      ), '[]'::jsonb),
      'deliveryOrders', COALESCE((
        SELECT jsonb_agg(to_jsonb(delivery) - ARRAY['idempotency_key', 'request_fingerprint'])
        FROM public.growth_delivery_orders delivery
        WHERE delivery.organization_id = p_organization_id
          AND delivery.customer_id IN (
            SELECT id FROM public.growth_customers
            WHERE organization_id = p_organization_id AND lower(email) = lower(subject_email)
          )
      ), '[]'::jsonb),
      'personalReferences', public.giromesa_privacy_reference_inventory(
        p_organization_id,
        subject_id,
        p_domain
      )
    ) INTO result
    FROM public.growth_customers customer
    WHERE customer.organization_id = p_organization_id
      AND lower(customer.email) = lower(subject_email);

    RETURN COALESCE(result, jsonb_build_object(
      'schemaVersion', 1,
      'profiles', '[]'::jsonb,
      'consents', '[]'::jsonb,
      'loyaltyEntries', '[]'::jsonb,
      'reservations', '[]'::jsonb,
      'waitlistEntries', '[]'::jsonb,
      'deliveryOrders', '[]'::jsonb,
      'personalReferences', public.giromesa_privacy_reference_inventory(
        p_organization_id,
        subject_id,
        p_domain
      )
    ));
  END IF;

  IF p_domain = 'objects_media' THEN
    SELECT jsonb_build_object(
      'schemaVersion', 1,
      'ownership', 'tenant_business_content',
      'externalDeletionClaimed', false,
      'assets', COALESCE(jsonb_agg(jsonb_build_object(
        'id', asset.id,
        'unitId', asset.unit_id,
        'kind', asset.kind,
        'sha256', asset.sha256,
        'storageKey', asset.storage_key,
        'mimeType', asset.mime_type,
        'width', asset.width,
        'height', asset.height,
        'byteSize', asset.byte_size,
        'createdAt', asset.created_at
      )) FILTER (WHERE asset.id IS NOT NULL), '[]'::jsonb)
    ) INTO result
    FROM public.public_menu_media_assets asset
    WHERE asset.organization_id = p_organization_id
      AND asset.created_by_identity_id = subject_id;
    RETURN COALESCE(result, jsonb_build_object(
      'schemaVersion', 1,
      'ownership', 'tenant_business_content',
      'externalDeletionClaimed', false,
      'assets', '[]'::jsonb
    ));
  END IF;

  IF p_domain = 'offline_edge' THEN
    SELECT jsonb_build_object(
      'schemaVersion', 1,
      'commands', COALESCE(jsonb_agg(jsonb_build_object(
        'commandId', command.command_id,
        'unitId', command.unit_id,
        'deviceId', command.device_id,
        'commandType', command.command_type,
        'aggregateType', command.aggregate_type,
        'aggregateId', command.aggregate_id,
        'occurredAt', command.occurred_at,
        'receivedAt', command.received_at,
        'status', command.status
      ) ORDER BY command.received_at) FILTER (WHERE command.command_id IS NOT NULL), '[]'::jsonb),
      'personalReferences', public.giromesa_privacy_reference_inventory(
        p_organization_id,
        subject_id,
        p_domain
      )
    ) INTO result
    FROM public.command_inbox command
    WHERE command.organization_id = p_organization_id
      AND command.actor_identity_id = subject_id;
    RETURN COALESCE(result, jsonb_build_object(
      'schemaVersion', 1,
      'commands', '[]'::jsonb,
      'personalReferences', public.giromesa_privacy_reference_inventory(
        p_organization_id,
        subject_id,
        p_domain
      )
    ));
  END IF;

  IF p_domain = 'backups' THEN
    RETURN jsonb_build_object(
      'schemaVersion', 1,
      'liveStore', false,
      'duplicateDataIncluded', false,
      'externalDeletionClaimed', false,
      'retentionPolicyStatus', 'legal_approval_required'
    );
  END IF;

  RAISE EXCEPTION 'PRIVACY_DOMAIN_INVALID' USING ERRCODE = '22023';
END
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.giromesa_privacy_reference_inventory(uuid, uuid, varchar)
  FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public,
    giromesa_internal, giromesa_legacy_transition;
REVOKE ALL ON FUNCTION public.giromesa_privacy_export_domain(uuid, uuid, integer, varchar)
  FROM PUBLIC, giromesa_app, giromesa_worker, giromesa_identity, giromesa_public,
    giromesa_internal, giromesa_legacy_transition;
--> statement-breakpoint

GRANT EXECUTE ON FUNCTION public.giromesa_privacy_export_domain(uuid, uuid, integer, varchar)
  TO giromesa_worker;
