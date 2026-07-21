# @carbon/ee

Enterprise edition — integrations registry, accounting sync (Xero), plan gating, exchange rates, Slack, email, Jira, Linear, Onshape, and storage rules.

## Always

- **Wrap sync DB writes in `withTriggersDisabled()`** — prevents sync loops (sync writes DB → event trigger → sync again)
- **Use `FEATURE_PLANS` as the single source of truth for plan gating** — both client (`usePlanGate`) and server (`plan.server.ts`) read from it
- **All external ID linking goes through `externalIntegrationMapping` table** — use `createMappingService()`, not per-entity `externalId` columns (deprecated)
- **Gating is a no-op off Cloud** — `companyHasPlan`/`requirePlan` short-circuit true when `CarbonEdition !== Edition.Cloud` or company is bypass-listed
- **Register server hooks in `hooks.server.ts`** — integration lifecycle hooks (healthcheck, install, uninstall) that need server-only imports go here, not in config files

## Ask First

- Adding a new accounting entity syncer (must implement `BaseEntitySyncer`, register in `SyncFactory`)
- Adding a new integration to the `integrations` array (needs config + optional server hooks)
- Changing `FEATURE_PLANS` gates or `INTEGRATION_WHITELIST`

## Never

- Implement DELETE sync (not implemented yet — log and skip)
- Hand-edit generated DB types — read the newest migration for schema truth
- Import server-only modules from integration config files (configs are bundled for both client and server)

## Validation Commands

```bash
pnpm --filter @carbon/ee test        # vitest
pnpm --filter @carbon/ee typecheck   # tsgo --noEmit
```

## Key Patterns

- **Accounting sync**: class-per-entity syncers in `accounting/providers/xero/entities/`; `SyncFactory.getSyncer()` dispatches
- **60s cooldown**: `SYNC_COOLDOWN_MS` skips recently-synced entities
- **Dependency sync**: transaction syncers use `ensureDependencySynced()` for JIT deps (e.g. push customer before invoice)
- **Integration pattern**: `defineIntegration()` → config with id, name, settings, OAuth, actions
- **Exports**: `./accounting`, `./plan`, `./plan.server`, `./exchange-rates.server`, `./slack.server`, `./hooks.server`, `./jira`, `./linear`, `./xero`, etc.

## Cross-References

- `.claude/rules/accounting-sync-handlers.md` — full sync architecture
- `.claude/rules/billing-system.md` — plan/edition gating details
- `packages/stripe/` — Stripe billing (Cloud only)
- `packages/lib/src/trigger.ts` — `trigger("sync-external-accounting", ...)` dispatch
- `packages/jobs/src/inngest/functions/integrations/` — Inngest sync entry points
