-- Change the primary key of the 'country' table to 'alpha2'

-- Drop the views that reference the address table's countryCode column
DROP VIEW IF EXISTS "purchaseOrderLocations";
DROP VIEW IF EXISTS "quoteCustomerDetails";
DROP VIEW IF EXISTS "salesOrderLocations";

-- Remove the 'code' column
ALTER TABLE "country" DROP COLUMN IF EXISTS "code";

-- Add 'alpha2' and 'alpha3' columns
ALTER TABLE "country" ADD COLUMN "alpha2" CHAR(2);
ALTER TABLE "country" ADD COLUMN "alpha3" CHAR(3);

-- Add the new primary key constraint on the 'alpha2' column and update the address table accordingly
ALTER TABLE "address" DROP CONSTRAINT IF EXISTS "address_countryCode_fkey";
ALTER TABLE "country" DROP CONSTRAINT IF EXISTS "country_pkey";
ALTER TABLE "country" ADD PRIMARY KEY ("alpha2");
ALTER TABLE "country" DROP COLUMN IF EXISTS "id";
UPDATE "address" SET "countryCode" = NULL;
ALTER TABLE "address" ALTER COLUMN "countryCode" TYPE TEXT;
ALTER TABLE "address" ADD CONSTRAINT "address_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "country"("alpha2") ON DELETE SET NULL ON UPDATE CASCADE;

-- Make 'alpha3' NOT NULL and add a unique constraint
ALTER TABLE "country" ALTER COLUMN "alpha3" SET NOT NULL;
ALTER TABLE "country" ADD CONSTRAINT "country_alpha3_unique" UNIQUE ("alpha3");

-- Rename the 'state' column to 'stateProvince'
ALTER TABLE "address" RENAME COLUMN "state" TO "stateProvince";
ALTER TABLE "location" RENAME COLUMN "state" TO "stateProvince";
ALTER TABLE "company" RENAME COLUMN "state" TO "stateProvince";

-- Recreate the purchaseOrderLocations view
CREATE OR REPLACE VIEW "purchaseOrderLocations" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    po.id,
    s.name AS "supplierName",
    sa."addressLine1" AS "supplierAddressLine1",
    sa."addressLine2" AS "supplierAddressLine2",
    sa."city" AS "supplierCity",
    sa."stateProvince" AS "supplierStateProvince",
    sa."postalCode" AS "supplierPostalCode",
    sa."countryCode" AS "supplierCountryCode",
    dl.name AS "deliveryName",
    dl."addressLine1" AS "deliveryAddressLine1",
    dl."addressLine2" AS "deliveryAddressLine2",
    dl."city" AS "deliveryCity",
    dl."stateProvince" AS "deliveryStateProvince",
    dl."postalCode" AS "deliveryPostalCode",
    dl."countryCode" AS "deliveryCountryCode",
    pod."dropShipment",
    c.name AS "customerName",
    ca."addressLine1" AS "customerAddressLine1",
    ca."addressLine2" AS "customerAddressLine2",
    ca."city" AS "customerCity",
    ca."stateProvince" AS "customerStateProvince",
    ca."postalCode" AS "customerPostalCode",
    ca."countryCode" AS "customerCountryCode"
  FROM "purchaseOrder" po 
  LEFT OUTER JOIN "supplier" s 
    ON s.id = po."supplierId"
  LEFT OUTER JOIN "supplierLocation" sl
    ON sl.id = po."supplierLocationId"
  LEFT OUTER JOIN "address" sa
    ON sa.id = sl."addressId"
  INNER JOIN "purchaseOrderDelivery" pod 
    ON pod.id = po.id 
  LEFT OUTER JOIN "location" dl
    ON dl.id = pod."locationId"
  LEFT OUTER JOIN "customer" c
    ON c.id = pod."customerId"
  LEFT OUTER JOIN "customerLocation" cl
    ON cl.id = pod."customerLocationId"
  LEFT OUTER JOIN "address" ca
    ON ca.id = cl."addressId";

