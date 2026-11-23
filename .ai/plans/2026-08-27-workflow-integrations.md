# Third-party integration steps in Workflows (Activepieces-backed) — implementation plan

**Spec / source:** `.ai/specs/2026-08-27-workflow-integrations.md`
**Research:** `.ai/research/activepieces-integrations.md`, `.ai/research/workflows-catalog-refresher.md`
**Branch:** `feat/active-pieces-integration`

Scope of v1: one piece (Google Calendar), OAuth2 only, actions only, several named
connections per company. Everything else is listed under Non-goals in the spec.

## Progress

- [x] Task 1: Migration — `integrationConnection` table, RLS, vault RPCs
- [x] Task 2: Regenerate database types
- [x] Task 3: Add Google OAuth env vars
- [x] Task 4: Add the pinned piece dependency, allowlist and registry loader
- [x] Task 5: Piece property ⇄ Carbon value-type mapping
- [x] Task 6: Teach the catalog the `piece` route block
- [x] Task 7: Fifth generator input — emit piece actions
- [x] Task 8: Connections service (CRUD + fresh-token resolution)
- [x] Task 9: OAuth connect and callback routes
- [x] Task 10: Settings → Integrations connections panel
- [x] Task 11: The integration action executor
- [x] Task 12: Smart-dropdown options endpoint
- [x] Task 13: Builder — connection picker and dynamic options
- [x] Task 14: End-to-end verification — run log at `.ai/runs/2026-08-27-workflow-integrations.md`. Every automated gate passes; every BROWSER criterion is unverified pending a Google Cloud OAuth app.

## Dependencies

```
1 → 2 → 3
4 → 5 → 6 → 7            (5 and 6 are independent of each other; both need 4)
2 + 4 → 8 → 9 → 10
7 + 8 → 11
8 + 5 → 12 → 13
everything → 14
```

Tasks 5 and 6 may run in parallel. Tasks 9–10 and 11 may run in parallel once 8 lands.

---

## Task 1: Migration — `integrationConnection` table, RLS, vault RPCs

**Depends on:** none

