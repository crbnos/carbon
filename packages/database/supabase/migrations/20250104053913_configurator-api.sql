CREATE POLICY "Requests with an API can access quote payments" ON "quotePayment"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API can access quote shipments" ON "quoteShipment"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);

CREATE POLICY "Requests with an API can access external links" ON "externalLink"
FOR ALL USING (
  has_valid_api_key_for_company("companyId")
);