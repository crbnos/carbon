-- capacityReservation.resourceKind gains 'Employee': named-person attended-window
-- bookings (resourceId = employee/user id). 'OperatorPool' remains legal for old
-- rows; the engine no longer writes it.
ALTER TYPE "capacityResourceKind" ADD VALUE IF NOT EXISTS 'Employee';
