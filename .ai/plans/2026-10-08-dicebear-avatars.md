# Generated avatars (DiceBear Croodles Neutral) — implementation plan

**Spec:** .ai/specs/2026-10-08-dicebear-avatars.md
**Research:** N/A — skipped (not ERP-domain logic, clear request)
**Branch:** naveenkash/75pu7

## Progress
- [x] Task 1: Add the column default migration
- [x] Task 2: Add the generated-avatar string helpers to `@carbon/utils`
- [x] Task 3: Render generated avatars in the `@carbon/react` `Avatar`
- [x] Task 4: Pass generated values through the app `Avatar` wrappers
- [x] Task 5: Stop the invite flows from overwriting the default
- [x] Task 6: Check the avatar value in the profile action
- [x] Task 7: Add the picker and the new Remove behavior to the profile page
- [x] Task 8: Update docs and run the final gates

## Dependencies
Task 3 needs Task 2. Task 4 needs Task 2. Task 6 needs Task 2. Task 7 needs Tasks 2, 3 and 6. Tasks 1 and 5 are independent. Task 8 runs last.

## Execution notes (autonomous run)
- Do not commit. The user commits by hand.
- Do not apply the migration to the local database. The user applies it.

---

## Task 1: Add the column default migration

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{timestamp}_user-generated-avatar-default.sql`

**Steps:**
1. Run `pnpm db:migrate:new user-generated-avatar-default`.
2. Write this SQL into the new file:
   ```sql
   -- New users get a random DiceBear Croodles Neutral avatar. The value is
   -- rendered by @carbon/react Avatar (see packages/utils/src/avatar.ts).
   -- Existing rows are not changed.
   ALTER TABLE "user"
     ALTER COLUMN "avatarUrl"
     SET DEFAULT 'dicebear:croodles-neutral:' || gen_random_uuid()::text;
   ```

**Verify:**
```bash
ls packages/database/supabase/migrations | grep user-generated-avatar-default
# Expected: one file name
```

**Out of scope:** applying the migration; a backfill of existing rows.

## Task 2: Add the generated-avatar string helpers to `@carbon/utils`

**Depends on:** none
**Files:**
- Create: `packages/utils/src/avatar.ts`, `packages/utils/src/avatar.test.ts`
- Modify: `packages/utils/src/index.ts` — add `export * from "./avatar";`

**Steps:**
1. Export `GENERATED_AVATAR_STYLE = "croodles-neutral"`.
2. Export `GENERATED_AVATAR_PREFIX = "dicebear:croodles-neutral:"`.
3. Export `isGeneratedAvatar(value: string | null | undefined): value is string`. It is true when the value starts with the prefix and the seed matches `/^[A-Za-z0-9-]{1,64}$/`.
4. Export `parseGeneratedAvatar(value)`, which returns `{ style, seed }` or `null`.
5. Export `newGeneratedAvatar()`, which returns the prefix plus `crypto.randomUUID()`.
6. Write tests for a valid value, a storage path, `null`, an empty seed and a seed with `/`.
7. Run the license header fixer.

**Verify:**
```bash
pnpm --filter @carbon/utils exec vitest run src/avatar.test.ts
# Expected: all tests pass
```

## Task 3: Render generated avatars in the `@carbon/react` `Avatar`

**Depends on:** Task 2
**Files:**
- Modify: `packages/react/package.json` — add `@dicebear/core` `9.4.2` and `@dicebear/croodles-neutral` `9.4.2` to `dependencies`
- Create: `packages/react/src/utils/generatedAvatar.ts`, `packages/react/src/__tests__/generatedAvatar.test.ts`
- Modify: `packages/react/src/Avatar.tsx`

**Steps:**
1. Run `pnpm --filter @carbon/react add @dicebear/core@9.4.2 @dicebear/croodles-neutral@9.4.2`.
2. In `generatedAvatar.ts`, export `generatedAvatarDataUri(value: string): string | undefined`.
3. Return `undefined` when `parseGeneratedAvatar(value)` is `null`.
4. Else call `createAvatar(croodlesNeutral, { seed, radius: 0 }).toDataUri()`. The SVG has no background.
5. Cache each result in a module-level `Map`, keyed by the value.
6. In `Avatar.tsx`, compute `imageSrc` with `useMemo`: the data URI for a generated value, else `src`.
7. Use `imageSrc` for the `<img>`. Keep the `onError` fallback.
   For a line-art avatar, add the classes `bg-white border-black/10`. For a color style, add `bg-muted border-transparent`.
8. Test: the same value gives the same string, the string starts with `data:image/svg+xml`, and a storage path gives `undefined`.

**Verify:**
```bash
pnpm --filter @carbon/react exec vitest run src/__tests__/generatedAvatar.test.ts
# Expected: all tests pass
```

**Out of scope:** the `@carbon/react` barrel (`src/index.tsx`).

## Task 4: Pass generated values through the app `Avatar` wrappers

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/components/Avatar.tsx`, `apps/mes/app/components/Avatar.tsx`, `apps/academy/app/components/Avatar.tsx`