-- Recreate the quoteCustomerDetails view
CREATE OR REPLACE VIEW "quoteCustomerDetails" WITH(SECURITY_INVOKER=true) AS
SELECT
  q.id as "quoteId",
  c.name as "customerName",
  ca."addressLine1" AS "customerAddressLine1",
  ca."addressLine2" AS "customerAddressLine2",
  ca."city" AS "customerCity",
  ca."stateProvince" AS "customerStateProvince",
  ca."postalCode" AS "customerPostalCode",
  ca."countryCode" AS "customerCountryCode"
FROM
  "quote" q
  LEFT OUTER JOIN "customer" c ON c.id = q."customerId"
  LEFT OUTER JOIN "customerLocation" cl on cl.id = q."customerLocationId"
  LEFT OUTER JOIN "address" ca ON ca.id = cl."addressId";

  -- Recreate the salesOrderLocations view
  CREATE OR REPLACE VIEW "salesOrderLocations" WITH(SECURITY_INVOKER=true) AS
  SELECT 
    so.id,
    c.name AS "customerName",
    ca."addressLine1" AS "customerAddressLine1",
    ca."addressLine2" AS "customerAddressLine2",
    ca."city" AS "customerCity",
    ca."stateProvince" AS "customerStateProvince",
    ca."postalCode" AS "customerPostalCode",
    ca."countryCode" AS "customerCountryCode",
    pc.name AS "paymentCustomerName",
    pa."addressLine1" AS "paymentAddressLine1",
    pa."addressLine2" AS "paymentAddressLine2",
    pa."city" AS "paymentCity",
    pa."stateProvince" AS "paymentStateProvince",
    pa."postalCode" AS "paymentPostalCode",
    pa."countryCode" AS "paymentCountryCode"
  FROM "salesOrder" so 
  INNER JOIN "customer" c 
    ON c.id = so."customerId"
  LEFT OUTER JOIN "customerLocation" cl
    ON cl.id = so."customerLocationId"
  LEFT OUTER JOIN "address" ca
    ON ca.id = cl."addressId"
  LEFT OUTER JOIN "salesOrderPayment" sop
    ON sop.id = so.id
  LEFT OUTER JOIN "customer" pc
    ON pc.id = sop."invoiceCustomerId"
  LEFT OUTER JOIN "customerLocation" pl
    ON pl.id = sop."invoiceCustomerLocationId"
  LEFT OUTER JOIN "address" pa
    ON pa.id = pl."addressId";

