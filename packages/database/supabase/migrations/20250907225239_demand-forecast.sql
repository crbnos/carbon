ALTER TABLE "demandForecast"
ADD CONSTRAINT "demandForecast_itemId_locationId_periodId_companyId_key"
UNIQUE ("itemId", "locationId", "periodId", "companyId");
