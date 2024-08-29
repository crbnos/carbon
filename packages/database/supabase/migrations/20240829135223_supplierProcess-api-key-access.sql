-- supplierProcess
CREATE POLICY "Requests with an API key can access supplier processes" ON "supplierProcess"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);