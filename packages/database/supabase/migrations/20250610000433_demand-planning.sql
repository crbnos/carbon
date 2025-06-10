-- Demand Planning Tables

-- Enum types
CREATE TYPE "demandPeriodType" AS ENUM ('Week', 'Day', 'Month');
CREATE TYPE "demandSourceType" AS ENUM ('Sales Order', 'Job Material');

-- Time periods table for flexible bucketing (weeks initially, days in future)
CREATE TABLE "demandPeriod" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "periodType" "demandPeriodType" NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "demandPeriod_pkey" PRIMARY KEY ("id")
);

-- Demand forecasts table for estimates
CREATE TABLE "demandForecast" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "demandPeriodId" TEXT NOT NULL,
  "forecastQuantity" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "forecastMethod" TEXT, -- 'manual', 'statistical', 'ml', etc.
  "confidence" NUMERIC(3,2), -- 0.00 to 1.00
  "notes" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT NOT NULL,
  
  CONSTRAINT "demandForecast_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demandForecast_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_demandPeriodId_fkey" FOREIGN KEY ("demandPeriodId") REFERENCES "demandPeriod"("id") ON DELETE CASCADE,
  CONSTRAINT "demandForecast_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "demandForecast_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

-- Demand actuals table for historical data
CREATE TABLE "demandActual" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "itemId" TEXT NOT NULL,
  "locationId" TEXT,
  "demandPeriodId" TEXT NOT NULL,
  "actualQuantity" NUMERIC(15,5) NOT NULL DEFAULT 0,
  "sourceType" "demandSourceType" NOT NULL,
  "sourceId" TEXT, -- Reference to sales order, shipment, etc.
  "notes" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedBy" TEXT NOT NULL,
  
  CONSTRAINT "demandActual_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demandActual_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "item"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_demandPeriodId_fkey" FOREIGN KEY ("demandPeriodId") REFERENCES "demandPeriod"("id") ON DELETE CASCADE,
  CONSTRAINT "demandActual_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT,
  CONSTRAINT "demandActual_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "user"("id") ON DELETE RESTRICT
);

-- Indexes for performance
CREATE INDEX "demandPeriod_startDate_endDate_idx" ON "demandPeriod" ("periodType", "startDate", "endDate");

CREATE INDEX "demandPeriod_startDate_idx" ON "demandPeriod" ("periodType","startDate");
CREATE INDEX "demandPeriod_endDate_idx" ON "demandPeriod" ("periodType", "endDate");

CREATE INDEX "demandForecast_itemId_demandPeriodId_idx" ON "demandForecast" ("itemId", "demandPeriodId");
CREATE INDEX "demandForecast_locationId_demandPeriodId_idx" ON "demandForecast" ("locationId", "demandPeriodId");
CREATE INDEX "demandForecast_createdAt_idx" ON "demandForecast" ("createdAt");

CREATE INDEX "demandActual_itemId_demandPeriodId_idx" ON "demandActual" ("itemId", "demandPeriodId");
CREATE INDEX "demandActual_locationId_demandPeriodId_idx" ON "demandActual" ("locationId", "demandPeriodId");
CREATE INDEX "demandActual_sourceType_sourceId_idx" ON "demandActual" ("sourceType", "sourceId");
CREATE INDEX "demandActual_createdAt_idx" ON "demandActual" ("createdAt");

-- Unique constraints to prevent duplicate forecasts/actuals for same item/location/period
CREATE UNIQUE INDEX "demandForecast_unique_item_location_period_idx" ON "demandForecast" ("itemId", COALESCE("locationId", ''), "demandPeriodId");
CREATE UNIQUE INDEX "demandActual_unique_item_location_period_source_idx" ON "demandActual" ("itemId", COALESCE("locationId", ''), "demandPeriodId", "sourceType", COALESCE("sourceId", ''));
