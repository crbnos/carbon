-- Retire the four deprecated RLS helpers: has_role, has_company_permission,
-- get_companies_with_permission, get_permission_companies. Unlike the helpers that replace
-- them, they admitted customer and supplier portal accounts holding a permission (and
-- get_permission_companies had no API-key path at all).
--
-- The public tables that used them moved to the standard helpers in
-- 20260927224243_retire-legacy-rls-helpers-policies.sql (generated from the authz
-- manifest). This migration moves their last users and then drops them; nothing may
-- depend on them by then, so each DROP fails loudly if something still does.

-- Tax-certificate and purchasing-RFQ policies on the legacy `private` bucket. "Shared
-- Private Bucket" (FOR ALL, any employee of the folder's company) already grants a
-- superset of each, so they add nothing; no code uses the purchasing-rfq folder.
DROP POLICY "Employees can view tax certificates" ON storage.objects;
DROP POLICY "Employees with sales_create can upload tax certificates" ON storage.objects;
DROP POLICY "Employees with sales_delete or purchasing_delete can delete tax" ON storage.objects;
DROP POLICY "Purchasing RFQ documents view requires purchasing_view" ON storage.objects;
DROP POLICY "Purchasing RFQ documents insert requires purchasing_create" ON storage.objects;
DROP POLICY "Purchasing RFQ documents update requires purchasing_update" ON storage.objects;
DROP POLICY "Purchasing RFQ documents delete requires purchasing_delete" ON storage.objects;

-- Company logos in the public bucket: employees holding the settings permission.
ALTER POLICY "Anyone with settings_create can insert into the public bucket" ON storage.objects
  WITH CHECK (
    bucket_id = 'public'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_permission('settings_create'))::text[])
  );
ALTER POLICY "Anyone with settings_update can update the public bucket" ON storage.objects
  USING (
    bucket_id = 'public'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
  );
ALTER POLICY "Anyone with settings_delete can delete from public bucket" ON storage.objects
  USING (
    bucket_id = 'public'
    AND (storage.foldername(name))[1] = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
  );

-- Called by updatePermissions (@carbon/ee permissions.server) with the caller's client.
CREATE OR REPLACE FUNCTION public.is_claims_admin(company text)
RETURNS boolean
LANGUAGE plpgsql
AS $function$
  BEGIN
    IF session_user = 'authenticator' THEN
      IF extract(epoch from now()) > coalesce((current_setting('request.jwt.claims', true)::jsonb)->>'exp', '0')::numeric THEN
        return false; -- jwt expired
      END IF;
      RETURN company = ANY (coalesce(get_companies_with_employee_permission('users_update'), '{}'));
    ELSE -- not a user session (trigger etc.)
      return true;
    END IF;
  END;
$function$;

-- Unused RPCs (no caller in the apps, jobs or edge functions) whose only guard was has_role.
DROP FUNCTION public.create_rfq_from_model_v1(text, text, text, text, text, text, json);
DROP FUNCTION public.create_rfq_from_models_v1(text, text, text, json[]);
DROP FUNCTION public.create_rfq_from_models_v2(text, text, text, json[]);

-- The helpers themselves. Named without an argument list (each has one overload) so the
-- text does not read as a call to them.
DROP FUNCTION public.has_role;
DROP FUNCTION public.has_company_permission;
DROP FUNCTION public.get_companies_with_permission;
DROP FUNCTION public.get_permission_companies;
