

CREATE OR REPLACE FUNCTION is_claims_admin() RETURNS "bool"
  LANGUAGE "plpgsql" 
  AS $$
  BEGIN
    IF session_user = 'authenticator' THEN
      --------------------------------------------
      -- To disallow any authenticated app users
      -- from editing claims, delete the following
      -- block of code and replace it with:
      -- RETURN FALSE;
      --------------------------------------------
      IF extract(epoch from now()) > coalesce((current_setting('request.jwt.claims', true)::jsonb)->>'exp', '0')::numeric THEN
        return false; -- jwt expired
      END IF; 
      
      IF has_company_permission('update_users', '0') THEN
        return true; -- user has user_update set to true
      ELSE
        return false; -- user does NOT have user_update set to true
      END IF;
      --------------------------------------------
      -- End of block 
      --------------------------------------------
    ELSE -- not a user session, probably being called from a trigger or something
      return true;
    END IF;
  END;
$$;

CREATE OR REPLACE FUNCTION get_my_permission(claim text) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE permissions jsonb;
    BEGIN
      select coalesce(permissions->claim, null) from public."userPermission" into permissions where id = auth.uid()::text;
        return permissions;
      
    END;
$$;


CREATE OR REPLACE FUNCTION get_my_claim(claim text) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE claims jsonb;
    BEGIN
      -- TODO: we should be able to use (current_setting('request.jwt.claims', true)::jsonb)->'app_metadata'
      select coalesce(raw_app_meta_data->claim, null) from auth.users into claims where id = auth.uid();
        return claims;
      
    END;
$$;

CREATE OR REPLACE FUNCTION jsonb_to_text_array(jsonb) RETURNS text[]
    LANGUAGE "sql" IMMUTABLE
    AS $$
    SELECT array_agg(value::text) FROM jsonb_array_elements_text($1) AS t(value);
$$;


CREATE OR REPLACE FUNCTION get_permission_companies(claim text) RETURNS text[]
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE retval text[];
    BEGIN
      -- TODO: (current_setting('request.jwt.claims', true)::jsonb)->'app_metadata'->
      select jsonb_to_text_array(coalesce(permissions->claim, '[]')) from public."userPermission" into retval where id = auth.uid()::text;
        return retval;
      
    END;
$$;

CREATE OR REPLACE FUNCTION has_role(required_role text, company text) RETURNS "bool"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE
      user_role text;
    BEGIN
      SELECT role INTO user_role FROM public."userToCompany" WHERE "userId" = auth.uid()::text AND "companyId" = company;
      return user_role = required_role;
    END;
$$;

CREATE OR REPLACE FUNCTION has_company_permission(claim text, company text) RETURNS "bool"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE
      permission_value text[];
    BEGIN
      -- TODO: (current_setting('request.jwt.claims', true)::jsonb)->'app_metadata'->claim
      SELECT jsonb_to_text_array(coalesce(permissions->claim, '[]')) INTO permission_value FROM public."userPermission" WHERE id = auth.uid()::text;
      IF permission_value IS NULL THEN
        return false;
      ELSIF '0' = ANY(permission_value::text[]) THEN
        return true;
      ELSIF company = ANY(permission_value::text[]) THEN
        return true;
      ELSE
        return false;
      END IF;
    END;
$$;

CREATE OR REPLACE FUNCTION has_any_company_permission(claim text) RETURNS "bool"
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION get_company_id_from_foreign_key(foreign_key TEXT, tbl TEXT) RETURNS text
    LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
    AS $$
    DECLARE
      company_id text;
    BEGIN
      EXECUTE 'SELECT "companyId" FROM "' || tbl || '" WHERE id = $1' INTO company_id USING foreign_key;
      RETURN company_id;
    END;
$$;

CREATE OR REPLACE FUNCTION get_claims(uid text, company text) RETURNS "jsonb"
  LANGUAGE "plpgsql" SECURITY DEFINER SET search_path = public
  AS $$
  DECLARE company_role text;
  DECLARE role_object jsonb;
  DECLARE perms jsonb;
  BEGIN
    select role from "userToCompany" into company_role where "userId" = uid AND "companyId" = company;
    select permissions from "userPermission" into perms where id = uid;
    role_object := jsonb_build_object('role', company_role);


    return (role_object || perms)::jsonb;
  END;
$$;



NOTIFY pgrst, 'reload schema';