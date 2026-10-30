---
paths:
  - "packages/ee/src/sso/scim*"
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
| `packages/ee/src/sso/scim-protocol.ts` | Pure wire format: `parseScimFilter`, `applyUserPatch`, `applyGroupPatch`, `readUserResource`, `matchScimRoute`, resource bodies, discovery documents |
| `packages/ee/src/sso/scim-mapping.ts` | Pure access decisions: `pickEmployeeType`, `typeGrantsFor`, `replaceCompanyGrants` |
| `packages/ee/src/sso/scim.server.ts` | `handleScimRequest` (token → `scimConnection`, `requireEntitlement(…, "SCIM")`, rate limit, routing), the Users and Groups handlers, `reconcileEmployeeTypes` |
| `packages/ee/src/sso/scim-connections.server.ts` | The settings card's reads and writes; every write but `deleteScimConnection` embeds `requireEntitlement` |
| `@carbon/ee/scim.server` | `sso/scim-index.server.ts`, the export of the two files above |
| `apps/erp/app/routes/scim+/v2+/$.ts` | Loader and action both hand the request to `handleScimRequest` |
| `apps/erp/app/routes/x+/settings+/scim.tsx` | Action-only, like `sso.tsx`: intents `create`, `update`, `regenerate`, `mapGroup`, `delete` |
| `ScimProvisioning.ee.tsx` | The Provisioning section of Settings → Security |

Tables (migration `20261030124132_scim-provisioning.sql`): `scimConnection`
(one per company, `UNIQUE ("companyId")`, `tokenHash` + `tokenPreview`, the
default employee type and location), `scimUser` (the IdP's view of one person,
`id` is the SCIM resource id, unique `lower("userName")` per company),
`scimGroup` (`employeeTypeId` + `priority` are the mapping), `scimGroupMember`.
RLS: `company("settings", { read: "settings_view" })` for all four. The engine
writes with the service role and stamps `createdBy` / `updatedBy` with
`'system'`.

## Rules the engine keeps

- **Gated by plan, not edition.** `SCIM` in `FEATURE_PLANS` (Business,
  Partner). SAML SSO's `isSsoEnabled()` does not apply: SCIM needs no GoTrue
  SSO API and no `auth` schema write, so it runs on Cloud.
- **Only managed people.** Every read and write goes through a `scimUser` row.
  An employee the IdP never provisioned is never listed or changed.
- **Accept every IdP shape.** Okta custom (AIW) apps send PUT for every
  update, deactivation included. Entra sends `op` capitalised, booleans as
  `"True"` / `"False"`, and (with `aadOptscim062020`) one no-path `replace`
  with dotted keys. Unknown attributes are ignored, never refused: a refusal
  quarantines Entra's job.
- **Deactivation** (`active` true → false, or DELETE):
  1. `deactivateUser` (`@carbon/auth/users.server`), the same per-company
     deactivation as the Users screen.
  2. Delete the person's `apiKey` rows in the company and `bustApiKeyCache`
     each hash: a key authenticates as its creator with no membership check.
  3. If the person has no `userToCompany` row left,
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
  provisioned person the type of their mapped group with the lowest
  `priority`, else the connection's default. With no mapped group at all it
  does nothing. A type change rewrites this company's slice of
  `userPermission` with `replaceCompanyGrants`. It runs after every group
  write and after a mapping or default-type save.
- **Create** adopts an active employee with the same email as is, adds a
  non-member with the default type and location, refuses a customer or
  supplier contact, keeps the SSO invite rule (`uncoveredSsoDomainError`) and
  seeds the SSO identity when SAML is on. In `CONTROLLED_ENVIRONMENT` it
  refuses every join that is not an adopt, and every reactivation (403): an
  invite records the attestation.
- **`active` is stored after Carbon acts on it.** If `deactivateUser` or the
  API-key delete fails, the row stays active and the request answers 500, so
  the IdP sends the change again. A failed sign-out is only logged.
- **Match `userName` / `displayName` with `lower() = lower()` over Kysely**
  (`idsMatchingWithoutCase`), never PostgREST `ilike`: it reads `*` as a
  wildcard.
- **Audit.** Each create, deactivate, reactivate and type change writes an
  `employee` entry with `actorId: null` and `metadata.actorLabel`
  (`SCIM (<IdP>)`), shown by the audit renderers through `nonUserActorLabel`.
  The event-system trigger also writes its own "System" row for the same
  `employee` change.
- **Never read timestamps through Kysely for a response.** Resource bodies read
  the row back through supabase-js, so `meta.created` is a string.

## Testing

`scim-protocol.test.ts` and `scim-mapping.test.ts` pin the parsers and the
decisions. The live flows (Okta and Entra sequences, sessions, API keys, a
second company) were run against a local stack with curl; the steps and
results are in the run log `.ai/runs/2026-10-30-scim-provisioning.md`. Okta's SCIM 2.0 Spec
Test and Microsoft's SCIM Validator need a public URL.
