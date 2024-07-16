CREATE OR REPLACE VIEW
  "quoteCustomerDetails"
WITH
  (SECURITY_INVOKER) AS
SELECT
  q.id as "quoteId",
  c.name as "customerName",
  ca."addressLine1" AS "customerAddressLine1",
  ca."addressLine2" AS "customerAddressLine2",
  ca."city" AS "customerCity",
  ca."state" AS "customerState",
  ca."postalCode" AS "customerPostalCode",
  ca."countryCode" AS "customerCountryCode"
FROM
  "quote" q
  LEFT OUTER JOIN "customer" c ON c.id = q."customerId"
  LEFT OUTER JOIN "customerLocation" cl on cl.id = q."customerLocationId"
  LEFT OUTER JOIN "address" ca ON ca.id = cl."addressId";