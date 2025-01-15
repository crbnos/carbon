DO $$
DECLARE
  r RECORD;
  current_permissions jsonb;
  key TEXT;
  new_permissions jsonb;
BEGIN
  FOR r IN SELECT id, permissions as current_perms FROM "userPermission"
  LOOP
    current_permissions := r.current_perms;
    new_permissions := '{}'::jsonb;
    
    FOR key IN SELECT jsonb_object_keys(current_permissions)
    LOOP
      -- Only keep keys that don't start with uppercase letter
      IF NOT key ~ '^[A-Z]'
      THEN
        new_permissions := new_permissions || jsonb_build_object(key, current_permissions->key);
      END IF;
    END LOOP;

    -- Update the record with filtered permissions
    UPDATE "userPermission" 
    SET permissions = new_permissions
    WHERE id = r.id;
  END LOOP;
END $$;