**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_workflow-integration-connections.sql` (created by the command below)
- Copy from (precedent): `packages/database/supabase/migrations/20260817122916_integration-secret-vault.sql` (the three vault RPCs + the delete trigger) and `packages/database/supabase/migrations/20250201181148_rls-refactor.sql` lines 719–760 (the `companyIntegration` RLS policy shape)

**Steps:**

1. Create the migration file:
   ```bash
   pnpm db:migrate:new workflow-integration-connections
   ```
2. Write the table. `id('icn')` follows the repo's prefixed-id convention; the composite
   primary key `("id", "companyId")` is mandatory for every Carbon table.
   ```sql
   CREATE TABLE "integrationConnection" (
       "id" TEXT NOT NULL DEFAULT id('icn'),
       "companyId" TEXT NOT NULL,
       "pieceName" TEXT NOT NULL,
       "name" TEXT NOT NULL,
       "authType" TEXT NOT NULL DEFAULT 'OAUTH2',
       "accountLabel" TEXT,
       "metadata" JSONB NOT NULL DEFAULT '{}',
       "secretRef" TEXT,
       "expiresAt" TIMESTAMP WITH TIME ZONE,
       "refreshingAt" TIMESTAMP WITH TIME ZONE,
       "status" TEXT NOT NULL DEFAULT 'Active',
       "lastError" TEXT,
       "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
       "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
       "updatedBy" TEXT REFERENCES "user"("id"),
       "updatedAt" TIMESTAMP WITH TIME ZONE,
       CONSTRAINT "integrationConnection_pkey" PRIMARY KEY ("id", "companyId"),
       CONSTRAINT "integrationConnection_companyId_fkey" FOREIGN KEY ("companyId")
         REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
       CONSTRAINT "integrationConnection_status_check"
         CHECK ("status" IN ('Active', 'Expired', 'Revoked')),
       CONSTRAINT "integrationConnection_name_unique" UNIQUE ("companyId", "pieceName", "name")
   );

   CREATE INDEX "integrationConnection_companyId_pieceName_idx"
     ON "integrationConnection" ("companyId", "pieceName");
   ```
3. Add RLS, copying the `companyIntegration` policy shape verbatim and only changing the table
   name — same `settings_view` / `settings_create` / `settings_update` / `settings_delete` gates:
   ```sql
   ALTER TABLE "integrationConnection" ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "SELECT" ON "public"."integrationConnection"
   FOR SELECT USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission ('settings_view'))::text[])
   );

   CREATE POLICY "INSERT" ON "public"."integrationConnection"
   FOR INSERT WITH CHECK (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission ('settings_create'))::text[])
   );

   CREATE POLICY "UPDATE" ON "public"."integrationConnection"
   FOR UPDATE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission ('settings_update'))::text[])
   );

   CREATE POLICY "DELETE" ON "public"."integrationConnection"
   FOR DELETE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission ('settings_delete'))::text[])
   );
   ```
4. Add three vault RPCs. The existing `upsert_integration_secret` / `get_integration_secret` /
   `delete_integration_secret` are hard-wired to the `companyIntegration` table and its
   `'integration:' || companyId || ':' || id` secret name, so they cannot be reused. Mirror them
   exactly against the new table, with the secret name prefix `connection:`:
   ```sql
   CREATE OR REPLACE FUNCTION upsert_connection_secret(p_company_id text, p_connection_id text, p_secret jsonb)
   RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
   DECLARE
     v_name text := 'connection:' || p_company_id || ':' || p_connection_id;
     v_id uuid;
   BEGIN
     SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
     IF v_id IS NULL THEN
       v_id := vault.create_secret(p_secret::text, v_name, 'Carbon integration connection secret');
     ELSE
       PERFORM vault.update_secret(v_id, p_secret::text);
     END IF;
     UPDATE "integrationConnection" SET "secretRef" = v_id::text
       WHERE "companyId" = p_company_id AND "id" = p_connection_id;
     RETURN v_id::text;
   END $$;

   CREATE OR REPLACE FUNCTION get_connection_secret(p_company_id text, p_connection_id text)
   RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
   DECLARE
     v_ref text;
     v_secret text;
   BEGIN
     SELECT "secretRef" INTO v_ref FROM "integrationConnection"
       WHERE "companyId" = p_company_id AND "id" = p_connection_id;
     IF v_ref IS NULL THEN RETURN NULL; END IF;
     SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE id = v_ref::uuid;
     IF v_secret IS NULL THEN RETURN NULL; END IF;
     RETURN v_secret::jsonb;
   END $$;

   CREATE OR REPLACE FUNCTION delete_connection_secret(p_company_id text, p_connection_id text)
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
   BEGIN
     DELETE FROM vault.secrets
       WHERE name = 'connection:' || p_company_id || ':' || p_connection_id;
     UPDATE "integrationConnection" SET "secretRef" = NULL
       WHERE "companyId" = p_company_id AND "id" = p_connection_id;
   END $$;
   ```
5. Add the delete trigger so a deleted row does not strand its vault secret (vault does not
   cascade), copying `drop_integration_secret_on_delete` from the precedent migration:
   ```sql
   CREATE OR REPLACE FUNCTION drop_connection_secret_on_delete()
   RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
   BEGIN
     DELETE FROM vault.secrets
       WHERE name = 'connection:' || OLD."companyId" || ':' || OLD.id;
     RETURN OLD;
   END $$;

   CREATE TRIGGER "integrationConnection_drop_secret"
     AFTER DELETE ON "integrationConnection"
     FOR EACH ROW EXECUTE FUNCTION drop_connection_secret_on_delete();
   ```
6. Grant execute on the three RPCs to `service_role` only, matching the precedent migration's
   grant block. Read that block and copy its exact form — do NOT grant to `authenticated`.
7. Apply it:
   ```bash
   pnpm db:migrate
   ```

**Verify:**
```bash
pnpm db:migrate
# Expected: the migration applies with no error.
```
Then confirm the RPCs exist and the table is protected — run in your local database:
```sql
SELECT proname FROM pg_proc
 WHERE proname IN ('upsert_connection_secret','get_connection_secret','delete_connection_secret');
