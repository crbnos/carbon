# Under-scoped connection reconnect prompts — implementation plan

**Spec / source:** `.ai/specs/2026-09-01-connection-reconnect-prompts.md`
**Branch:** `feat/active-pieces-integration` · never `git commit` (user's rule)
**Filters:** `@carbon/ee`, `@carbon/jobs`, `erp`, `@carbon/workflows` (scope every typecheck)

## Progress

- [x] Task 1: ee — `grantedScopes` / `missingScopes`; revive refreshes `metadata`; tests
- [x] Task 2: jobs — `requiredScopesFor`; barrel export; GCal `metadata.scopes`; tests
- [x] Task 3: Runner — pre-check + `missing_scope` mapping; tests
- [x] Task 4: Options provider `reconnect` state + node banner
- [x] Task 5: Accounts tab — `requiredScopes` in loader, badge/copy, Reconnect button
- [x] Task 6: Card health includes the scope check
- [x] Task 7: Regen catalog + Lingui; rule/spec sync
- [x] Task 8: Verification + run log

## Dependencies

```
1 → 3, 4, 5, 6     2 → 3, 4, 5, 6     7 after 2–6     8 last
```
Tasks 1 and 2 in parallel; then 3–6 in parallel (disjoint files).

---

## Task 1: ee — scope predicates + revive metadata

**Files:** Modify `packages/ee/src/integrations/connections.ts`, `packages/ee/src/integrations/connections.test.ts`

**Steps:**
1. Below `connectionsHealthy`, add:
   ```ts
   /**
    * Scopes the vendor said it granted, recorded by the callback from the token
    * response (`metadata.scopes`; Slack separates with commas, the v2 backfill with
    * spaces). `null` when the connection predates recording or the vendor does not
    * report them — a caller must never flag what it cannot see.
    */
   export function grantedScopes(
     connection: Pick<IntegrationConnection, "metadata">
   ): string[] | null {
     const raw = connection.metadata.scopes;
     if (typeof raw !== "string") return null;
     const scopes = raw.split(/[\s,]+/).filter((s) => s.length > 0);
     return scopes.length === 0 ? null : scopes;
   }

   /** Required scopes the connection does not hold. Empty when grants are unknown. */
   export function missingScopes(
     connection: Pick<IntegrationConnection, "metadata">,
     required: readonly string[]
   ): string[] {
     const granted = grantedScopes(connection);
     if (granted === null) return [];
     const have = new Set(granted);
     return required.filter((scope) => !have.has(scope));
   }
   ```
2. In `createConnection`'s revive `update({...})` add
   `...(args.metadata === undefined ? {} : { metadata: args.metadata as never }),` with a one-line
   comment: a re-consent's token response is authoritative (its `scopes` is how "reconnect" clears).
3. Tests (new `describe("scopes")` + one revive case):
   - `grantedScopes({ metadata: { scopes: "a,b" } })` → `["a","b"]`; `"a b"` → same; `{}` → `null`; `""` → `null`.
   - `missingScopes({ metadata: { scopes: "a" } }, ["a","c"])` → `["c"]`; unknown → `[]`.
   - Revive: `makeClient({ status: "Revoked" })` with `metadata: { scopes: "old" }` on the row; `createConnection` same name with `metadata: { scopes: "new" }` → `rows.get(CONNECTION)!.metadata.scopes === "new"`. (Check `makeClient`'s `update` handles a `metadata` key; if not, extend the stub's `update` to assign it.)

**Verify:**
```bash
pnpm --filter @carbon/ee exec vitest run src/integrations/connections.test.ts   # pass incl. new cases
pnpm exec turbo run typecheck --filter=@carbon/ee                                # no errors
```

---

## Task 2: jobs — `requiredScopesFor`, GCal scopes map

**Files:** Modify `packages/jobs/src/workflows/integrations/oauth.ts`, `index.ts`, `allowlist.ts`, `oauth.test.ts`

**Steps:**
1. `oauth.ts`:
   ```ts
   /** The scopes a connection for this piece must hold — exactly what `buildConsentUrl`
    * requests, so "reconnect" always grants what the check demands. */
   export async function requiredScopesFor(pieceName: string): Promise<readonly string[]> {
     const entry = PIECE_ALLOWLIST[pieceName];
     if (entry === undefined) return [];
     return entry.oauth.scope ?? (await getPieceOAuth2Auth(pieceName)).scope;
   }
   ```
2. `index.ts`: add `requiredScopesFor` to the `./oauth` export list.
3. `allowlist.ts` google-calendar row: add `metadata: { scopes: "scope" }` after `accountLabel`, comment: Google reports granted scopes too; recorded so a future scope change can be detected.
4. `oauth.test.ts`: `requiredScopesFor("slack")` → 16 unique, contains `channels:read`; `requiredScopesFor("google-calendar")` deep-equals `(await getPieceOAuth2Auth("google-calendar")).scope`; `requiredScopesFor("nope")` → `[]`.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/workflows/integrations/   # all pass
pnpm exec turbo run typecheck --filter=@carbon/jobs
```

---

## Task 3: Runner — pre-check + vendor-error mapping

**Files:** Modify `packages/jobs/src/workflows/actions/integration.ts`, `packages/jobs/src/workflows/actions/integration.test.ts`

**Steps:**
1. Import `missingScopes` from `@carbon/ee/integrations/connections` and `requiredScopesFor` from `../integrations/oauth`. Add:
   ```ts
   const reconnectCopy = (label: string) =>
     `The ${label} connection needs to be reconnected to grant the permissions this step uses — Settings → Integrations → ${label} → Accounts → Reconnect.`;
   const SCOPE_ERROR = /missing_scope|insufficient_scope|insufficient.?permission/i;
   ```
2. After the `owned` check (before resolving the token):
   ```ts
   // Deterministic first: a workspace connected before this piece needed a scope
   // fails here, without a vendor call, with words that name the fix.
   const missing = missingScopes(owned, await requiredScopesFor(pieceName));
   if (missing.length > 0) {
     logger?.warn?.(...) — if the file has no logger, skip logging; do NOT add a logger import just for this.
     return { ok: false, error: reconnectCopy(label) };
   }
   ```
3. In the final `catch`: `if (SCOPE_ERROR.test(message)) return { ok: false, error: reconnectCopy(label) };` before the generic `rejected this` return.
4. Tests: the module mock of `@carbon/ee/integrations/connections` lists exports explicitly — change it to
   `vi.mock("@carbon/ee/integrations/connections", async (importOriginal) => ({ ...(await importOriginal<typeof import("@carbon/ee/integrations/connections")>()), readConnection: ..., resolveConnectionAuth: ... }))`
   so the real `missingScopes` runs. The `../integrations/registry` mock must also expose `getPieceOAuth2Auth: vi.fn().mockResolvedValue({ scope: [] })` (google-calendar has no `oauth.scope` override). `readConnection`'s default mock row gets `metadata: {}`. Add:
   - "refuses before calling the vendor when the connection lacks a required scope": `readConnection` → `{ id, pieceName: "slack", metadata: { scopes: "chat:write" } }`, `pieceName: "slack"` → error matches `/reconnected .* Accounts → Reconnect/`, and the mocked `run` was not called;
   - "maps a vendor scope error to the reconnect copy": `run` rejects `new Error("An API error occurred: missing_scope")` → same copy.

**Verify:**
```bash
pnpm --filter @carbon/jobs exec vitest run src/workflows/actions/integration.test.ts   # pass incl. 2 new
pnpm exec turbo run typecheck --filter=@carbon/jobs
```

---

## Task 4: Options provider `reconnect` + node banner

**Files:** Modify `apps/erp/app/modules/workflows/options-providers.server.ts`, `apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationNodeForm.tsx`

**Steps:**
1. Provider: import `missingScopes` (ee) and `requiredScopesFor` (jobs). In `connectionProvider.resolve`:
   ```ts
   const usable = usableConnections(await readConnections(getCarbonServiceRole(), companyId, piece));
   const required = await requiredScopesFor(piece);
   const ready = usable.filter((row) => missingScopes(row, required).length === 0);
   // Connected, but every account predates a scope this piece now needs: the fix is a
   // re-consent, not a new account — say so instead of offering an empty list.
   if (ready.length === 0 && usable.length > 0) {
     return { options: [], errorCode: "reconnect", errorHref: `${path.to.integration(piece)}?tab=connections` };
   }
   return { options: ready.map(...same as today...), emptyHref: path.to.integrations };
   ```
2. `IntegrationNodeForm`: destructure `errorCode, errorHref` from the existing `useWorkflowOptions(...)` call. Where the "isn't connected yet" block renders (`piece && checked && !connected`), branch first:
   ```tsx
   {piece && checked && !connected && errorCode === "reconnect" ? (
     <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-4">
       <p className="text-sm text-muted-foreground">
         <Trans>{appName} is connected, but needs to be reconnected before workflow steps can use it.</Trans>
       </p>
       <Button asChild variant="secondary" isDisabled={isReadOnly}>
         <Link to={errorHref ?? `${path.to.integration(piece)}?tab=connections`} target="_blank" rel="noreferrer">
           <Trans>Reconnect {appName}</Trans>
         </Link>
       </Button>
     </div>
   ) : piece && checked && !connected ? ( …existing Connect block… ) : null}
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
grep -n '"reconnect"' apps/erp/app/modules/workflows/options-providers.server.ts   # ≥ 1 in connectionProvider
```

---

## Task 5: Accounts tab — badge, copy, Reconnect

**Files:** Modify `apps/erp/app/routes/x+/settings+/integrations.$id.tsx` (~line 912), `apps/erp/app/modules/settings/ui/Integrations/ConnectionsTab.tsx`
**Precedent:** the existing Add-account button + `connect` fetcher effect in the same file.

**Steps:**
1. Loader: import `requiredScopesFor` from `@carbon/jobs/integrations`; `connections` gains `requiredScopes: await requiredScopesFor(integrationId)` (as a plain `string[]`).
2. `ConnectionsTab`: `ConnectionRow` adds `"metadata"`; props add `requiredScopes: readonly string[]`; the drawer passes it (`integrations.$id.tsx` ~line 1698). Lift the `connect` fetcher's `load` into `const startConnect = (name: string) => connect.load(\`${path.to.api.integrationConnect(pieceName)}?name=${encodeURIComponent(name)}\`)` and pass `onReconnect={() => startConnect(connection.name)}` + `reconnecting={connect.state !== "idle"}` + `requiredScopes` to `ConnectionItem`.
3. `ConnectionItem`:
   - `const needsScopes = connectionUsable(connection) && missingScopes(connection, requiredScopes).length > 0;` (import `missingScopes` from `@carbon/ee/integrations/connections`).
   - Beside the status badge: `{needsScopes && <Badge variant="yellow" className="shrink-0"><Trans>Reconnect needed</Trans></Badge>}`.
   - Replace the "This account has stopped working. Add it again…" paragraph with:
     ```tsx
     {needsScopes ? (
       <span className="text-xs text-muted-foreground"><Trans>Connected before workflows needed extra permissions. Reconnect to grant them — everything else keeps working meanwhile.</Trans></span>
     ) : !connectionUsable(connection) ? (
       <span className="text-xs text-muted-foreground"><Trans>This account has stopped working. Reconnect it — workflow steps using it will fail until you do.</Trans></span>
     ) : null}
     ```
   - In the right-hand column, above the Disconnect form: `{(needsScopes || !connectionUsable(connection)) && (<Button size="sm" leftIcon={<LuPlug />} isLoading={reconnecting} onClick={onReconnect}><Trans>Reconnect</Trans></Button>)}`; wrap the column in a `VStack spacing={2} className="shrink-0 items-end"` so both buttons stack.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
grep -c "Reconnect" apps/erp/app/modules/settings/ui/Integrations/ConnectionsTab.tsx   # ≥ 3
```

---

## Task 6: Card health includes the scope check

**Files:** Modify `apps/erp/app/modules/settings/settings.server.ts` (`getIntegrationHealth`)

**Steps:**
1. Imports: `connectionUsable, missingScopes, readConnections` from `@carbon/ee/integrations/connections`; `PIECE_ALLOWLIST, requiredScopesFor` from `@carbon/jobs/integrations` (this is a `.server.ts` module — server-only is fine).
2. After `const status = await (healthcheck …)(companyId, resolvedMetadata);` and before the `redis.set`:
   ```ts
   // A piece card is also unhealthy while any usable account predates a scope the
   // piece now needs — the step would fail with `missing_scope`. Checked here rather
   // than in the ee hook because only this side can see the allowlist's required list.
   let healthy = status;
   if (healthy && PIECE_ALLOWLIST[integration.id!] !== undefined) {
     const [rows, required] = await Promise.all([
       readConnections(getCarbonServiceRole(), companyId, integration.id!),
       requiredScopesFor(integration.id!)
     ]);
     healthy = !rows.some((row) => connectionUsable(row) && missingScopes(row, required).length > 0);
   }
   ```
   and use `healthy` in the `redis.set` and the returned `health`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
```

---

## Task 7: Regen + docs

**Steps:**
1. `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog && pnpm run lingui:extract` (the GCal row change is metadata the generator ignores; Lingui picks up the new UI strings).
2. `.claude/rules/workflow-integrations.md`: under "Connections" add a short "Scopes drift" paragraph: `metadata.scopes` records the grant; `missingScopes` vs `requiredScopesFor`; the four surfaces; revive refreshes metadata.
3. Spec status → `implemented (2026-09-01)` + changelog line.

**Verify:**
```bash
pnpm run check:workflow-catalog                                            # ok
grep -c "missingScopes\|requiredScopesFor" .claude/rules/workflow-integrations.md   # ≥ 2
```

---

## Task 8: Verification + run log

**Files:** Create `.ai/runs/2026-09-01-connection-reconnect-prompts.md` (format: the two earlier run logs today)

**Steps:**
1. Gates: typecheck `@carbon/ee @carbon/jobs erp @carbon/workflows`; `pnpm --filter @carbon/ee test`; `pnpm --filter @carbon/jobs test` (services.test.ts env-gated, pre-existing); `pnpm --filter @carbon/workflows test`; biome on touched files.
2. Data check on dev: the backfilled Slack row has 10 scopes → `missingScopes` = the 6 piece-only scopes (compute with a one-off `node -e` against the row's `metadata.scopes` string and the allowlist list, or via psql string ops).
3. Browser matrix (spec AC 4–6) — user-driven after the Slack manifest update; record UNVERIFIED honestly.
