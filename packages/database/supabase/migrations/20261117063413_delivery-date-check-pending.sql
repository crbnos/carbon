-- A line whose delivery date check is still running: the capacity check runs
-- in a background job after the save or the quote conversion. Its own
-- migration, because a new enum value cannot be used in the transaction that
-- adds it.
ALTER TYPE "deliveryDateStatus" ADD VALUE IF NOT EXISTS 'Pending';