-- Expected: 3 rows.
SELECT relrowsecurity FROM pg_class WHERE relname = 'integrationConnection';
-- Expected: t
```

**Out of scope:** any change to `companyIntegration`, its RPCs, or its policies. The 12 existing
integrations must keep working untouched.

> If `get_companies_with_employee_permission` or the `id()` function is not present in this
> database, STOP and report — do not invent a substitute.

---

## Task 2: Regenerate database types

**Depends on:** Task 1

**Files:**
- Modify (generated): `packages/database/src/types.ts`, `packages/database/supabase/functions/lib/types.ts`

**Steps:**
1. Run the generator. This must happen before any typecheck that touches the new table —
   `@carbon/database` types are generated, never hand-edited.
   ```bash
   pnpm run generate:types
   ```
2. Commit the regenerated files alongside the migration.

**Verify:**
```bash
grep -c "integrationConnection" packages/database/src/types.ts
# Expected: a number greater than 0.
```

**Out of scope:** hand-editing any generated type. If the table is missing from the output, the
migration did not apply — go back to Task 1.

---

## Task 3: Add Google OAuth env vars

**Depends on:** none (do it alongside Task 1)

**Files:**
- Modify: `packages/env/src/index.ts` — add three exports
- Copy from (precedent): the `ONSHAPE_CLIENT_ID` declaration at `packages/env/src/index.ts:252`

**Steps:**
1. Add, following the exact `getEnv(...)` shape used by `ONSHAPE_CLIENT_ID` immediately above:
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URL`.
2. Mark them optional in the same way Onshape's are, so a developer without Google credentials
   can still boot the app. A piece whose credentials are absent must be listed as unavailable
   rather than crashing the Integrations page (handled in Task 10).
3. Add the three names to `.env.example` if that file exists at the repo root, with empty values
   and a comment pointing at the Google Cloud Console.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/env
# Expected: no errors.
```

**Out of scope:** committing any real credential value. Never put a client secret in the repo.

---

## Task 4: Add the pinned piece dependency, allowlist and registry loader

**Depends on:** none

**Files:**
- Modify: `packages/jobs/package.json` — add the dependency, pinned exactly
- Create: `packages/jobs/src/workflows/integrations/allowlist.ts`
- Create: `packages/jobs/src/workflows/integrations/registry.ts`
- Create: `packages/jobs/src/workflows/integrations/registry.test.ts`

**Steps:**
1. Add the dependency with an **exact** version — no `^`, no `~`. The spec's Design Decisions
   require exact pins so an upstream release cannot silently change executed code:
   ```bash
   pnpm --filter @carbon/jobs add @activepieces/piece-google-calendar@0.10.3
   ```
   Then edit `packages/jobs/package.json` to make sure the recorded range is the bare string
   `"0.10.3"`, not `"^0.10.3"`.
2. Write `allowlist.ts` — the single hand-written declaration of what we expose:
   ```ts
   export interface AllowlistEntry {
     package: string;
     version: string;
     label: string;
     actions: readonly string[];
   }

   export const PIECE_ALLOWLIST: Record<string, AllowlistEntry> = {
     "google-calendar": {
       package: "@activepieces/piece-google-calendar",
       version: "0.10.3",
       label: "Google Calendar",
       actions: [
         "create_google_calendar_event",
         "google_calendar_get_events"
       ]
     }
   };

   export type PieceName = keyof typeof PIECE_ALLOWLIST;
   ```
3. Write `registry.ts`. It is the **only** module allowed to import a piece package, so nothing
   else can accidentally pull Node-only code into a browser bundle:
   ```ts
   export async function loadPiece(name: string): Promise<Piece>;
   export async function getPieceAction(name: string, action: string): Promise<PieceAction>;
   export async function getPieceOAuth2Auth(name: string): Promise<OAuth2AuthDeclaration>;
   ```
   - `loadPiece` dynamically imports `PIECE_ALLOWLIST[name].package` and returns the exported
     piece object (for Google Calendar the export is named `googleCalendar`; find the export by
     picking the first value that has both `auth` and an `actions()` function, so a differently
     named export in a future piece still resolves).
   - `getPieceAction` throws a named error when the action is not in that entry's `actions` list —
     the allowlist, not the piece, decides what we expose.
   - `getPieceOAuth2Auth` handles `piece.auth` being an **array** (Google Calendar exposes
     `['OAUTH2', 'CUSTOM_AUTH']`) and returns the `OAUTH2` member, throwing when there is none.
     v1 supports OAuth2 only.
4. Write `registry.test.ts` asserting, against the real installed package: the piece loads;
   `create_google_calendar_event` resolves; a non-allowlisted action name throws;
   `getPieceOAuth2Auth("google-calendar").authUrl === "https://accounts.google.com/o/oauth2/auth"`.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- registry
# Expected: all tests pass, including the auth URL assertion.
```

**Out of scope:** importing any piece package from `packages/workflows` or from `apps/erp`.
`packages/workflows` compiles for the browser at ES2019 and must never see piece code.

> If `piece.actions()` is not a function on the installed version, STOP and report — the piece
> API has changed since the spike and the mapping in Task 5 needs rechecking.

---

## Task 5: Piece property ⇄ Carbon value-type mapping

**Depends on:** Task 4

