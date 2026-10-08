-- New users get a random DiceBear Croodles Neutral avatar. The value is a
-- seed, not a storage path: @carbon/react's Avatar renders it in the browser
-- (see packages/utils/src/avatar.ts). A column default covers every path that
-- inserts a user row (the auth.users trigger, invites, console operators, SSO
-- migration, seeds). Existing rows are not changed.
ALTER TABLE "user"
  ALTER COLUMN "avatarUrl"
  SET DEFAULT 'dicebear:croodles-neutral:' || gen_random_uuid()::text;