**Steps:**
1. In each wrapper, if `isGeneratedAvatar(path)` is true, pass `path` as `src`.
2. Else keep the current `getStoragePath(bucket, path)` behavior.
3. In the ERP wrapper, keep `imageUrl` first.

**Verify:** Task 8 typechecks.

## Task 5: Stop the invite flows from overwriting the default

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/modules/users/users.server.ts`

**Steps:**
1. Change the `createUser` parameter to `Omit<User, "fullName" | "avatarUrl">`.
2. Change the `insertUser` parameter to `Omit<User, "fullName" | "createdAt" | "avatarUrl">`.
3. Delete `avatarUrl: null` from the 3 `createUser` calls.
4. Delete `avatarUrl: null` from the `createConsoleOperator` insert.

**Verify:**
```bash
grep -n "avatarUrl: null" apps/erp/app/modules/users/users.server.ts
# Expected: no output
```

## Task 6: Check the avatar value in the profile action

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/routes/x+/account+/profile.tsx`

**Steps:**
1. In the `photo` intent, read `path` from the form.
2. If `isAllowedAvatarValue(userId, path)` is false, redirect with the flash "Invalid avatar path".
3. Read the current value with `getAccount`. Log a read error.
4. Save the new value with `updateAvatar`.
5. If the old value passes `isOwnAvatarUpload` and differs from the new one, delete it from the `avatars` bucket.
6. If the delete fails, log it and continue.
7. Remove the `null` branch and the "Removed avatar" message.

**Verify:** Task 8 typechecks.

## Task 7: Add the picker and the new Remove behavior to the profile page

**Depends on:** Tasks 2, 3, 6
**Files:**
- Create: `apps/erp/app/modules/account/ui/Profile/GeneratedAvatarPicker.tsx`
- Modify: `apps/erp/app/modules/account/ui/Profile/ProfilePhotoForm.tsx`
- Copy from (precedent): `apps/erp/app/modules/users/ui/components/RevokeInviteModal.tsx` (Modal shape)

**Steps:**
1. Build `GeneratedAvatarPicker` with props `isOpen`, `current`, `onClose`, `onSave(value)`.
2. Keep 12 options in state. The first is `current` when it is a generated value.
3. Shuffle replaces the other 11 with `newGeneratedAvatar()` values.
4. Render each option as a `button` with an `Avatar` (`size="lg"`, `src={value}`) in a 4-column grid.
5. Give the selected option a ring. Give each button an `aria-label` and `aria-pressed`.
6. Show the credit line with links to the Figma source and CC BY 4.0.
7. In `ProfilePhotoForm`, add a "Choose avatar" button that opens the picker.
8. On save, submit the value. The action deletes a replaced upload (Task 6).
9. Show Remove only for an uploaded photo. Remove submits `newGeneratedAvatar()`.
10. Show "Change" on the upload button when an uploaded photo exists, else "Upload".

**Verify:** Task 8 typechecks and lints.

## Task 8: Update docs and run the final gates

**Depends on:** Tasks 1–7
**Files:**
- Modify: `packages/react/AGENTS.md` — one line on generated avatar values

**Steps:**
1. Add the `Avatar` note to `packages/react/AGENTS.md`.
2. Run the gates below.

**Verify:**
```bash
pnpm --filter @carbon/checks license-headers
pnpm exec biome check packages/utils/src/avatar.ts packages/utils/src/avatar.test.ts packages/react/src/Avatar.tsx packages/react/src/utils/generatedAvatar.ts packages/react/src/__tests__/generatedAvatar.test.ts apps/erp/app/components/Avatar.tsx apps/mes/app/components/Avatar.tsx apps/academy/app/components/Avatar.tsx apps/erp/app/modules/users/users.server.ts apps/erp/app/routes/x+/account+/profile.tsx apps/erp/app/modules/account/ui/Profile
# Expected: no errors
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/react --filter=erp --filter=mes --filter=academy
# Expected: all tasks successful
```
