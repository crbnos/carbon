-- Add the 'locationId' column to the 'quoteLine' table
ALTER TABLE "quoteLine" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

-- Add a foreign key constraint for 'locationId' referencing the 'location' table
ALTER TABLE "quoteLine" ADD CONSTRAINT "quoteLine_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
