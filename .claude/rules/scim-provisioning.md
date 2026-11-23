---
paths:
  - "packages/ee/src/scim/**"
  - "apps/erp/app/routes/scim+/**"
  - "apps/erp/app/routes/x+/settings+/scim.tsx"
  - "apps/erp/app/modules/settings/ui/Security/ScimProvisioning.ee.tsx"
---

# SCIM 2.0 provisioning

An identity provider (Okta, Entra ID, any SCIM 2.0 client) creates, updates,
deactivates and regroups a company's employees at `/scim/v2`. Spec:
`.ai/specs/2026-10-30-scim-provisioning.md`. Research (IdP request shapes,
licences, test tools): `.ai/research/scim-provisioning.md`. User docs:
`docs/content/docs/reference/scim-provisioning.mdx`.

## Files

| File | Holds |
|---|---|
| `packages/ee/src/scim/protocol.ts` | Pure wire format: `parseScimFilter`, `applyUserPatch`, `applyGroupPatch`, `readUserResource`, `matchScimRoute`, resource bodies, discovery documents |
| `packages/ee/src/scim/mapping.ts` | Pure access decisions: `pickEmployeeType`, `typeGrantsFor`, `replaceCompanyGrants` |
| `packages/ee/src/scim/engine.server.ts` | `handleScimRequest` (token → `scimConnection`, `requireEntitlement(…, "SCIM")`, rate limit, routing), the Users and Groups handlers, `reconcileEmployeeTypes` |
| `packages/ee/src/scim/connections.server.ts` | The settings card's reads and writes; every write but `turnOffScimConnection` embeds `requireEntitlement`. Also `getScimOwnedFields` (the fields an admin cannot change, below), `getScimManagedUserIds` (the Users screen's "SCIM" badge and the employee drawer's note) and `getEmployeeTypesWithoutPermissions` (the no-permissions warning; reads `employeeTypePermission` with the service role, since its RLS needs `users_update`) |
| `@carbon/ee/scim.server` | `scim/index.server.ts`, the export of the two files above |
| `apps/erp/app/routes/scim+/v2+/$.ts` | Loader and action both hand the request to `handleScimRequest` |
| `apps/erp/app/routes/x+/settings+/scim.tsx` | Action-only, like `sso.tsx`: intents `create`, `update`, `regenerate`, `saveGroupMappings`, `delete` |
| `ScimProvisioning.ee.tsx` | The Provisioning section of Settings → Security |

Tables (migration `20261123091215_scim-provisioning.sql`): `scimConnection`
(one per company, `UNIQUE ("companyId")`, `tokenHash` + `tokenPreview`, the
default employee type and location), `scimUser` (the IdP's view of one person,
`id` is the SCIM resource id, unique `lower("userName")` per company),
`scimGroup` (`employeeTypeId` + `priority` are the mapping), `scimGroupMember`.
RLS: `company("settings", { read: "settings_view", create: false, update:
false, delete: false })` for all four: no API writes, since a `settings_update`
user could otherwise set `tokenHash` to a token they know. The engine writes
with the service role and stamps `createdBy` / `updatedBy` with
`'system'`.

## Rules the engine keeps

- **Gated by plan, not edition.** `SCIM` in `FEATURE_PLANS` (Business,
  Partner). SAML SSO's `isSsoEnabled()` does not apply: SCIM needs no GoTrue
  SSO API and no `auth` schema write, so it runs on Cloud.
- **Turn off keeps the SCIM ids.** `turnOffScimConnection` clears
  `tokenHash` and `tokenPreview` (both nullable for this), so every
  `/scim/v2` request is refused, and keeps the connection row, the SCIM
  people, the groups and the mappings. Every read and write of the settings
  card filters `tokenHash IS NOT NULL`; `createScimConnection` resumes a
  turned-off row with a new token and new defaults, and `regenerateScimToken`
  never turns one back on. An IdP never forgets the ids Carbon gave it:
  deleting them on turn-off made every later update answer 404 and every
  group push drop its members.
- **Only managed people.** Every read and write goes through a `scimUser` row.
  An employee the IdP never provisioned is never listed or changed.
- **Accept every IdP shape.** Okta custom (AIW) apps send PUT for every
  update, deactivation included. Entra sends `op` capitalised, booleans as
  `"True"` / `"False"`, and (with `aadOptscim062020`) one no-path `replace`
  with dotted keys. Unknown attributes are ignored, never refused: a refusal
  quarantines Entra's job.
