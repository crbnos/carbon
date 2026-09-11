-- A user may belong to a group exactly once.
--
-- "uq_membership" spans ("groupId", "memberGroupId", "memberUserId"), and
-- "memberGroupId" is NULL on every user membership. Under the default NULLS
-- DISTINCT those rows never conflict with each other, so the constraint that
-- looks like it dedupes user memberships has never done so: two concurrent
-- writers — the sync_add_employee_to_type_group trigger and the invite
-- acceptance path that restores the membership on reactivation — can both
-- insert the same (groupId, memberUserId) pair.
--
-- A plain (not partial) unique index is deliberate: it gives ON CONFLICT an
-- inferrable target, and group memberships keep "memberUserId" NULL, so they
-- stay mutually distinct and are unaffected.

-- Collapse existing duplicates first, keeping the earliest row of each pair so
-- any FK or audit reference to the surviving id stays valid.
DELETE FROM "membership" m
USING "membership" keeper
WHERE m."memberUserId" IS NOT NULL
  AND m."groupId" = keeper."groupId"
  AND m."memberUserId" = keeper."memberUserId"
  AND m."id" > keeper."id";

CREATE UNIQUE INDEX "membership_groupId_memberUserId_key"
  ON "membership" ("groupId", "memberUserId");