**Files:**
- Create: `packages/jobs/src/workflows/integrations/properties.ts`
- Create: `packages/jobs/src/workflows/integrations/properties.test.ts`

**Steps:**
1. Write `toValueType(property)` mapping a piece property to a Carbon `ValueType` from
   `@carbon/workflows` (`t.string`, `t.number`, `t.boolean`, `t.date`, `t.list(...)`). Type
   imports only — never a value import that would drag piece code in. Map:

   | Piece `type` | Carbon type |
   |---|---|
   | `SHORT_TEXT`, `LONG_TEXT` | `t.string` |
   | `NUMBER` | `t.number` |
   | `CHECKBOX` | `t.boolean` |
   | `DATE_TIME` | `t.date` |
   | `ARRAY` | `t.list(t.string)` |
   | `STATIC_DROPDOWN` | `t.string` + `choices` read off `property.options.options` |
   | `DROPDOWN` | `t.string` + a `dynamicOptions: true` marker (resolved at edit time, Task 12) |
   | `MULTI_SELECT_DROPDOWN` | `t.list(t.string)` + the same choices/marker rule |

2. Every other kind (`OBJECT`, `JSON`, `FILE`, `DYNAMIC`, `MARKDOWN`, …) **throws**
   `UnmappablePropertyError` carrying the piece, action and property names. The generator in
   Task 7 turns that into a build failure. A half-described action must never be emitted.
3. Write `toPropsValue(actionProps, inputs)` — the inverse, converting resolved Carbon
   `RuntimeValue`s back into the plain object a piece's `run()` expects. A date becomes an ISO
   string; a list becomes a plain array; an absent optional input is omitted rather than sent as
   `null` (pieces branch on `undefined`).
4. Write `properties.test.ts` covering: each mapped kind; that `STATIC_DROPDOWN` carries its
   three `send_notifications` choices from the real piece; that `OBJECT` throws with all three
   names in the message; and a `toPropsValue` round-trip for the create-event inputs.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- properties
