-- Release: a planned order that is due to be released. MRP raises one on every
-- line of a Planned purchase order and on every Planned job, dated the day
-- before the order's due date less the item's lead time (a purchase order takes
-- the earliest of its lines). It is not applied from planning — the row links
-- to the order, which is released there — and it applies only while the order
-- is Planned: the next run drops it, and the planning pages hide it as soon as
-- the order's status moves on.
ALTER TYPE "planningActionType" ADD VALUE IF NOT EXISTS 'Release';
