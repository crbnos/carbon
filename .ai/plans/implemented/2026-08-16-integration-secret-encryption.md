# Integration Secret Encryption via Supabase Vault — implementation plan

Status: IMPLEMENTED 2026-08-18 (all tasks; Task 8 blocker resolved by `7fc7f26aa`).

**Spec:** .ai/specs/implemented/2026-08-15-integration-secret-encryption.md
**Branch:** port-louis (or a dedicated `integration-secret-encryption`)

Implements spec decisions D1–D8. Encrypt third-party integration credentials into
Supabase Vault; `companyIntegration.metadata` keeps only non-secret config + a
`secretRef`. Closes NIST 800-171 **3.13.16**. Landing order is accounting-first
behind shared helpers, but the exit criterion is **zero plaintext secrets across
every integration** (D6).

## Progress
- [x] Task 1: Vault plumbing — extension, `secretRef`, RPC wrappers, delete trigger (round-trip verified; fixed create→`vault.update_secret` for in-place upsert)
- [x] Task 2: Regenerate DB types (RPCs + `secretRef` typed)
- [x] Task 3: `SECRET_KEYS` map + helpers (+ 11 unit tests); added `email` after config cross-check
- [x] Task 4: jsonschema rows stripped of secret keys (0 remain)
- [x] Task 5: providers read via resolve / write via persist (incl. slack notify + doc-sync found outside recon)
- [x] Task 6: settings cache/writes stop handling secret material
- [x] Task 7: reveal endpoint — VERIFIED end-to-end (authed → value; unknown key rejected; audit row written)
- [~] Task 8: masked+reveal UI + anti-overwrite (splitSecrets empty-skip) done; **BLOCKED on one design decision** — the EE config zod schemas `.min(1)`-require secret fields, so post-scrub editing an installed integration without re-entering its secret fails validation. Needs: optionalize secret fields in the config schemas + enforce presence at install/activation.
- [x] Task 9+10 (AMENDED 2026-08-18): the manual TS backfill script + the separate
  `secretRef IS NOT NULL`-gated scrub migration were **consolidated** into a single
  auto-applied, idempotent migration `20260817132607_backfill-and-scrub-integration-secrets.sql`
  (vault-move + strip in one pass; RAISEs on an unmapped secret-looking integration).
  The split was a deploy-ordering hazard: on auto-apply the scrub ran before the manual
  backfill set `secretRef`, matched zero rows, and never re-ran — leaving plaintext forever.
  `packages/jobs/src/scripts/backfill-integration-secrets.ts` and
  `…_scrub-integration-plaintext-secrets.sql` were deleted.
- [x] Task 9 (superseded): backfill script — VERIFIED (vaulted a seeded plaintext apiKey, stamped secretRef)
- [x] Task 10 (superseded): scrub + fail-closed — VERIFIED (plaintext gone, vault preserved, **0 plaintext remain**)
- [x] Task 11: verify — vault round-trip, backfill/scrub on real data, reveal e2e, delete-trigger cascade, ee suite 556, typecheck ee/jobs/erp all PASS

## Known follow-ups
- **Task 8 validation gap** (above) — the one blocker to a fully-usable settings form.
- Per-reveal TOTP re-challenge under CONTROLLED_ENVIRONMENT (currently relies on session MFA).
- The "Reveal" UI string needs translations (`/translate`).

## Dependencies
- Task 2 needs Task 1. Task 3 needs Task 2 (typed RPCs). Tasks 4 and 5–8 need Task 3.
- Task 9 needs 1–5 (helpers + schema in place). Task 10 needs Task 9 confirmed in prod-like data. Task 11 last.
- Tasks 5, 7, 8 are largely independent of each other once Task 3 lands — may run as parallel subagents.

> The whole change handles live credentials. If any provider has a secret field
> NOT captured by the `SECRET_KEYS` map (Task 3), or a read/write site not in the
> recon list (Task 5), **STOP and report — do not improvise.** A missed secret
> field either leaks (left in plaintext) or corrupts (scrubbed but not vaulted).

---