# Expected: all tests pass, including the UnmappablePropertyError message assertions.
```

**Out of scope:** supporting `OBJECT`/`JSON`/`FILE`/`DYNAMIC`. They are Non-goals for v1 and must
fail loudly, not degrade.

---

## Task 6: Teach the catalog the `piece` route block

**Depends on:** Task 4

**Files:**
- Modify: `packages/workflows/src/catalog/build.ts` — add `piece` to `BuiltAction`
- Modify: `packages/workflows/src/catalog/catalog.ts` — `getActionRoute` returns it
- Modify: `packages/workflows/src/catalog/catalog.test.ts` — cover the new route
- Copy from (precedent): the existing `call` and `update` route blocks in the same two files

**Steps:**
1. Add to `BuiltAction` an optional `piece?: { name: string; action: string }`, documented in the
   same style as the existing `call` and `update` fields ("Set by the generator; never
   hand-written").
2. Extend `getActionRoute` so it surfaces `piece` alongside `call` and `update`. Routing must stay
   **off the catalog entry**, never off the id's shape — the existing comment in
   `packages/jobs/src/workflows/actions/services.ts` states this rule and it applies here.
3. Add a `catalog.test.ts` case asserting that an action with a `piece` block returns it from
   `getActionRoute`, and that an action without one returns `piece` as `undefined`.
4. Add an `integration` grouping hint so the builder palette can group these separately — reuse
   whatever grouping the palette already reads; if there is none, group on the `integration.`
   id prefix in the palette (Task 13) and add nothing here.

**Verify:**
```bash
pnpm --filter @carbon/workflows test -- catalog
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: all tests pass; no type errors.
```

**Out of scope:** adding a new node type. An integration step is an ordinary `action` node —
`NODE_KINDS` is unchanged, and so is `CURRENT_DEFINITION_FORMAT_VERSION` (still 4).

---

## Task 7: Fifth generator input — emit piece actions

**Depends on:** Tasks 5, 6

**Files:**
- Modify: `scripts/generate-workflow-catalog.ts` — read the allowlist and emit piece actions
- Modify: `scripts/check-workflow-catalog.ts` — keep the staleness check honest
- Modify (generated, committed): `packages/workflows/src/catalog/actions.generated.ts`,
  `labels.generated.ts`, `help.generated.ts`
- Copy from (precedent): the existing `buildCatalog(...)` call in `scripts/generate-workflow-catalog.ts`

**Steps:**
1. In the generator, import `PIECE_ALLOWLIST` and the registry from
   `packages/jobs/src/workflows/integrations/`. The script runs under `tsx` in Node, so importing
   piece code here is fine — this is the one place outside `packages/jobs` that may.
2. For every allowlisted piece and action, emit an entry keyed
   `integration.<pieceName>.<actionName>` (e.g.
   `integration.google-calendar.create_google_calendar_event`) with:
   - `label` — `"<piece label>: <action displayName>"`, e.g. `"Google Calendar: Create Event"`
   - `permission` — `{ module: "workflows", action: "update" }`
   - `inputs` — `connectionId` first (`t.string`, required, label `"connection"`), then one input
     per piece prop via `toValueType`, `required` copied from the prop, `label` from its
     `displayName`
   - `outputs` — `{ result: t.string }` for v1; the piece's own output schema is not mapped
   - `batchable: false`
   - `piece: { name, action }`
3. Emit a `WORKFLOW_LABELS` entry for each new action id, so the builder and the run history name
   the step properly. Labels go in `labels.generated.ts` as `msg``…``` like every other entry.
4. Let `UnmappablePropertyError` propagate — the generator must **exit non-zero** with the piece,
   action and property named, and write no files.
5. Update `scripts/check-workflow-catalog.ts` so the staleness comparison includes the piece
   actions (it rebuilds the catalog and diffs against the committed file; feeding it the same
   fifth input is enough). CI runs this via `.github/workflows/check.yml`, so skipping it makes
   the build red.
6. Regenerate and commit the output:
   ```bash
   pnpm run generate:workflow-catalog
   ```

**Verify:**
```bash
pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog
# Expected: generation succeeds; the check reports no drift.
pnpm exec tsx -e 'import {WORKFLOW_ACTION_CATALOG} from "./packages/workflows/src/catalog/actions.generated"; const a = WORKFLOW_ACTION_CATALOG["integration.google-calendar.create_google_calendar_event"]; console.log(Object.keys(a.inputs).join(","), JSON.stringify(a.piece));'
# Expected: the input list starts with connectionId and includes title and start_date_time,
# and the piece block is {"name":"google-calendar","action":"create_google_calendar_event"}.
```

**Out of scope:** hand-editing any `*.generated.ts` file. Change the generator and re-run.

---

## Task 8: Connections service (CRUD + fresh-token resolution)

**Depends on:** Tasks 2, 4

**Files:**
- Create: `packages/ee/src/integrations/connections.ts`
- Create: `packages/ee/src/integrations/connections.test.ts`
- Modify: `packages/ee/src/integrations/secrets.ts` — nothing structural; see step 5
- Modify: `packages/ee/src/index.ts` — export the new service
- Copy from (precedent): `packages/ee/src/integrations/secrets.ts` (`persistIntegrationSecrets` /
  `resolveIntegrationSecrets` are the shape to mirror, but they target `companyIntegration`, so
  these are new functions against the new RPCs from Task 1)

**Steps:**
1. Implement, all taking a Supabase client as the first argument in Carbon's service idiom:
   ```ts
   listConnections(client, companyId, pieceName?)
   getConnection(client, companyId, connectionId)          // non-secret fields only
   createConnection(serviceClient, { companyId, pieceName, name, authType, accountLabel, metadata, tokens, expiresAt, createdBy })
   renameConnection(client, companyId, connectionId, name, updatedBy)
   disconnectConnection(serviceClient, companyId, connectionId, updatedBy)
   resolveConnectionAuth(serviceClient, companyId, connectionId)   // returns FRESH auth
   ```
2. `createConnection` inserts the row, then writes `{ accessToken, refreshToken }` through the
   `upsert_connection_secret` RPC. Tokens must never be written into `metadata`.
3. `disconnectConnection` calls `delete_connection_secret` and sets
   `status = 'Revoked'`, `secretRef = NULL`. It does **not** delete the row — a saved workflow
   node may reference the id, and a dangling id produces a worse error than a clear
   "reconnect this" message.
4. `resolveConnectionAuth`:
   - reads the row; throws a named `ConnectionRevokedError` when `status !== 'Active'`
   - reads tokens via `get_connection_secret`; throws `ConnectionSecretUnavailableError` when
     null (fail closed, exactly as `resolveIntegrationSecrets` does)
   - when `expiresAt` is more than five minutes away, returns the token as is
   - otherwise **claims the refresh** with a conditional update, so two concurrent workflow steps
     cannot both refresh and clobber each other's token:
     ```sql
     UPDATE "integrationConnection"
        SET "refreshingAt" = NOW()
      WHERE "id" = :id AND "companyId" = :companyId
        AND ("refreshingAt" IS NULL OR "refreshingAt" < NOW() - INTERVAL '30 seconds')
     RETURNING "id"
     ```
     The claimant POSTs `grant_type=refresh_token` to the piece's `tokenUrl` with our client id
     and secret, writes the new token through `upsert_connection_secret`, updates `expiresAt`,
     and clears `refreshingAt`. A caller that does **not** win the claim waits 250 ms and
     re-reads, up to 20 times (5 s), then throws `ConnectionRefreshTimeoutError`.
   - on a refresh rejected by the vendor: set `status = 'Expired'` and `lastError`, then throw
     `ConnectionRevokedError`.
5. Add a `SECRET_KEYS`-style guarantee for the new table by asserting in a test that
   `metadata` never contains `accessToken` or `refreshToken` after `createConnection`. The
   existing `SECRET_KEYS` map is keyed by `companyIntegration` id and is not used here; do not
   add connection keys to it.
6. Write `connections.test.ts` with a mocked client covering: create writes tokens via the RPC
   and not into metadata; resolve returns the stored token when far from expiry; resolve
   refreshes exactly once when two calls race (the loser observes the winner's token); a revoked
   connection throws `ConnectionRevokedError`.

**Verify:**
```bash
pnpm --filter @carbon/ee test -- connections
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: all tests pass, including the concurrent-refresh test; no type errors.
```

**Out of scope:** touching `persistIntegrationSecrets` / `resolveIntegrationSecrets` or
`SECRET_KEYS`. The 12 existing integrations keep their own path.

---

## Task 9: OAuth connect and callback routes

**Depends on:** Tasks 3, 8

**Files:**
- Create: `apps/erp/app/routes/api+/integrations.connections.$piece.connect.ts`
- Create: `apps/erp/app/routes/api+/integrations.connections.callback.ts`
- Modify: `apps/erp/app/utils/path.ts` — add the two route paths next to the existing
  `integrations` entries around line 122
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.slack.install.ts` (the install
  loader shape) and `apps/erp/app/routes/api+/integrations.onshape.oauth.ts` (the callback:
  `requirePermissions(request, { update: "settings" })`, `export const config = { runtime: "nodejs" }`,
  the `connectionFailed` redirect helper, and the rule that a failure redirects to the
  integrations page with an error **code** rather than returning JSON)

