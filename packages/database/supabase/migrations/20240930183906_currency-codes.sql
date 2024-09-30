CREATE TABLE "currencyCode" (
    "code" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL
);

ALTER TABLE "currencyCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view currency codes" ON "currencyCode" FOR SELECT USING (auth.role() = 'authenticated');

INSERT INTO "currencyCode" ("code", "name", "symbol")
VALUES
  ('USD', 'US Dollar', '$'),
  ('CAD', 'Canadian Dollar', 'CA$'),
  ('EUR', 'Euro', '€'),
  ('AED', 'United Arab Emirates Dirham', 'AED'),
  ('AFN', 'Afghan Afghani', 'Af'),
  ('ALL', 'Albanian Lek', 'ALL'),
  ('AMD', 'Armenian Dram', 'AMD'),
  ('ARS', 'Argentine Peso', 'AR$'),
  ('AUD', 'Australian Dollar', 'AU$'),
  ('AZN', 'Azerbaijani Manat', 'man.'),
  ('BAM', 'Bosnia-Herzegovina Convertible Mark', 'KM'),
  ('BDT', 'Bangladeshi Taka', 'Tk'),
  ('BGN', 'Bulgarian Lev', 'BGN'),
  ('BHD', 'Bahraini Dinar', 'BD'),
  ('BIF', 'Burundian Franc', 'FBu'),
  ('BND', 'Brunei Dollar', 'BN$'),
  ('BOB', 'Bolivian Boliviano', 'Bs'),
  ('BRL', 'Brazilian Real', 'R$'),
  ('BWP', 'Botswanan Pula', 'BWP'),
  ('BYN', 'Belarusian Ruble', 'Br'),
  ('BZD', 'Belize Dollar', 'BZ$'),
  ('CDF', 'Congolese Franc', 'CDF'),
  ('CHF', 'Swiss Franc', 'CHF'),
  ('CLP', 'Chilean Peso', 'CL$'),
  ('CNY', 'Chinese Yuan', 'CN¥'),
  ('COP', 'Colombian Peso', 'CO$'),
  ('CRC', 'Costa Rican Colón', '₡'),
  ('CVE', 'Cape Verdean Escudo', 'CV$'),
  ('CZK', 'Czech Republic Koruna', 'Kč'),
  ('DJF', 'Djiboutian Franc', 'Fdj'),
  ('DKK', 'Danish Krone', 'Dkr'),
  ('DOP', 'Dominican Peso', 'RD$'),
  ('DZD', 'Algerian Dinar', 'DA'),
  ('EGP', 'Egyptian Pound', 'EGP'),
  ('ERN', 'Eritrean Nakfa', 'Nfk'),
  ('ETB', 'Ethiopian Birr', 'Br'),
  ('GBP', 'British Pound Sterling', '£'),
  ('GEL', 'Georgian Lari', 'GEL'),
  ('GHS', 'Ghanaian Cedi', 'GH₵'),
  ('GNF', 'Guinean Franc', 'FG'),
  ('GTQ', 'Guatemalan Quetzal', 'GTQ'),
  ('HKD', 'Hong Kong Dollar', 'HK$'),
  ('HNL', 'Honduran Lempira', 'HNL'),
  ('HRK', 'Croatian Kuna', 'kn'),
  ('HUF', 'Hungarian Forint', 'Ft'),
  ('IDR', 'Indonesian Rupiah', 'Rp'),
  ('ILS', 'Israeli New Sheqel', '₪'),
  ('INR', 'Indian Rupee', 'Rs'),
  ('IQD', 'Iraqi Dinar', 'IQD'),
  ('IRR', 'Iranian Rial', 'IRR'),
  ('ISK', 'Icelandic Króna', 'Ikr'),
  ('JMD', 'Jamaican Dollar', 'J$'),
  ('JOD', 'Jordanian Dinar', 'JD'),
  ('JPY', 'Japanese Yen', '¥'),
  ('KES', 'Kenyan Shilling', 'Ksh'),
  ('KHR', 'Cambodian Riel', 'KHR'),
  ('KMF', 'Comorian Franc', 'CF'),
  ('KRW', 'South Korean Won', '₩'),
  ('KWD', 'Kuwaiti Dinar', 'KD'),
  ('KZT', 'Kazakhstani Tenge', 'KZT'),
  ('LBP', 'Lebanese Pound', 'L.L'),
  ('LKR', 'Sri Lankan Rupee', 'SLRs'),
  ('LTL', 'Lithuanian Litas', 'Lt'),
  ('LVL', 'Latvian Lats', 'Ls'),
  ('LYD', 'Libyan Dinar', 'LD'),
  ('MAD', 'Moroccan Dirham', 'MAD'),
  ('MDL', 'Moldovan Leu', 'MDL'),
  ('MGA', 'Malagasy Ariary', 'MGA'),
  ('MKD', 'Macedonian Denar', 'MKD'),
  ('MMK', 'Myanma Kyat', 'MMK'),
  ('MOP', 'Macanese Pataca', 'MOP$'),
  ('MUR', 'Mauritian Rupee', 'MURs'),
  ('MXN', 'Mexican Peso', 'MX$'),
  ('MYR', 'Malaysian Ringgit', 'RM'),
  ('MZN', 'Mozambican Metical', 'MTn'),
  ('NAD', 'Namibian Dollar', 'N$'),
  ('NGN', 'Nigerian Naira', '₦'),
  ('NIO', 'Nicaraguan Córdoba', 'C$'),
  ('NOK', 'Norwegian Krone', 'Nkr'),
  ('NPR', 'Nepalese Rupee', 'NPRs'),
  ('NZD', 'New Zealand Dollar', 'NZ$'),
  ('OMR', 'Omani Rial', 'OMR'),
  ('PAB', 'Panamanian Balboa', 'B/.'),
  ('PEN', 'Peruvian Nuevo Sol', 'S/.'),
  ('PHP', 'Philippine Peso', '₱'),
  ('PKR', 'Pakistani Rupee', 'PKRs'),
  ('PLN', 'Polish Zloty', 'zł'),
  ('PYG', 'Paraguayan Guarani', '₲'),
  ('QAR', 'Qatari Rial', 'QR'),
  ('RON', 'Romanian Leu', 'RON'),
  ('RSD', 'Serbian Dinar', 'din.'),
  ('RUB', 'Russian Ruble', 'RUB'),
  ('RWF', 'Rwandan Franc', 'RWF'),
  ('SAR', 'Saudi Riyal', 'SR'),
  ('SDG', 'Sudanese Pound', 'SDG'),
  ('SEK', 'Swedish Krona', 'Skr'),
  ('SGD', 'Singapore Dollar', 'S$'),
  ('SOS', 'Somali Shilling', 'Ssh'),
  ('SYP', 'Syrian Pound', 'SY£'),
  ('THB', 'Thai Baht', '฿'),
  ('TND', 'Tunisian Dinar', 'DT'),
  ('TOP', 'Tongan Paʻanga', 'T$'),
  ('TRY', 'Turkish Lira', 'TL'),
  ('TTD', 'Trinidad and Tobago Dollar', 'TT$'),
  ('TWD', 'New Taiwan Dollar', 'NT$'),
  ('TZS', 'Tanzanian Shilling', 'TSh'),
  ('UAH', 'Ukrainian Hryvnia', '₴'),
  ('UGX', 'Ugandan Shilling', 'USh'),
  ('UYU', 'Uruguayan Peso', '$U'),
  ('UZS', 'Uzbekistan Som', 'UZS'),
  ('VEF', 'Venezuelan Bolívar', 'Bs.F'),
  ('VND', 'Vietnamese Dong', '₫'),
  ('XAF', 'CFA Franc BEAC', 'FCFA'),
  ('XOF', 'CFA Franc BCEAO', 'CFA'),
  ('YER', 'Yemeni Rial', 'YR'),
  ('ZAR', 'South African Rand', 'R'),
  ('ZMK', 'Zambian Kwacha', 'ZK'),
  ('ZWL', 'Zimbabwean Dollar', 'ZWL$');