## Task 1: Migration — enable Vault, add `secretRef`, secret RPC wrappers + delete trigger

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/{ts}_integration-secret-vault.sql` (via the command; never hand-pick the timestamp)
- Copy from (precedent): `packages/database/supabase/migrations/20250304230559_nanoid.sql` (`CREATE EXTENSION IF NOT EXISTS` pattern), `20240119095150_integrations.sql` (the `companyIntegration` table + `verify_integration` trigger style)

**Steps:**
1. `pnpm db:migrate:new integration-secret-vault`
2. Paste EXACTLY:
   ```sql
   -- NIST 800-171 3.13.16: encrypt integration secrets in Supabase Vault.
   -- supabase_vault is pgsodium-backed; the supabase/postgres image preloads
   -- pgsodium in shared_preload_libraries. If this CREATE fails locally, the
   -- extension is unavailable — STOP and report (infra prerequisite), do not work around it.
   CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault CASCADE;

   ALTER TABLE "companyIntegration" ADD COLUMN IF NOT EXISTS "secretRef" TEXT;

   -- Upsert an integration's secret bag (flat {path: value} JSON) into the vault,
   -- keyed by a deterministic name; store the vault id back on the row.
   CREATE OR REPLACE FUNCTION upsert_integration_secret(p_company_id text, p_integration_id text, p_secret jsonb)
   RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
   DECLARE
     v_name text := 'integration:' || p_company_id || ':' || p_integration_id;
     v_id uuid;
   BEGIN
     SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
     IF v_id IS NULL THEN
       v_id := vault.create_secret(p_secret::text, v_name, 'Carbon integration secret');
     ELSE
       UPDATE vault.secrets SET secret = p_secret::text, updated_at = now() WHERE id = v_id;
     END IF;
     UPDATE "companyIntegration" SET "secretRef" = v_id::text
       WHERE "companyId" = p_company_id AND id = p_integration_id;
     RETURN v_id::text;
   END;
   $$;

   CREATE OR REPLACE FUNCTION get_integration_secret(p_company_id text, p_integration_id text)
   RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
   DECLARE
     v_ref text;
     v_secret text;
   BEGIN
     SELECT "secretRef" INTO v_ref FROM "companyIntegration"
       WHERE "companyId" = p_company_id AND id = p_integration_id;
     IF v_ref IS NULL THEN RETURN NULL; END IF;  -- caller applies transitional fallback / fails closed
     SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_ref::uuid;
     IF v_secret IS NULL THEN RETURN NULL; END IF;
     RETURN v_secret::jsonb;
   END;
   $$;

   CREATE OR REPLACE FUNCTION delete_integration_secret(p_company_id text, p_integration_id text)
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
   BEGIN
     DELETE FROM vault.secrets WHERE name = 'integration:' || p_company_id || ':' || p_integration_id;
   END;
   $$;

   -- Service-role only. The app calls these via getCarbonServiceRole(); no user
   -- client (anon/authenticated) may decrypt a secret.
   REVOKE ALL ON FUNCTION upsert_integration_secret(text,text,jsonb) FROM PUBLIC, anon, authenticated;
   REVOKE ALL ON FUNCTION get_integration_secret(text,text)         FROM PUBLIC, anon, authenticated;
   REVOKE ALL ON FUNCTION delete_integration_secret(text,text)      FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON FUNCTION upsert_integration_secret(text,text,jsonb) TO service_role;
   GRANT EXECUTE ON FUNCTION get_integration_secret(text,text)          TO service_role;
   GRANT EXECUTE ON FUNCTION delete_integration_secret(text,text)       TO service_role;

   -- Cascade: drop the paired vault secret when the integration row is deleted
   -- (vault.secrets does not cascade on its own).
   CREATE OR REPLACE FUNCTION drop_integration_secret_on_delete()
   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
   BEGIN
     DELETE FROM vault.secrets WHERE name = 'integration:' || OLD."companyId" || ':' || OLD.id;
     RETURN OLD;
   END;
   $$;
   DROP TRIGGER IF EXISTS trg_drop_integration_secret ON "companyIntegration";
   CREATE TRIGGER trg_drop_integration_secret
     AFTER DELETE ON "companyIntegration"
     FOR EACH ROW EXECUTE FUNCTION drop_integration_secret_on_delete();

   NOTIFY pgrst, 'reload schema';
   ```
3. `pnpm db:migrate`. If `CREATE EXTENSION supabase_vault` errors, STOP and report — the local/target Postgres lacks pgsodium; that is an infra prerequisite, not something to patch around.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -At -c "SELECT extname FROM pg_extension WHERE extname='supabase_vault';"
# Expected: supabase_vault
psql "$SUPABASE_DB_URL" -At -c "SELECT count(*) FROM information_schema.columns WHERE table_name='companyIntegration' AND column_name='secretRef';"
# Expected: 1
psql "$SUPABASE_DB_URL" -At -c "SELECT proname FROM pg_proc WHERE proname IN ('upsert_integration_secret','get_integration_secret','delete_integration_secret') ORDER BY 1;"
# Expected: three rows
```
Stack down ⇒ blocked, not done.