**Steps:**
1. **Connect loader.** Takes `?name=<connection name>` and the `$piece` route param. Requires
   `{ update: "settings" }`. Builds the consent URL from the piece's own OAuth2 declaration
   (`getPieceOAuth2Auth`) — `authUrl` and `scope` — plus `GOOGLE_OAUTH_CLIENT_ID` and
   `GOOGLE_OAUTH_REDIRECT_URL`, with `response_type=code`, `access_type=offline`,
   `prompt=consent` (needed for Google to return a refresh token) and a signed `state`.
   Returns `{ url }`, matching the Slack install route's contract so the client opens it in a
   popup.
2. **`state` must be signed and verified.** Sign `{ companyId, pieceName, name, userId, nonce }`
   with an existing server secret; the callback rejects anything that fails verification, is
   older than 10 minutes, or whose `companyId` does not match the session. This is the control
   that stops a token being planted into another company's connection — it is not optional and
   must not be reduced to an unsigned query parameter.
3. **Callback loader.** Mirrors the Onshape callback: handle a `?error=` denial first, then parse
   with `oAuthCallbackSchema` from `apps/erp/app/modules/shared/shared.models.ts`, then verify
   `state`. Exchange the code at the piece's `tokenUrl` server-side with
   `GOOGLE_OAUTH_CLIENT_SECRET`. Call `createConnection` with a service-role client
   (`getCarbonServiceRole` from `@carbon/auth/client.server`). Fetch the account label
   (the connected email) if the token response carries it; otherwise leave it null.
4. Log parameter **names only** on a malformed callback, never values — `code` is a live
   credential. The Onshape route's comment states this; keep it.
