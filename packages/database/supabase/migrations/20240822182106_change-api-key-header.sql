-- Change the request header from api-key to carbon-key
CREATE OR REPLACE FUNCTION has_valid_api_key_for_company(company TEXT) RETURNS "bool"
  LANGUAGE "plpgsql" SECURITY DEFINER
  AS $$
  DECLARE
    has_valid_key boolean;
  BEGIN
    SELECT EXISTS(SELECT 1 FROM "apiKey" WHERE "key" = ((current_setting('request.headers'::text, true))::json ->> 'carbon-key'::text) AND "companyId" = company) INTO has_valid_key;
    RETURN has_valid_key;
  END;
$$;

-- Change the request header from api-key to carbon-key
CREATE OR REPLACE FUNCTION get_company_id_from_api_key() RETURNS TEXT
  LANGUAGE "plpgsql" SECURITY DEFINER
  AS $$
  DECLARE
      company_id TEXT;
  BEGIN
      SELECT "companyId" INTO company_id FROM "apiKey" WHERE "key" = ((current_setting('request.headers'::text, true))::json ->> 'carbon-key'::text);
      RETURN company_id;
  END;
$$;