**Out of scope:** touching `verify_integration` (Task 4 handles the schema); any provider code.

---

## Task 2: Regenerate DB types

**Depends on:** Task 1
**Steps:** `pnpm run generate:types`

**Verify:**
```bash
grep -n "get_integration_secret\|upsert_integration_secret\|secretRef" packages/database/src/types.ts | head
# Expected: the three RPCs typed with Args {p_company_id,p_integration_id,...}; companyIntegration row has secretRef: string | null
```

---

## Task 3: `SECRET_KEYS` map + secret helpers in `@carbon/ee`

**Depends on:** Task 2
**Files:**
- Create: `packages/ee/src/integrations/secrets.ts`
- Create: `packages/ee/src/integrations/secrets.test.ts`
- Modify: `packages/ee/src/index.ts` — export the helpers
- Copy from (precedent): `packages/ee/src/accounting/core/models.ts` (`normalizeStoredCredentials` transitional-shape pattern), `packages/auth/src/lib/supabase/client.server.ts` (`getCarbonServiceRole`)

**Steps:**
1. Define the secret-key map (dot-paths into `metadata`). Cross-check each against the provider `config.ts` `type:"secret"|"password"` fields AND the jsonschema (Task 4). If any provider has a secret field not listed here, STOP and report:
   ```ts
   // The ONLY place that declares which metadata keys are secret. Dot-paths.
   export const SECRET_KEYS: Record<string, string[]> = {
     linear:            ["apiKey"],
     slack:             ["access_token"],
     jira:              ["credentials.accessToken", "credentials.refreshToken"],
     onshape:           ["credentials.accessToken", "credentials.refreshToken"],
     xero:              ["credentials.accessToken", "credentials.refreshToken"],
     quickbooks:        ["credentials.accessToken", "credentials.refreshToken"],
     rillet:            ["credentials.apiKey", "credentials.providerMetadata.webhookToken"],
     "paperless-parts": ["apiKey", "secretKey"],
     resend:            ["apiKey"],
     // exchange-rates-v1: none (apiKey is env-based). email/sage: verify config; add if a secret lands in metadata.
   };
   ```
2. Implement (with dot-path get/set helpers — do NOT pull in lodash; small local `getPath`/`setPath`/`deletePath`):
   - `class IntegrationSecretUnavailableError extends Error` (D8).
   - `splitSecrets(integrationId, metadata): { config, secrets }` — moves each `SECRET_KEYS` path out of a copy of `metadata` into a flat `{ [path]: value }` bag; returns the stripped `config` and the `secrets` bag (omitting undefined paths).
   - `persistIntegrationSecrets(serviceClient, companyId, integrationId, metadata)` — `splitSecrets`, then `serviceClient.rpc("upsert_integration_secret", { p_company_id, p_integration_id, p_secret: secrets })`, then write the stripped `config` back to `companyIntegration.metadata` (via the settings service; Task 6 wires the call sites). Returns the stripped config.
   - `resolveIntegrationSecrets(serviceClient, companyId, integrationId, metadata)` — reads the bag via `rpc("get_integration_secret", ...)`. If it returns a bag, `setPath` each back into a **copy** of `metadata` and return the merged object (so providers keep reading `metadata.credentials.accessToken` unchanged). **Transitional fallback (D7):** if the row's `secretRef` is null / rpc returns null AND `metadata` still contains the plaintext at those paths, return `metadata` as-is. If `secretRef` is set but the rpc returns null → throw `IntegrationSecretUnavailableError` (fail closed, D8).
