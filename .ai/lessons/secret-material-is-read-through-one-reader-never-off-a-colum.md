---
paths: []
triggers: ["resolveIntegrationSecrets", "readConnectionAccessToken", "resolveConnectionAuth", "access_token", "secretRef"]
promoted: null
---
# Secret material is read through ONE reader — never off a column

**Context:** After `20260817132607` moved integration tokens into the Vault, three readers kept
reading `companyIntegration.metadata.access_token` directly (`send-slack.ts`, `integrations.slack.interactive.ts`,
`notify.ts`). They did not fail — they got `undefined`, fell back or returned `[]`, and Slack DMs /
slash commands silently stopped for weeks. When Slack later moved to `integrationConnection`
(`20261026151304`), the same class of miss happened again with `notify.ts` because the consumer map
was built from module exports, not from a grep of the column.

**Rule:** A credential has exactly one reader (`resolveIntegrationSecrets` for `companyIntegration`,
`readConnectionAccessToken` / `resolveConnectionAuth` for `integrationConnection`). Before changing
where a secret lives, grep for the *column and id* (`"companyIntegration"` + `"slack"`,
`metadata.access_token`, `secretRef`) across `apps/` and `packages/`, not for function names — and
make the old path fail loudly (throw) rather than return `undefined`.

**Applies to:** every `companyIntegration` / `integrationConnection` reader; any future secret move.