5. On success, redirect to `path.to.integrations`; the popup-closing behaviour follows Slack's
   `app_oauth_completed` `postMessage` convention in `packages/ee/src/slack/config.tsx`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors. (The app package is named `erp`, not `@carbon/erp` — a wrong
# filter silently passes.)
```
Manual: from Settings → Integrations, click Connect on Google Calendar, complete consent, and
confirm a row appears in `integrationConnection` with `secretRef` set and no token in `metadata`.

**Out of scope:** any change to the Slack, Onshape, Jira, QuickBooks or Xero OAuth routes.

---

## Task 10: Settings → Integrations connections panel

**Depends on:** Task 9

**Files:**
- Create: `apps/erp/app/modules/settings/ui/Integrations/ConnectionsPanel.tsx`
- Modify: `apps/erp/app/modules/settings/ui/Integrations/IntegrationsList.tsx` — list allowlisted
  pieces alongside the existing integrations
- Modify: `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` — load connections for a piece
- Copy from (precedent): `apps/erp/app/modules/settings/ui/Integrations/IntegrationCard.tsx` for
  the card, and `apps/erp/app/modules/settings/ui/Integrations/SyncActivity.tsx` for a
  list-inside-an-integration-detail layout

**Steps:**
1. Add allowlisted pieces to the integrations grid as cards using the same `IntegrationCard`
   component. A piece whose OAuth env vars are absent renders **disabled** with "Not configured
   on this server" — the same treatment `defineIntegration`'s computed `active` gives an
   integration with no client id.
2. `ConnectionsPanel` lists that company's connections for the piece: name, connected account,
   status badge, `lastError` when present, and per-row Rename and Disconnect. A "Connect" button
   opens the Task 9 connect URL in a popup (copy the popup code from
   `packages/ee/src/slack/config.tsx`, including the `app_oauth_completed` listener).
3. Connecting asks for a name first, defaulting to the piece label, and rejects a duplicate name
   in the same company with the message the unique constraint implies.
4. Use existing components only — grep `packages/react/src/` and `apps/erp/app/components/`
   before writing any new UI primitive.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
pnpm exec biome check
# Expected: no type errors; no new error-severity biome findings (pre-existing warnings stay).
```
Manual: the Google Calendar card appears, connects, and shows two differently-named connections.

**Out of scope:** redesigning the integrations page, or changing how the 12 existing integrations
render.

---

## Task 11: The integration action executor

**Depends on:** Tasks 7, 8

**Files:**
- Create: `packages/jobs/src/workflows/integrations/context.ts`
- Create: `packages/jobs/src/workflows/actions/integration.ts`
- Create: `packages/jobs/src/workflows/actions/integration.test.ts`
- Modify: `packages/jobs/src/workflows/actions/services.ts` — one new branch in `runAction`
- Copy from (precedent): `packages/jobs/src/workflows/actions/webhook.ts` (an outbound action
  returning `ActionOutcome`) and the existing `route.update` / `route.call` branches in
  `services.ts`

**Steps:**
1. `context.ts` exports `buildPieceContext({ auth, propsValue })` returning the object the spike
   proved sufficient: `auth`, `propsValue`, plus `store`, `connections`, `project`, `flows`,
   `step`, `files`. Every stub **throws** a named error when called, rather than returning empty —
   a piece that genuinely needs one must fail loudly in development, not misbehave in production.
2. `integration.ts` exports
   `runIntegrationAction({ client, companyId, pieceName, actionName, inputs })`:
   pull `connectionId` out of `inputs`; `resolveConnectionAuth`; map the remaining inputs with
   `toPropsValue`; `getPieceAction`; call `run(buildPieceContext(...))`; return
   `{ ok: true, outputs: { result } }`.
3. Every failure returns `{ ok: false, error }` with a sentence a customer can act on, following
   the existing constants at the top of `services.ts` (`GONE`, `NO_DISPATCH`, `UNKNOWN_RESULT`):
   - no `connectionId` → `"This step needs a connection."`
   - `ConnectionRevokedError` → `"The <label> connection needs to be reconnected."`
   - refresh failure → the same reconnect sentence
   - a vendor error → the vendor's message, truncated, prefixed `"<label> rejected this: "`
4. In `services.ts#runAction`, add the branch **before** the `route.update` / `route.call`
   branches and route it off `route.piece`, never off the id's shape — the existing comment in
   that file states the rule.
5. Confirm `redactForLog` in `packages/jobs/src/workflows/engine/ledger.ts` already redacts the
   keys a piece auth object uses (`access_token`, `refresh_token`, `client_secret` all match its
   regex). Add a test asserting a step's recorded `input` contains no token. If any key escapes
   the regex, widen the regex rather than filtering at this call site.
6. `integration.test.ts` covers: a successful run with a stubbed piece; each failure sentence;
   and the redaction assertion.

**Verify:**
```bash
pnpm --filter @carbon/jobs test -- integration
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: all tests pass; no type errors.
```

**Out of scope:** triggers, and any non-OAuth2 auth variant. Both are Non-goals for v1.

---

## Task 12: Smart-dropdown options endpoint

**Depends on:** Tasks 5, 8

**Files:**
- Create: `apps/erp/app/routes/api+/integrations.connections.options.ts`
- Copy from (precedent): `apps/erp/app/routes/api+/integrations.quickbooks.accounts.ts` (a
  resource route that fetches a remote list for a picker)

**Steps:**
1. Action/loader takes `{ pieceName, actionName, propName, connectionId }` plus the node's
   current input values (a dropdown's `refreshers` may name other props).
2. Gate with `requirePermissions(request, { update: "workflows" })` — the same permission the
   action itself carries, so the endpoint cannot be used to reach a vendor a user could not
   otherwise call.
3. Resolve fresh auth via `resolveConnectionAuth`, load the property from the piece, and call its
   `options({ auth, propsValue })`. Return `{ options: [{ label, value }] }`.
4. **Never echo the auth value back** in the response or in an error message.
5. On failure return `{ options: [], error }` with a short sentence — the builder shows it inline
   rather than blocking the form.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: no type errors.
```
Manual: with a connection in place, request the route for `calendar_id` and confirm it returns
the connected account's real calendars.

**Out of scope:** caching. If the vendor rate-limits, handle it in a follow-up.

---

## Task 13: Builder — connection picker and dynamic options

**Depends on:** Task 12

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/recordPickers.tsx` — add a connection
  picker for the `connectionId` input
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/choiceOptions.tsx` — fetch options
  from the Task 12 route when an input is marked `dynamicOptions`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/NodePalette.tsx` — group ids starting
  `integration.` under an "Integrations" heading
- Copy from (precedent): the existing pickers in `recordPickers.tsx` and the existing static
  choice rendering in `choiceOptions.tsx`

**Steps:**
1. The connection picker lists the company's connections for the action's piece (read the piece
   name off the catalog entry's `piece` block). With none, it renders an inline link to
   Settings → Integrations rather than an empty dropdown.
2. A `dynamicOptions` input renders as a select that fetches from
   `/api/integrations/connections/options` once a connection is chosen, with a visible loading
   state and a plain error state: `"Couldn't load options — check the connection."`
3. Refetch when the chosen connection changes. Reset the field's value on connection change —
   a calendar id from one account is meaningless in another.
4. Add no new UI primitive; use what `fields/` already has.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
npx vitest run apps/erp/app/modules/workflows
# Expected: no type errors; existing builder tests still pass.
```
Manual: add "Google Calendar: Create Event" to a workflow; the connection picker lists your
connection and the calendar dropdown lists real calendars.

**Out of scope:** changing how Carbon's own actions render. The generic field renderers are
shared — a regression there breaks all 16 existing actions.

---

## Task 14: End-to-end verification

**Depends on:** all previous tasks

**Files:** none created; this task only runs and records.

**Steps:**
1. Run the full gate set:
   ```bash
   pnpm run generate:workflow-catalog
   pnpm run check:workflow-catalog
   pnpm exec biome check
   pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs --filter=@carbon/ee --filter=erp
   pnpm --filter @carbon/workflows test
   pnpm --filter @carbon/jobs test
   pnpm --filter @carbon/ee test
   ```
2. Walk the spec's Acceptance Criteria list in order, in the running app, and record the result
   of each in `.ai/runs/2026-08-27-workflow-integrations.md`. The criteria that need a browser:
   connect a Google account; add a second named connection; reject a duplicate name; build the
   node and see real calendars; missing connection blocks activation; a real trigger creates a
   real calendar event; the run history shows Succeeded with no token in `input`/`output`;
   an expired token refreshes once; a disconnected connection fails the run with the reconnect
   message and recovers after reconnecting without editing the workflow.
3. Record any criterion that could not be verified, and why. Do not mark the plan complete with
   an unverified criterion silently dropped.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows --filter=@carbon/jobs --filter=@carbon/ee --filter=erp
# Expected: all four packages typecheck clean.
```

**Out of scope:** a whole-repo `pnpm run build` — the repo-wide typecheck OOMs, which is why the
scoped filters above are used instead.

---

## Notes for the executor

- Never use `npm`. Always `pnpm`.
- Never hand-edit `packages/database/src/types.ts` or any `*.generated.ts` — regenerate.
- Run `pnpm run generate:types` after the migration and **before** any typecheck that touches the
  new table.
- `apps/erp` sits near TypeScript's instantiation budget; if a new type surface trips TS2589 in an
  unrelated file, prefer flat selects and verify with a direct `tsgo` run rather than the turbo
  cache.
- Do not commit anything without explicit permission from the user.