-- Add foreign key constraint
ALTER TABLE "currency" ADD CONSTRAINT "currency_currencyCode_fkey" 
  FOREIGN KEY ("code") REFERENCES "currencyCode"("code") 
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop the name, symbol, and isBaseCurrency columns from the currency table
ALTER TABLE "currency" DROP COLUMN "name";
ALTER TABLE "currency" DROP COLUMN "symbol";
ALTER TABLE "currency" DROP COLUMN "isBaseCurrency";

-- Base currency code
-- Add a baseCurrencyCode column to the company table
ALTER TABLE "company" ADD COLUMN "baseCurrencyCode" TEXT;

-- Add foreign key constraint
ALTER TABLE "company" ADD CONSTRAINT "company_baseCurrencyCode_fkey" 
  FOREIGN KEY ("baseCurrencyCode") REFERENCES "currencyCode"("code") 
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Set the base currency code to USD for all existing companies
UPDATE "company" SET "baseCurrencyCode" = 'USD';

-- Make the baseCurrencyCode column non-nullable
ALTER TABLE "company" ALTER COLUMN "baseCurrencyCode" SET NOT NULL;

-- Remake the companies view
DROP VIEW IF EXISTS "companies";
CREATE OR REPLACE VIEW "companies" WITH(SECURITY_INVOKER=true) AS
  SELECT DISTINCT
    c.*,
    uc.*,
    et.name AS "employeeType"
    FROM "userToCompany" uc
    INNER JOIN "company" c
      ON c.id = uc."companyId"
    LEFT JOIN "employee" e
      ON e.id = uc."userId" AND e."companyId" = uc."companyId"
    LEFT JOIN "employeeType" et
      ON et.id = e."employeeTypeId";

-- Create a currencies view with all of the columns from the currency table, joined with the currencyCode table
CREATE OR REPLACE VIEW "currencies" WITH(SECURITY_INVOKER=true) AS
  SELECT c.*, cc."name", cc."symbol"
  FROM "currency" c
  INNER JOIN "currencyCode" cc
    ON cc."code" = c."code";
