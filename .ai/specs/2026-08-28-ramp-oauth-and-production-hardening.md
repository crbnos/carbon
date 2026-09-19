# Spec: Ramp OAuth (Connect flow) + production hardening

- **Date:** 2026-08-28
- **Status:** OAuth implemented; production-app approval and the explicitly listed hardening
  follow-ups still require external verification or implementation.
- **Builds on:** `.ai/specs/2026-08-20-ramp-transaction-sync.md`
- **Owner:** TBD

## Problem / motivation

The original Ramp integration required every customer to create and paste Ramp client
credentials. Carbon now owns one production OAuth application and exposes a one-click consent
flow. Existing `client_credentials` records remain readable for compatibility, but the settings
UI no longer creates them.

The remaining production-hardening questions are narrower: external approval of Carbon's Ramp
OAuth application, safe behavior for a business with several Ramp entities, and recovery when a
purchase-order create succeeded remotely before Carbon stored its mapping.

## Goals

1. Connect Ramp through an authorization-code flow without exposing customer secrets in the UI.
2. Bind every callback to the integration, user, and company that initiated it; reject expired or
   replayed state before processing provider errors or exchanging a code.
3. Store OAuth tokens in Vault without overwriting account mappings, sync flags, connection ids,
   webhooks, or cursors during connect/reconnect/refresh.
4. Refresh access tokens transparently while retaining legacy stored client credentials.
5. Keep the unresolved multi-entity and purchase-order collision risks visible and testable.

## Non-goals

- Changing the Ramp sync families, journal shapes, or accounting mappings.
- Migrating an existing client-credentials record automatically.
- Ramp partner/marketplace paperwork; that is an external process.

## Implemented design

### OAuth app and UI

`packages/ee/src/ramp/config.tsx` activates Ramp only when `RAMP_CLIENT_ID` is present and
declares the production Connect flow:

- authorize: `https://app.ramp.com/v1/authorize`
- token: `https://api.ramp.com/developer/v1/token`
- callback: `/api/integrations/ramp/oauth`
- scopes: the integration API scopes plus `offline_access`

`RAMP_CLIENT_ID` is browser-visible configuration; `RAMP_CLIENT_SECRET` is server-only. Both
flow from CI to the ERP deployment through `ci/src/deploy.ts` and `sst.config.ts`. The settings
form contains only the entity, account, coding-scope, and sync settings. The stored credential
schema still accepts `client_credentials` so an existing installation can continue to run.

### Signed, single-use state

The integrations loader calls
`issueOAuthState({ integrationId: "ramp", userId, companyId })` from
`@carbon/auth/oauth-state.server`. It stores a random nonce and those binding fields in the
signed, HttpOnly `carbon-oauth-state` cookie for ten minutes. The callback calls
`consumeOAuthState` before interpreting Ramp's response. The helper validates the nonce,
expiry, integration, user, and company, then destroys the session whether validation succeeded
or failed. Invalid, missing, expired, replayed, or cross-tenant state returns the stable
`invalid-state` integration error.

The state cookie is signed by `SESSION_SECRET`; there is no Ramp-specific state secret or
unsigned company id in the callback contract. Tests live in
`packages/auth/src/lib/oauth-state.server.test.ts`,
`apps/erp/app/routes/x+/settings+/integrations.oauth-state.test.ts`, and
`apps/erp/app/routes/api+/integrations.ramp.oauth.test.ts`.

### Callback and metadata ownership

`apps/erp/app/routes/api+/integrations.ramp.oauth.ts` requires settings-update permission,
consumes state, exchanges the code through `exchangeRampOAuthCode`, applies
`patchRampOAuthCredentials`, and runs `rampOnInstall`. Its redirects use stable reasons:
`invalid-state`, `denied`, `invalid-response`, `token-exchange`, `save-failed`, and
`install-failed`.

`patchRampOAuthCredentials` changes only the OAuth-owned credential paths, removes obsolete
client-credential paths, activates the integration, and preserves every unrelated metadata
path. Access and refresh tokens are Vault secrets; credential type, environment, and expiry are
plaintext metadata. It delegates to `patchIntegrationState`, whose service-role-only
`upsert_company_integration_patch` RPC locks the logical `(companyId, integrationId)` record and
updates metadata, Vault, `secretRef`, active state, and audit fields in one transaction.

