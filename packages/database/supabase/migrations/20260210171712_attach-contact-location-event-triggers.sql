-- Sync interceptor to update linked customer/supplier's updatedAt when contact or address changes
-- This triggers the existing event system to sync them to Xero

CREATE OR REPLACE FUNCTION sync_contact_to_parent(
  table_name TEXT,
  operation TEXT,
  new_data JSONB,
  old_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  contact_id TEXT;
BEGIN
  -- Skip if we're in a sync operation (prevents loops when pulling from Xero)
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  contact_id := COALESCE(new_data->>'id', old_data->>'id');
  
  -- Update customers linked to this contact
  UPDATE "customer" c
  SET "updatedAt" = NOW()
  FROM "customerContact" cc
  WHERE cc."contactId" = contact_id
    AND cc."customerId" = c.id;

  -- Update suppliers linked to this contact
  UPDATE "supplier" s
  SET "updatedAt" = NOW()
  FROM "supplierContact" sc
  WHERE sc."contactId" = contact_id
    AND sc."supplierId" = s.id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_address_to_parent(
  table_name TEXT,
  operation TEXT,
  new_data JSONB,
  old_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  address_id TEXT;
BEGIN
  -- Skip if we're in a sync operation (prevents loops when pulling from Xero)
  IF current_setting('app.sync_in_progress', true) = 'true' THEN
    RETURN;
  END IF;

  address_id := COALESCE(new_data->>'id', old_data->>'id');
  
  -- Update customers linked to this address via customerLocation
  UPDATE "customer" c
  SET "updatedAt" = NOW()
  FROM "customerLocation" cl
  WHERE cl."addressId" = address_id
    AND cl."customerId" = c.id;

  -- Update suppliers linked to this address via supplierLocation
  UPDATE "supplier" s
  SET "updatedAt" = NOW()
  FROM "supplierLocation" sl
  WHERE sl."addressId" = address_id
    AND sl."supplierId" = s.id;
END;
$$;

-- Attach sync interceptors to contact and address tables
SELECT attach_event_trigger('contact', ARRAY['sync_contact_to_parent']);
SELECT attach_event_trigger('address', ARRAY['sync_address_to_parent']);