- **Deactivation** (`active` true → false, or DELETE):
  1. `deactivateUser` (`@carbon/auth/users.server`), the same per-company
     deactivation as the Users screen. It deletes the person's `apiKey` rows
     in the company first (`deleteUserApiKeys`, which busts each key's cache):
     a key authenticates as its creator with no membership check.
  2. If the person has no `userToCompany` row left,
     `auth.admin.signOut(signUserAccessToken(userId), "global")`. A token with
     no `session_id` makes GoTrue revoke every refresh token. A person with
     another company keeps the session.
  The global `user` row stays. DELETE also deletes the `scimUser` row, so the
  next GET answers 404 (Entra expects that after its hard delete).
- **Only a change of `active` moves membership.** A PUT with `active: true` on
  an already-active row does nothing, so a manual deactivation in Carbon
  sticks until the IdP deactivates and reactivates the person.
- **The sign-in email never changes from SCIM.** `scimUser.email` /
  `userName` hold the IdP's values. The name is written to `user` only when
  the person has no other company.
- **Groups → employee types.** `reconcileEmployeeTypes` gives each active
  provisioned person the type of their mapped group that comes first by
  `compareGroupPrecedence` (lowest `priority`, ties by `displayName`), else the
  connection's default. The settings list shows mapped groups in that order
  (`getScimConnection` sorts with the same function). The card keeps type and
  order changes unsaved until **Save changes**, which posts the whole list to
  `saveScimGroupMappings`: `planGroupMappingSave` numbers the mapped groups in
  steps of 10 in list order (a newly mapped group is last), one transaction
  writes the changed rows, then everyone is reconciled once. No screen asks
  for a number. With no mapped group at all it
  does nothing, except after the LAST mapped group is deleted or unmapped
  (`mappingRemoved`, from `deleteGroup` and `saveScimGroupMappings`): that
  group's members still hold its type and grants, so they move to the
  default. A type change rewrites this company's slice of
  `userPermission` with `replaceCompanyGrants`. It runs after every group
  write and after a mapping or default-type save.
- **Create** adopts an active employee with the same email as is, adds a
  non-member with the default type and location, refuses a customer or
  supplier contact, keeps the SSO invite rule (`uncoveredSsoDomainError`) and
  seeds the SSO identity when SAML is on. In `CONTROLLED_ENVIRONMENT` it
  refuses every join that is not an adopt, and every reactivation (403): an
  invite records the attestation.
- **`active` is stored after Carbon acts on it.** If `deactivateUser`
  (including its API-key delete) fails, the row stays active and the request answers 500, so
  the IdP sends the change again. A failed sign-out is only logged.
- **Match `userName` / `displayName` with `lower() = lower()` over Kysely**
  (`idsMatchingWithoutCase`), never PostgREST `ilike`: it reads `*` as a
  wildcard.
- **Audit: one row per change, labelled "SCIM".** The engine writes no audit
  entry of its own. Its create, reactivate and type-change transactions call
  `labelAsScim` (`set_config('app.actor_label', 'SCIM', true)`), and
  deactivation runs `deactivateUser` on `getCarbonServiceRoleAs("SCIM")`, which
  sends the `x-carbon-actor` header. `dispatch_event_batch` puts the label into
  the audit row's `metadata.actorLabel`, which the audit renderers show through
  `nonUserActorLabel` (see `audit-log-system.md`).
- **The admin cannot fight the identity provider.** `getScimOwnedFields` says
  what SCIM owns for a person in a company: the name, while the person belongs
  to no other company (SCIM writes the global name only then), and the
  employee type, once a group is mapped. The person profile and the account
  settings show an owned name read-only, and the employee drawer an owned type.
  `scimOwnedChangeRefusal` (ERP `users.service.ts`) refuses a change to an owned
  field in `updateEmployeePermissions`, `updateOwnProfile`,
  `updatePublicAccount` and the person route's save; an unchanged value passes,
  and a failed read lets the change through (it is not an access check).
  Deactivate stays available: a manual deactivation is the emergency stop.
- **Backups.** A restore from a backup brings SCIM back turned off (the token
  columns are not loaded), so a revoked token never works again. A restore of
  another company's backup and an import load no SCIM rows. See
  `company-backup-restore.md`.
- **One log line per request.** `handleScimRequest` logs "SCIM request" with
  `companyId`, method, path (no query string: an IdP filters by an email) and
  status for every request it can tie to a company. Nothing is stored.
- **`displayName` is read-only.** Carbon builds it from the name and ignores a
  written value, so `/Schemas` marks it `mutability: "readOnly"`.
- **Never read timestamps through Kysely for a response.** Resource bodies read
  the row back through supabase-js, so `meta.created` is a string.

## Testing

`scim/protocol.test.ts` and `scim/mapping.test.ts` pin the parsers and the
decisions. `supabase/tests/event-actor-label.test.sql` pins the audit label,
`backups/restore-scope.test.ts` (jobs) the restore rules, and
`deactivate-employee.test.ts` (auth) the API-key cleanup. The live flows (Okta and Entra sequences, sessions, API keys, a
second company) were run against a local stack with curl; the steps and
results are in the run log `.ai/runs/2026-10-30-scim-provisioning.md`. Okta's SCIM 2.0 Spec
Test passed (12 of 12) through a public tunnel. Microsoft's SCIM Validator needs a
Microsoft sign-in.