-- Insert the country code data
INSERT INTO "country" ("name", "alpha2", "alpha3") VALUES
('Afghanistan', 'AF', 'AFG'),
('Albania', 'AL', 'ALB'),
('Algeria', 'DZ', 'DZA'),
('Andorra', 'AD', 'AND'),
('Angola', 'AO', 'AGO'),
('Antigua and Barbuda', 'AG', 'ATG'),
('Argentina', 'AR', 'ARG'),
('Armenia', 'AM', 'ARM'),
('Australia', 'AU', 'AUS'),
('Austria', 'AT', 'AUT'),
('Azerbaijan', 'AZ', 'AZE'),
('Bahamas', 'BS', 'BHS'),
('Bahrain', 'BH', 'BHR'),
('Bangladesh', 'BD', 'BGD'),
('Barbados', 'BB', 'BRB'),
('Belarus', 'BY', 'BLR'),
('Belgium', 'BE', 'BEL'),
('Belize', 'BZ', 'BLZ'),
('Benin', 'BJ', 'BEN'),
('Bhutan', 'BT', 'BTN'),
('Bolivia', 'BO', 'BOL'),
('Bosnia and Herzegovina', 'BA', 'BIH'),
('Botswana', 'BW', 'BWA'),
('Brazil', 'BR', 'BRA'),
('Brunei', 'BN', 'BRN'),
('Bulgaria', 'BG', 'BGR'),
('Burkina Faso', 'BF', 'BFA'),
('Burundi', 'BI', 'BDI'),
('Cambodia', 'KH', 'KHM'),
('Cameroon', 'CM', 'CMR'),
('Canada', 'CA', 'CAN'),
('Cape Verde', 'CV', 'CPV'),
('Central African Republic', 'CF', 'CAF'),
('Chad', 'TD', 'TCD'),
('Chile', 'CL', 'CHL'),
('China', 'CN', 'CHN'),
('Colombia', 'CO', 'COL'),
('Comoros', 'KM', 'COM'),
('Congo', 'CG', 'COG'),
('Costa Rica', 'CR', 'CRI'),
('Croatia', 'HR', 'HRV'),
('Cuba', 'CU', 'CUB'),
('Cyprus', 'CY', 'CYP'),
('Czech Republic', 'CZ', 'CZE'),
('Democratic Republic of the Congo', 'CD', 'COD'),
('Denmark', 'DK', 'DNK'),
('Djibouti', 'DJ', 'DJI'),
('Dominica', 'DM', 'DMA'),
('Dominican Republic', 'DO', 'DOM'),
('East Timor', 'TL', 'TLS'),
('Ecuador', 'EC', 'ECU'),
('Egypt', 'EG', 'EGY'),
('El Salvador', 'SV', 'SLV'),
('Equatorial Guinea', 'GQ', 'GNQ'),
('Eritrea', 'ER', 'ERI'),
('Estonia', 'EE', 'EST'),
('Ethiopia', 'ET', 'ETH'),
('Fiji', 'FJ', 'FJI'),
('Finland', 'FI', 'FIN'),
('France', 'FR', 'FRA'),
('Gabon', 'GA', 'GAB'),
('Gambia', 'GM', 'GMB'),
('Georgia', 'GE', 'GEO'),
('Germany', 'DE', 'DEU'),
('Ghana', 'GH', 'GHA'),
('Greece', 'GR', 'GRC'),
('Grenada', 'GD', 'GRD'),
('Guatemala', 'GT', 'GTM'),
('Guinea', 'GN', 'GIN'),
('Guinea-Bissau', 'GW', 'GNB'),
('Guyana', 'GY', 'GUY'),
('Haiti', 'HT', 'HTI'),
('Honduras', 'HN', 'HND'),
('Hungary', 'HU', 'HUN'),
('Iceland', 'IS', 'ISL'),
('India', 'IN', 'IND'),
('Indonesia', 'ID', 'IDN'),
('Iran', 'IR', 'IRN'),
('Iraq', 'IQ', 'IRQ'),
('Ireland', 'IE', 'IRL'),
('Israel', 'IL', 'ISR'),
('Italy', 'IT', 'ITA'),
('Ivory Coast', 'CI', 'CIV'),
('Jamaica', 'JM', 'JAM'),
('Japan', 'JP', 'JPN'),
('Jordan', 'JO', 'JOR'),
('Kazakhstan', 'KZ', 'KAZ'),
('Kenya', 'KE', 'KEN'),
('Kiribati', 'KI', 'KIR'),
('Kuwait', 'KW', 'KWT'),
('Kyrgyzstan', 'KG', 'KGZ'),
('Laos', 'LA', 'LAO'),
('Latvia', 'LV', 'LVA'),
('Lebanon', 'LB', 'LBN'),
('Lesotho', 'LS', 'LSO'),
('Liberia', 'LR', 'LBR'),
('Libya', 'LY', 'LBY'),
('Liechtenstein', 'LI', 'LIE'),
('Lithuania', 'LT', 'LTU'),
('Luxembourg', 'LU', 'LUX'),
('Madagascar', 'MG', 'MDG'),
('Malawi', 'MW', 'MWI'),
('Malaysia', 'MY', 'MYS'),
('Maldives', 'MV', 'MDV'),
('Mali', 'ML', 'MLI'),
('Malta', 'MT', 'MLT'),
('Marshall Islands', 'MH', 'MHL'),
('Mauritania', 'MR', 'MRT'),
('Mauritius', 'MU', 'MUS'),
('Mexico', 'MX', 'MEX'),
('Micronesia', 'FM', 'FSM'),
('Moldova', 'MD', 'MDA'),
('Monaco', 'MC', 'MCO'),
('Mongolia', 'MN', 'MNG'),
('Montenegro', 'ME', 'MNE'),
('Morocco', 'MA', 'MAR'),
('Mozambique', 'MZ', 'MOZ'),
('Myanmar', 'MM', 'MMR'),
('Namibia', 'NA', 'NAM'),
('Nauru', 'NR', 'NRU'),
('Nepal', 'NP', 'NPL'),
('Netherlands', 'NL', 'NLD'),
('New Zealand', 'NZ', 'NZL'),
('Nicaragua', 'NI', 'NIC'),
('Niger', 'NE', 'NER'),
('Nigeria', 'NG', 'NGA'),
('North Korea', 'KP', 'PRK'),
('North Macedonia', 'MK', 'MKD'),
('Norway', 'NO', 'NOR'),
('Oman', 'OM', 'OMN'),
('Pakistan', 'PK', 'PAK'),
('Palau', 'PW', 'PLW'),
('Palestine', 'PS', 'PSE'),
('Panama', 'PA', 'PAN'),
('Papua New Guinea', 'PG', 'PNG'),
('Paraguay', 'PY', 'PRY'),
('Peru', 'PE', 'PER'),
('Philippines', 'PH', 'PHL'),
('Poland', 'PL', 'POL'),
('Portugal', 'PT', 'PRT'),
('Qatar', 'QA', 'QAT'),
('Romania', 'RO', 'ROU'),
('Russia', 'RU', 'RUS'),
('Rwanda', 'RW', 'RWA'),
('Saint Kitts and Nevis', 'KN', 'KNA'),
('Saint Lucia', 'LC', 'LCA'),
('Saint Vincent and the Grenadines', 'VC', 'VCT'),
('Samoa', 'WS', 'WSM'),
('San Marino', 'SM', 'SMR'),
('Sao Tome and Principe', 'ST', 'STP'),
('Saudi Arabia', 'SA', 'SAU'),
('Senegal', 'SN', 'SEN'),
('Serbia', 'RS', 'SRB'),
('Seychelles', 'SC', 'SYC'),
('Sierra Leone', 'SL', 'SLE'),
('Singapore', 'SG', 'SGP'),
('Slovakia', 'SK', 'SVK'),
('Slovenia', 'SI', 'SVN'),
('Solomon Islands', 'SB', 'SLB'),
('Somalia', 'SO', 'SOM'),
('South Africa', 'ZA', 'ZAF'),
('South Korea', 'KR', 'KOR'),
('South Sudan', 'SS', 'SSD'),
('Spain', 'ES', 'ESP'),
('Sri Lanka', 'LK', 'LKA'),
('Sudan', 'SD', 'SDN'),
('Suriname', 'SR', 'SUR'),
('Sweden', 'SE', 'SWE'),
('Switzerland', 'CH', 'CHE'),
('Syria', 'SY', 'SYR'),
('Tajikistan', 'TJ', 'TJK'),
('Tanzania', 'TZ', 'TZA'),
('Thailand', 'TH', 'THA'),
('Togo', 'TG', 'TGO'),
('Tonga', 'TO', 'TON'),
('Trinidad and Tobago', 'TT', 'TTO'),
('Tunisia', 'TN', 'TUN'),
('Turkey', 'TR', 'TUR'),
('Turkmenistan', 'TM', 'TKM'),
('Tuvalu', 'TV', 'TUV'),
('Uganda', 'UG', 'UGA'),
('Ukraine', 'UA', 'UKR'),
('United Arab Emirates', 'AE', 'ARE'),
('United Kingdom', 'GB', 'GBR'),
('United States', 'US', 'USA'),
('Uruguay', 'UY', 'URY'),
('Uzbekistan', 'UZ', 'UZB'),
('Vanuatu', 'VU', 'VUT'),
('Vatican City', 'VA', 'VAT'),
('Venezuela', 'VE', 'VEN'),
('Vietnam', 'VN', 'VNM'),
('Yemen', 'YE', 'YEM'),
('Zambia', 'ZM', 'ZMB'),
('Zimbabwe', 'ZW', 'ZWE');