3. Unit tests (`secrets.test.ts`): round-trip split→merge for a nested accounting credential and a flat linear apiKey; masking never returned; fail-closed when secretRef set but bag missing; transitional fallback when secretRef null.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- secrets
# Expected: all secrets.test.ts pass
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: PASS
```

**Out of scope:** changing provider call sites (Task 5); UI (Task 8).

---

## Task 4: Migration — rewrite integration `jsonschema` rows to drop secret keys

**Depends on:** Task 2 (ordering only; no type impact)
**Files:**
- Create: `packages/database/supabase/migrations/{ts}_integration-jsonschema-drop-secrets.sql`
- Copy from (precedent): `20240930162032_exchange-rates-api-key.sql` (an `UPDATE integration SET jsonschema=...` that already dropped a secret key)

**Steps:**
1. `pnpm db:migrate:new integration-jsonschema-drop-secrets`
2. `UPDATE "integration" SET "jsonschema" = ... ` for each row whose schema still lists a secret property (from recon): `linear` (drop `apiKey`), `paperless-parts` (drop `apiKey`,`secretKey`), `resend` (drop `apiKey`), `slack` (drop `access_token`), `onshape` (drop `credentials.accessToken`/`refreshToken` from the nested schema). Accounting (`xero`/`quickbooks`/`rillet`) and `jira` are already `{}` — no change. Each `UPDATE` idempotent (guarded by id). End with `NOTIFY pgrst, 'reload schema';` only if needed (data change — not required, but harmless).
3. `pnpm db:migrate`.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -At -c "SELECT id FROM integration WHERE jsonschema::text LIKE '%apiKey%' OR jsonschema::text LIKE '%secretKey%' OR jsonschema::text LIKE '%access_token%' OR jsonschema::text LIKE '%accessToken%';"
# Expected: no rows
```

**Out of scope:** editing historical migrations (never); the `verify_integration` trigger body (unchanged — it validates the now-secret-free schema).

---

## Task 5: Route every provider read + token-refresh write through the helpers

**Depends on:** Task 3
**Files (from recon — read sites):**
- Modify: `packages/ee/src/linear/lib/client.ts:33` — replace `integration.metadata as {apiKey}` with a `resolveIntegrationSecrets(...)` read.
- Modify: `packages/ee/src/jira/lib/client.ts:159` (`getCredentials`) and the refresh write at `packages/ee/src/jira/lib/service.ts:31-56` (`updateJiraCredentials` → `persistIntegrationSecrets`).
- Modify: `packages/ee/src/onshape/lib/client.ts:609-657` (read) and the inline refresh write at `:633-651` → `persistIntegrationSecrets`.
- Modify: `apps/erp/app/modules/settings/settings.server.ts:235-256` (`getSlackIntegration`, reads `metadata.access_token`) → resolve via helper.
- Modify: accounting shared reader `packages/ee/src/accounting/core/service.ts:160-182` (read) and the `onTokenRefresh` write at `:186-220` → `persistIntegrationSecrets`.
- Modify: paperless read `packages/jobs/src/inngest/functions/integrations/paperless-parts.ts:126`.
- **Non-secret mirror (recon flag):** `getAccountingIntegration` filters on `metadata->credentials->>tenantId` / `->providerMetadata->>tenantId` (`accounting/core/service.ts:97-100`). `tenantId`/`realmId` are NON-secret and MUST stay in `metadata` (they are not in `SECRET_KEYS`), so this filter keeps working. Confirm `splitSecrets` leaves `credentials.providerMetadata.tenantId/realmId` in `config`. If the filter still breaks, STOP and report.

**Steps:**
1. For each read site: obtain a service-role client (these paths already run server-side / in jobs), call `resolveIntegrationSecrets(...)`, and read the merged metadata exactly as before (shape is unchanged).
2. For each token-refresh write site (jira, onshape, accounting `onTokenRefresh`, plus the initial OAuth stores listed in recon §4): replace the direct `companyIntegration.metadata` update with `persistIntegrationSecrets(...)` so refreshed tokens land in the vault, not the column.
3. Leave `exchange-rates` untouched (env-based, no metadata secret).

