-- Require a reachable contact AND an identifiable location on a supplier /
-- customer before its documents post.
--
-- A spend platform cannot create a vendor without BOTH. Verified field-by-field
-- against the Ramp sandbox on 2026-09-28 (`POST /developer/v1/vendors`):
--
--   * no `country`                  -> 422 {"country": ["Missing data for required field."]}
--   * no `business_vendor_contacts` -> 422 {"business_vendor_contacts": ["Missing data for required field."]}
--   * a contact carrying no email   -> 422 {"business_vendor_contacts": {"email": [...]}}
--   * country US with no state      -> 400 DEVELOPER_7080 "State is required for US"
--   * email + US + state VA         -> 200 created
--   * email + GB, no state          -> 200 created
--
-- So the contact email and the country are both hard requirements, and a US
-- address additionally needs a two-letter state. In Carbon the country and state
-- live on the ADDRESS behind a `supplierLocation` / `customerLocation` row — a
-- party with no location has no country, so every bill for it is rejected at
-- push time, long after the person who could have fixed it moved on.
--
-- ONE setting per party kind rather than two, because the platform needs all of
-- it or none of it: a supplier with a contact but no location fails exactly as
-- hard as one with neither, so splitting the toggle would only create a
-- half-enabled state that still fails.
--
-- Both default FALSE, and are turned on by connecting an integration that
-- declares it cannot create a counterpart without them (see
-- `packages/ee/src/sync/party-contact.ts`). The sales column exists for symmetry
-- -- `companySettings` already pairs `accountsPayable*`/`accountsReceivable*`
-- and `defaultSupplierCc`/`defaultCustomerCc` -- and because a customer-side
-- requirement is a reasonable policy to want. Nothing downstream forces it
-- today: Rillet, Xero and QuickBooks all treat a customer email as optional. So
-- it ships off, and stays off until someone asks for it.

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireSupplierContactAndLocation" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "companySettings"
  ADD COLUMN IF NOT EXISTS "requireCustomerContactAndLocation" BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN "companySettings"."requireSupplierContactAndLocation" IS
  'When true, a supplier must have at least one contact with an email address AND at least one location whose address carries a country (plus a state when that country is US) before its purchase orders, supplier quotes and purchase invoices can be released or posted.';

COMMENT ON COLUMN "companySettings"."requireCustomerContactAndLocation" IS
  'When true, a customer must have at least one contact with an email address AND at least one location whose address carries a country (plus a state when that country is US) before its quotes, sales orders and sales invoices can be released or posted.';
