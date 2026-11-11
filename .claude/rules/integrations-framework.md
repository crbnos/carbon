---
paths:
  - packages/ee/src/index.ts
  - packages/ee/src/types.ts
  - packages/ee/src/fns.ts
  - packages/ee/src/hooks.server.ts
  - packages/ee/src/oauth-popup.ts
  - packages/ee/src/integrations/**
  - packages/ee/src/sync/**
  - apps/erp/app/hooks/useIntegrations.tsx
  - apps/erp/app/routes/x+/settings+/integrations*
  - apps/erp/app/routes/api+/integrations.$id.*
  - apps/erp/app/routes/api+/integrations.connections.*
  - apps/erp/app/modules/settings/integration-*.ts
  - apps/erp/app/modules/settings/oauth-popup.ts
  - apps/erp/app/modules/settings/ui/Integrations/**
---

# Integration framework

The shared code under every integration: descriptor, registry, gates, install, OAuth,
secrets and health. Each integration has its own rule (table at the end). Sync detail
(capabilities, topology, ledger delegation) is owned by `accounting-sync-handlers.md`.

## Key files

- `packages/ee/src/types.ts` — `IntegrationConfig`, `IntegrationOptions`, `IntegrationSetting`
  (`type`: `text`, `number`, `password`, `secret`, `switch`, `processes`, `options`, `cards`,
  `array`; `visibleWhen`; `availableWhen`), `IntegrationAction` (`enabledWhenSetting`),
  `OAuthConfig`, `IntegrationInstallMode`, and the client and server hook types.
  `setupInstructions` gets `{ companyId, metadata, installed, mode }`.
- `packages/ee/src/fns.ts` — `defineIntegration`. It throws when `id` or `name` is missing.
  It makes `active` a getter, and it guards `onInstall`, `onUninstall` and `onHealthcheck`
  with `withServerOnly` (they throw in the browser).
- `packages/ee/src/index.ts` — the `integrations` array (the registry), `IntegrationID`,
  `getIntegrationConfigById`, the role lookups `getIntegrationsByRole` /
  `getIntegrationIdsByRole`, `getProviderDescriptors` and `resolveIntegrationTopology`.
- `packages/ee/src/hooks.server.ts` — `getIntegrationServerHooks(id)`. Server-only hooks
  (`onInstall`, `onUpdate`, `onUninstall`, `onHealthcheck`, `onConnect`) live here, because a
  `config.tsx` is in the browser bundle. Each piece gets an `onUninstall` that calls
  `revokeConnectionsForPiece`.
- `packages/ee/src/integrations/secrets.ts` — `SECRET_KEYS` (the only list of secret
  metadata paths), `splitSecrets`, `persistIntegrationSecrets`, `resolveIntegrationSecrets`,
  `patchIntegrationState` (RPC `upsert_company_integration_patch`), `getWebhookSigningSecret`.
- `packages/ee/src/integrations/connections.ts` — named accounts of a workflow piece
  (`integrationConnection` table, its own vault RPCs). See `workflow-integrations.md`.
- `packages/ee/src/integrations/piece-integration.ts` — `definePieceIntegration(piece, card)`:
  a piece card with `id` = the piece name from `ACTIVEPIECES_PIECES` (`pieces.ts`).
- `packages/ee/src/integrations/connect.ts` + `packages/ee/src/oauth-popup.ts` —
  `startIntegrationConnect`, `beginOAuthPopup`. The popup opens in the click, before the
  fetch: Chrome blocks a `window.open` after an await.
- `packages/ee/src/integrations/webhook-signature.ts` — `verifyHmacSha256Signature`
  (raw body, hex or base64, fail-closed) and `WebhookVerification`.
- `packages/ee/src/plan.ts` — `INTEGRATION_WHITELIST`, `isIntegrationWhitelisted`,
  `isIntegrationComingSoon`. `packages/ee/src/plan.server.ts` — `hasIntegrationEarlyAccess`.
- `apps/erp/app/modules/settings/settings.service.ts` — `upsertCompanyIntegration`,
  `getIntegration`, `isIntegrationInstallWithheld`, `getIntegrationsWithHealth`,
  `getIntegrationHealth`, `invalidateIntegrationHealthCache`.
- `apps/erp/app/hooks/useIntegrations.tsx` — `useIntegrations()` → `{ list, has(id) }`. It
  reads the company's `companyIntegration` rows from the `/x` layout loader. `has` means
  "installed and active in this company", not the descriptor's `active`.

## Data flow

Settings → Integrations (`x+/settings+/integrations.tsx`) reads `getIntegrationsWithHealth` (the
`integrations` view: each `integration` row with the company's `companyIntegration` row).

1. **Form install or save** (`installIntegration` in the drawer route `x+/settings+/integrations.$id.tsx`): `update: settings`.
   Then `requireFeature("INTEGRATIONS")` unless the id is whitelisted, then
   `isIntegrationInstallWithheld`. The form data is validated against the descriptor's
   `schema` and merged over the stored metadata. Then `upsertCompanyIntegration` runs.
2. **Hooks.** On the first install the action runs `onInstall` (registry first, then the
   descriptor). On a save of an installed integration it runs `onUpdate`. Both are
   best-effort: the row stays saved, and a hook failure shows as a flash.
3. **OAuth.** The card sends the window to `api+/integrations.$id.connect.ts`. The loader
   refuses a withheld install and an occupied role slot (not `oee`). It picks the scopes
   of the chosen `mode` and refuses an unknown mode. It writes a signed state cookie
   (`issueOAuthState`) and redirects to `buildIntegrationOAuthUrl`. Each provider then has
   its own callback (`api+/integrations.<id>.oauth.ts`), which calls `consumeOAuthState`,
   `upsertCompanyIntegration` and the provider's install hook.
4. **Piece connect.** `onClientInstall` calls `startIntegrationConnect`. The route
   `api+/integrations.connections.$piece.connect.ts` returns `{ url }` or `{ error }`; the
   callback is `api+/integrations.connections.callback.ts`.
5. **Errors.** A callback can only redirect, so it sends `?integration=<id>&error=<code>`.
   The list route words the code with `getIntegrationError` (`integration-errors.ts`).
6. **Uninstall.** `api.settings.deactivateCompanyIntegration` (`settings.server.ts`) checks
   the plan, sets the row inactive, runs `onUninstall`, and clears the health cache.

## Gates

An integration is offered only when every gate passes:

| Gate | Where | Examples |
|---|---|---|
| A constant | `active: true` / `false` in `config.tsx` | Linear, Mount, Xero (`true`); QuickBooks, Sage (`false`) |
| An env var | `active` reads `@carbon/auth` or `@carbon/env` | `!!JIRA_CLIENT_ID`, `!!RAMP_CLIENT_ID`, `!!GOOGLE_CLIENT_ID`, `STRIPE_CONNECT_ENABLED`, `CONTROLLED_ENVIRONMENT === false` (Slack) |
| A plan flag | `requireFeature` / `companyHasFeature` with `INTEGRATIONS` (`FEATURE_PLANS`: Business, Partner) | Every id except `INTEGRATION_WHITELIST` (`email`) |
| Early access | `internalOnly: true` → `isIntegrationComingSoon` | `onshape-v2`: Carbon Cloud shows "Coming soon" unless the user is staff or has the `integration-early-access` flag |

`defineIntegration` adds one more rule: if the descriptor has `oauth`, `active` is also false
while `oauth.clientId` is empty.

## Secrets

Secret metadata paths go to Supabase Vault; `companyIntegration.metadata` keeps only config.
Design: `.ai/specs/implemented/2026-08-15-integration-secret-encryption.md`.

- MUST list every secret path of a new integration in `SECRET_KEYS`. A path not listed is
  stored as plaintext.
- MUST read secrets with `resolveIntegrationSecrets` and a service-role client. It throws
  when a secret-bearing row has no vault entry (fail-closed).
- A `secret` setting left empty keeps its stored value: `splitSecrets` omits it and the
  vault RPC merges the partial bag.
- A webhook route MUST fail closed when `getWebhookSigningSecret` throws
  `IntegrationSecretUnavailableError`.

## Add a new integration

1. Pick the closest sibling by behavior: an OAuth tracker (Jira), an API-key client
   (Linear, Paperless Parts), an accounting provider (Xero, Rillet), a piece (Gmail).
   Name it in the plan. Copy its files and routes file for file.
2. Create `packages/ee/src/<dir>/config.tsx` with `defineIntegration`. Use a kebab-case
   `id`. Give `id`, `name`, `category`, `logo`, `description`, `shortDescription`,
   `images`, `settings` and `schema`. Import no `*.server` module in this file.
3. Set the `active` gate (table above). Set `providerRole` only for an accounting,
   spend or OEE provider.
4. Import the descriptor in `packages/ee/src/index.ts`. Add it to `integrations`.
5. Add its server hooks to `serverHooks` in `packages/ee/src/hooks.server.ts`.
6. Add its secret paths to `SECRET_KEYS`.
7. Write a migration that inserts the `integration` row (precedent `20261013030022_oee-provider.sql`).
   Without the row the `integrations` view omits the card, and `companyIntegration_id_fkey`
   refuses the install.
8. If the id needs every plan, add it to `INTEGRATION_WHITELIST`. Ask first.
9. Write `.claude/rules/<id>-integration.md`. Its `paths:` MUST cover `packages/ee/src/<dir>/**`;
   a `@carbon/checks` check will enforce this. Add its row to the root `AGENTS.md` router.
10. Add a user page under `docs/content/docs/integrations/`. Add its entry to that folder's `meta.json`.
11. Run `pnpm --filter @carbon/checks license-headers` to write the SPDX header of each new file.

## Registered, not active

| Integration | State |
|---|---|
| Radan | `packages/ee/src/radan/config.tsx` exists. `index.ts` comments out its import and its `integrations` entry. The route `api+/integrations.radan.$version.ts` still exists. |
| QuickBooks Online | In `integrations` with `active: false`. Its OAuth and accounts routes and its server hooks stay. |
| Sage Intacct | In `integrations` with `active: false`. No routes. |

Do not document an inactive integration on the docs site.

## Gotchas

- `companyIntegration_single_active_role` (migration `20260924133915_integration-provider-role.sql`)
  allows one active integration per role per company. The `oee` role is exempt.
- `sync_verify_integration` refuses an active row whose `metadata` does not match the
  `integration.jsonschema`. Keep secret paths out of that schema; they are not in the column.
- Importing `packages/ee/src/index.ts` reaches `@carbon/auth`, which checks the server env at
  import. A `*.service.ts` or a test MUST NOT import it. `sync/topology.ts` takes the
  registry slice as an argument for this reason.
- `no-integration-id-branching` (`@carbon/checks`) refuses a new branch on an integration id.
  Ask the descriptor (`providerRole`, `capabilities`) instead.

## Never

- Never put a server-only hook in `config.tsx`. Use `hooks.server.ts`.
- Never build an OAuth authorize URL in the browser. The scopes come from the descriptor
  in the connect route.
- Never write a secret to `companyIntegration.metadata` directly.

## Rule for each integration

| Integration | Developer docs |
|---|---|
| Jira | `jira-integration.md`, `issue-sync.md` |
| Linear | `linear-integration.md`, `issue-sync.md` |
| Xero, Rillet, QuickBooks | `accounting-sync-handlers.md`, `xero-webhooks.md`, `xero-api-contact-structure.md` |
| Ramp | `ramp-integration.md` |
| Sense (OEE) | `oee-provider.md` |
| Onshape | `onshape-panel.md` (the panel; it loads for all of `packages/ee/src/onshape/**`) |
| Gmail, Google Calendar, Slack (pieces) | `workflow-integrations.md` |
| Mount | `mount-integration.md` |
| Paperless Parts | `paperless-parts-integration.md` |
| Slack | `slack-integration.md` |
| Email, Gmail, Google Calendar | `email-integrations.md` |
| Stripe Connect | `packages/ee/src/stripe-connect/AGENTS.md` |

## Design history

| Integration | Specs | Plans | Research |
|---|---|---|---|
| Framework | `.ai/specs/implemented/2026-08-15-integration-secret-encryption.md`, `.ai/specs/implemented/2026-09-01-connection-reconnect-prompts.md` | `.ai/plans/implemented/2026-08-16-integration-secret-encryption.md`, `.ai/plans/implemented/2026-09-23-provider-roles-topology.md`, `.ai/plans/2026-09-01-connection-reconnect-prompts.md` | — |
| Jira, Linear | `.ai/specs/2026-10-17-issue-tracker-sync.md` | `.ai/plans/2026-10-17-issue-tracker-sync.md` | `.ai/research/issue-tracker-sync.md` |
| Accounting (Xero, Rillet, QuickBooks) | `.ai/specs/2026-08-12-accounting-sync-reconciler-unification.md`, `.ai/specs/2026-07-04-integration-surface.md` | `.ai/plans/2026-08-13-accounting-sync-automated-postings-only.md`, `.ai/plans/2026-08-14-xero-qbo-payment-push-parity.md`, `.ai/plans/2026-09-15-rillet-import-contacts.md` | `.ai/research/quickbooks-accounting-sync-engine.md` |
| Ramp | `.ai/specs/2026-09-19-ramp-integration.md`, `.ai/specs/implemented/2026-09-23-spend-management-push-only-mode.md`, `.ai/specs/2026-09-23-editable-imported-spend-documents.md` | `.ai/plans/2026-09-19-ramp-integration.md`, `.ai/plans/implemented/2026-09-23-spend-push-only-mode.md`, `.ai/plans/implemented/2026-09-23-spend-outbound-event-engine.md` | `.ai/research/ramp-transaction-sync.md`, `.ai/research/ramp-api-doc-verification.md`, `.ai/research/ramp-sandbox-verification.md`, `.ai/research/spend-management-one-way-push.md` |
| Sense (OEE) | `.ai/specs/2026-10-12-oee-provider-integration.md` | `.ai/plans/2026-10-12-oee-provider-integration.md`, `.ai/plans/2026-10-14-oee-review-fixes.md` | `.ai/research/oee-provider-integration.md` |
| Onshape | `.ai/specs/2026-08-28-onshape-app.md` | `.ai/plans/2026-10-18-onshape-assembler-fetch.md`, `.ai/plans/2026-10-23-onshape-standard-field-mapping.md`, `.ai/plans/2026-10-29-onshape-sync-change-notice-draft.md`, `.ai/plans/2026-10-30-onshape-assembly-part-models.md` | `.ai/research/2026-10-30-onshape-assembly-part-models-spike.md` |
| Slack | `.ai/specs/implemented/2026-09-01-slack-workflow-piece.md`, `.ai/specs/implemented/2026-09-01-slack-single-source-of-truth.md` | `.ai/plans/2026-09-01-slack-workflow-piece.md`, `.ai/plans/2026-09-01-slack-single-source-of-truth.md` | `.ai/research/2026-09-01-slack-workflow-piece.md` |
| Gmail, Google Calendar (pieces) | `.ai/specs/implemented/2026-09-01-gmail-workflow-piece.md`, `.ai/specs/implemented/2026-08-31-workflow-integration-outputs.md`, `.ai/specs/implemented/2026-09-04-integration-datetime-inputs.md` | `.ai/plans/2026-09-01-gmail-workflow-piece.md`, `.ai/plans/2026-08-27-workflow-integrations.md`, `.ai/plans/2026-08-27-workflow-integration-node.md` | `.ai/research/2026-09-01-gmail-workflow-piece.md`, `.ai/research/activepieces-integration-findings.md` |
| Email | `.ai/specs/2026-10-29-email-provider-choice.md` | `.ai/plans/2026-10-29-email-provider-choice.md` | `.ai/research/2026-10-29-email-provider-choice.md` |
| Mount, Paperless Parts, Stripe Connect | none | none | none |
| Not registered (Avalara, SolidWorks PDM) | `.ai/specs/2026-07-04-avalara-integration-foundation.md`, `.ai/specs/2026-08-04-solidworks-pdm-integration.md` | `.ai/plans/2026-07-04-avalara-integration-foundation.md`, `.ai/plans/2026-08-04-solidworks-pdm-integration.md` | `.ai/research/solidworks-pdm-integration.md` |