**Verify:**
```bash
grep -rn "metadata.*apiKey\|metadata.*access_token\|metadata.*accessToken" packages/ee/src apps/erp/app/modules/settings packages/jobs/src/inngest/functions/integrations --include="*.ts"
# Expected: no direct plaintext secret reads remain (all go through resolveIntegrationSecrets)
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp
# Expected: PASS
```

**Out of scope:** scrubbing plaintext (Task 10 — the transitional fallback means reads still work pre-scrub).

---

## Task 6: Settings service + Redis cache stop handling secret material

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.server.ts:110-211` (`getCompanyIntegrations`, Redis-cached) — do NOT serialize secret material into Redis. Cache only the stripped (non-secret) metadata; the cache key `integrations:${companyId}` stays.
- Modify: `apps/erp/app/modules/settings/settings.service.ts:952-970` (`updateIntegrationMetadata`) and `settings.server.ts:264-289` (`upsertCompanyIntegration`) — route secret-bearing writes through `persistIntegrationSecrets` so the column never receives a secret.

**Steps:**
1. In the cache path, strip secret keys (`splitSecrets(...).config`) before `redis.set`. Since Task 5 already prevents secrets from reaching the column post-backfill, this mainly protects the transitional window and the cache.
2. In the write paths, split → vault + stripped config to the column.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: PASS
# Manual: after saving an integration, inspect Redis integrations:<companyId> — no token/apiKey present.
```

**Out of scope:** UI (Task 7/8).

---

## Task 7: Reveal endpoint (service-role, gated, audited)

**Depends on:** Task 3
**Files:**
- Create: `apps/erp/app/routes/x+/settings+/integrations.$id.reveal.tsx` (action-only route)
- Copy from (precedent): an existing `settings_update`-gated action under `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` (permission gate + `getCarbonServiceRole`), and `packages/database/src/audit.ts` `insertAuditLogEntries` (the reveal audit write)

**Steps:**
1. `requirePermissions(request, { update: "settings" })`; read the requested secret key from the form.
2. Under `CONTROLLED_ENVIRONMENT` (read via `@carbon/env`), require a fresh MFA challenge before revealing (reuse the MFA session helpers per `.ai/plans/2026-08-15-totp-mfa.md`); otherwise skip.
3. Resolve the secret with a service-role client via `resolveIntegrationSecrets(...)` and return ONLY the requested key's value.
4. Emit an audit event via `insertAuditLogEntries(serviceClient, companyId, [{ ... }])` — action = "viewed integration secret", actor = userId, entityType/entityId = the integration id, timestamp now. (Reuses the `insert_audit_log_batch` path; no new audit plumbing.)

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: PASS
# Manual (/test in Task 11): reveal returns the value AND writes one audit row; a settings_view-only user is denied.
```

**Out of scope:** building an in-app audit viewer for these events (they show in the existing audit UI).

---

## Task 8: Settings UI — masked default + Reveal + anti-overwrite save (D4/D4a)

**Depends on:** Tasks 6, 7
**Files:**
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — loader (`:497-825`) MUST NOT send secret values to the browser; pass a masked placeholder + a `configured: boolean` per secret field. Action (`:1360-1470`) must apply the anti-overwrite rule.
- Modify: `apps/erp/app/modules/settings/ui/Integrations/IntegrationForm.tsx` — `SecretField` (`:310-333`) becomes masked-by-default with a **Reveal** button (calls the Task 7 route) + dirty-tracking.
- Copy from (precedent): the existing `SecretField` at `IntegrationForm.tsx:310-333` (already wraps `@carbon/form` `Password` with reveal + copy) — extend it, don't rewrite.

**Steps:**
1. Loader: for each `type:"secret"`/`"password"` field, send `""`/mask + `configured=true|false` (from whether the vault bag / `secretRef` holds it) — never the real value.
2. `SecretField`: show masked; add **Reveal** (fetches plaintext from the reveal route on demand) and keep Copy. Track a `secretChanged` flag set only when the user edits the field.
3. Action anti-overwrite (D4a): write the secret to the vault **only if `secretChanged`**; an untouched field omits the secret from the update payload. Belt-and-suspenders: the server action rejects/ignores a submitted value equal to the mask sentinel. Prefer the explicit `secretChanged` flag over string comparison.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: PASS
# Manual (Task 11): save non-secret config without touching the key → key unchanged in vault; edit the key → vault updated; Reveal shows the value + writes an audit row.
```

