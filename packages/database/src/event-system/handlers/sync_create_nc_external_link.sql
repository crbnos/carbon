CREATE OR REPLACE FUNCTION public.sync_create_nc_external_link(p_table text, p_operation text, p_new jsonb, p_old jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_external_link_id UUID;
BEGIN
  IF p_operation != 'INSERT' THEN RETURN; END IF;

  INSERT INTO "externalLink" ("documentType", "documentId", "companyId")
  VALUES ('Non-Conformance Supplier', p_new->>'id', p_new->>'companyId')
  ON CONFLICT ("documentId", "documentType", "companyId") DO UPDATE SET
    "documentType" = EXCLUDED."documentType"
  RETURNING "id" INTO v_external_link_id;

  UPDATE "nonConformanceSupplier"
  SET "externalLinkId" = v_external_link_id
  WHERE "id" = p_new->>'id';
END;
$function$;
