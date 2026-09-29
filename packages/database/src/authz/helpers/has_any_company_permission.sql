CREATE OR REPLACE FUNCTION public.has_any_company_permission(claim text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    DECLARE
      permission_value text[];
    BEGIN
      
      SELECT jsonb_to_text_array(coalesce(permissions->claim, '[]')) INTO permission_value FROM public."userPermission" WHERE id = auth.uid()::text;
      IF permission_value IS NULL THEN
        return false;
      ELSIF array_length(permission_value, 1) > 0 THEN
        return true;
      ELSE
        return false;
      END IF;
    END;
$function$;