**Out of scope:** provider-specific form fields beyond the secret inputs.

---

## Task 9: Backfill script — plaintext → Vault (no scrub yet)

**Depends on:** Tasks 1,3,4,5
**Files:**
- Create: `packages/database/src/scripts/backfill-integration-secrets.ts` (run as a deploy step like `seed.ts`)
- Copy from (precedent): `packages/database/src/seed.ts` (service-role client bootstrap + run-as-script shape)

**Steps:**
1. For every `companyIntegration` row: `splitSecrets(id, metadata)`; if the secrets bag is non-empty, `upsert_integration_secret(...)` (sets `secretRef`). **Do NOT strip plaintext from the column yet** — the transitional fallback (Task 3) keeps reads working. Idempotent: re-running upserts the same vault name in place; a row already carrying `secretRef` is skipped or re-upserted harmlessly.
2. Log per-integration counts; log any integration id NOT in `SECRET_KEYS` that nonetheless has secret-looking keys (STOP-and-report signal, per the top-of-plan rule).

**Verify:**
```bash
pnpm --filter @carbon/database tsx src/scripts/backfill-integration-secrets.ts   # against a dev DB
psql "$SUPABASE_DB_URL" -At -c "SELECT count(*) FROM \"companyIntegration\" WHERE \"secretRef\" IS NOT NULL;"
# Expected: equals the number of integrations that carry secrets
psql "$SUPABASE_DB_URL" -At -c "SELECT count(*) FROM vault.secrets WHERE name LIKE 'integration:%';"
# Expected: matches the above
```

**Out of scope:** the scrub (Task 10) — must be a separate, later step so a bad backfill can't destroy the only copy.

---

## Task 10: Scrub plaintext + remove the transitional fallback

**Depends on:** Task 9 (confirmed: every secret-bearing row has a `secretRef` and reads succeed on vault)
**Files:**
- Create: `packages/database/supabase/migrations/{ts}_scrub-integration-plaintext-secrets.sql` (strip `SECRET_KEYS` paths from `companyIntegration.metadata`)
- Modify: `packages/ee/src/integrations/secrets.ts` — remove the transitional plaintext fallback from `resolveIntegrationSecrets` (a missing bag now always fails closed, D8).

**Steps:**
1. Migration: for each integration id, remove its `SECRET_KEYS` paths from `metadata` (JSONB `#-` for top-level; nested paths need a small `jsonb_set`/`#-` per path). Guard: only scrub rows whose `secretRef IS NOT NULL` (never scrub a row we didn't vault).
2. Remove the fallback branch in `resolveIntegrationSecrets`; add/keep the `IntegrationSecretUnavailableError` throw.
3. Update `secrets.test.ts` to drop the fallback case and assert fail-closed.

**Verify:**
```bash
psql "$SUPABASE_DB_URL" -At -c "SELECT count(*) FROM \"companyIntegration\" WHERE metadata::text ~ '(access_token|accessToken|refreshToken|\"apiKey\"|secretKey|webhookToken)';"
# Expected: 0  (no plaintext secret remains anywhere)
pnpm --filter @carbon/ee test -- secrets
# Expected: pass (fail-closed, no fallback)
```
This count being **0** is the spec's exit criterion (D6). If it is not 0, an integration was missed — STOP and report which.

**Out of scope:** none — this is the closing step.

---

## Task 11: Verify — typecheck + provider smoke + `/test` reveal + anti-overwrite

**Depends on:** Tasks 1–10
**Steps:**
1. Scoped typecheck: `pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp --filter=@carbon/database`
2. `pnpm --filter @carbon/ee test`
3. `/test` (requires `crbn up`): (a) an accounting or Slack sync still authenticates end-to-end (proves vault read on a live provider path); (b) in Settings → Integrations, reveal a key → value shown + one audit row written; (c) save non-secret config without touching the key → the vaulted secret is unchanged (anti-overwrite); (d) a `settings_view`-only user cannot reveal.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/ee --filter=@carbon/jobs --filter=erp --filter=@carbon/database
# Expected: all PASS
```
Plus the four `/test` checks passing and the Task 10 plaintext count = 0.

**Out of scope:** the chart/infra items (KMS-at-rest already covers vault storage); those live in `helm/niamey`.