### Refresh

`RampClient.getAccessToken` refreshes an OAuth access token inside the sixty-second margin.
`getRampIntegration` supplies Carbon's app credentials and an `onTokensRefreshed` callback.
`patchRampRefreshedTokens` owns only the new access token and expiry. The current Ramp response
schema has no rotated refresh-token field, so refresh deliberately retains the stored refresh
token. The behavior is pinned in `packages/ee/src/ramp/lib/__tests__/client.test.ts` and
`packages/ee/src/ramp/lib/__tests__/state.test.ts`.

### Connect versus convergence

The OAuth callback creates the credential-bearing integration row before account mapping.
`convergeRamp` validates the token, ensures an accounting connection, and attempts webhook
registration, then stops if either required account is absent. It does not push master data or
enqueue finance sync for an unmapped fresh connection. Saving settings calls `rampOnUpdate`;
after the required accounts and optional entity validate, it pushes chart of accounts and cost
centers and requests `ramp-sync`. The hourly `ramp-sweep` remains the correctness floor if a
webhook or enqueue fails. A reconnect preserves valid mappings, so it may converge immediately.

## Remaining production hardening

### External OAuth verification

There is no Ramp domain-verification token route in the current ERP route tree. Production
release still depends on Ramp accepting Carbon's registered production callback and requested
scopes. This must be verified against the real application; repository tests cannot establish
provider approval.

### Multi-entity behavior

Inbound sync treats an absent `metadata.entityId` as all entities and applies the configured id
both to verified remote filters and to a local pre-write guard. Outbound PO/bill push still uses
the configured entity or `resolveRampEntityId`'s first-business-entity fallback. That fallback is
convenient for a single-entity business but ambiguous for a multi-entity business.

**Recommended follow-up:** when more than one Ramp entity exists and no entity is configured,
refuse outbound PO/bill creation with a setup error instead of choosing an arbitrary entity.
Keep the current all-entity inbound behavior unless product explicitly changes that contract.

### Purchase-order recovery and collisions

`pushPurchaseOrder` is mapping-first and sends an entity-scoped idempotency key derived from the
Carbon PO id. Once mapped, later changes PATCH the Ramp PO. It does not currently search Ramp by
`external_id` before an unmapped create, and a true `purchase_order_number` collision is not
translated into a dedicated customer-facing error.

**Recommended follow-up:** pre-match an unmapped PO by `external_id`; link and PATCH a unique
match. Continue to surface, rather than silently rename, a true readable-number collision.

## Decisions retained from the original design

- OAuth is the only new-install UI; legacy client credentials remain a stored-data compatibility
  arm, not an Advanced settings option.
- The production authorize host is `app.ramp.com`; the token exchange remains on
  `api.ramp.com`. The production UI does not offer an environment selector.
- OAuth reconnect must be a key-owned patch, never a read/merge/write of the whole integration
  record or secret bag.
- True purchase-order number collisions should be surfaced, not hidden by silently changing the
  customer's PO number.

## Verification

- Automated: OAuth state helper, settings-loader wiring, callback error paths, Ramp OAuth
  exchange/refresh, state patches, and install convergence tests.
- Connected: production consent, redirect URI, granted scopes, refresh after expiry, reconnect
  with existing mappings, and a denied-consent callback.
- Hardening follow-up: multi-entity outbound without a configured entity; unmapped PO recovery
  after remote-create/local-link interruption; true PO-number collision.

## Risks

- OAuth app review and scopes are external dependencies.
- A concurrent refresh can make more than one network request, although each successful write is
  restricted to the access-token/expiry paths and cannot clobber settings or cursors.
- Multi-entity outbound remains unsafe to infer until the recommended guard is implemented.
- Idempotency keys reduce duplicate creates, but provider lookup is still needed to recover
  deterministically from a remote-success/local-link failure.

## Changelog

- 2026-08-28: Initial OAuth and production-hardening design.
- 2026-09-11: Refreshed against the implemented signed state flow, production-only Connect UI,
  atomic integration-state patches, metadata-preserving reconnect, non-rotating refresh behavior,
  and settings-gated convergence. Retained multi-entity and PO-recovery gaps as explicit
  follow-ups.
