# Thermo-nuclear review — workflow integrations (Activepieces)

Scope: `a3cb049fd..HEAD` (11 commits, ~7.2k lines excluding locale + lockfile).
Verified: `packages/workflows` 436 tests pass, `packages/jobs` 262 tests pass.

**Verdict: do not approve as-is.** The architecture is genuinely good — the node-kind
separation, the provider-generic `OptionsSource`, and the refuse-don't-degrade property
mapping are all the right calls, and `renderStepInput` is a real net-negative-lines
refactor. But the headline claim — "easy to add new integrations" — is not yet true, and
F1 breaks visibly on vendor #2.

---

## What the code gets right

Worth stating, because these are the decisions that make the rest fixable:

- `integration` as its own node kind rather than an action variant. `BuiltAction` has no
  `piece`, `getActionRoute` returns none, `runAction` has no integration branch. Nothing on
  the action path has to ask whether it is really a vendor call.
- `OptionsSource` names a *provider*, never an integration. The endpoint, the field and the
  builder are all integration-agnostic by construction; a Carbon-backed dropdown is one
  registry entry. This is the piece of the design most likely to still be right in a year.
- `UnmappablePropertyError` fails the *generator*, writing no files. A half-described action
  can't reach a canvas.
- The refresh claim (conditional UPDATE on `refreshingAt`, loser polls) with the comment
  explaining why an advisory lock can't work. The two-client token read in
  `runIntegrationAction` with the comment saying not to "simplify" it to one.
- HMAC-signed `state` + session `companyId` recheck; parameter *names* only in the malformed
  callback log.

The comments are, overall, a strength — they explain invariants a reader could not derive
locally rather than narrating the code.

---

## F1 — `pieceLabel()` re-derives a label that already exists twice. Blocker.

`apps/erp/app/modules/workflows/ui/Builder/config/forms/IntegrationNodeForm.tsx:44`

```ts
function pieceLabel(piece: string): string {
  return piece.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
```

The app's real name is written in `allowlist.ts` as `label: "Google Calendar"`, and reaches
the generated catalog *already interpolated* into the translated step label:

```
"integration.google-calendar.create_google_calendar_event": msg`Google Calendar: Create Event`
```

So the label survives the build, gets dropped at the catalog boundary, and is guessed back
in the browser by title-casing a package slug. It happens to be correct for exactly one
vendor. The next ones:

| slug | `pieceLabel()` | actual |
|---|---|---|
| `hubspot` | Hubspot | HubSpot |
| `github` | Github | GitHub |
| `zoho-crm` | Zoho Crm | Zoho CRM |
| `activecampaign` | Activecampaign | ActiveCampaign |
| `microsoft-dynamics-crm` | Microsoft Dynamics Crm | Microsoft Dynamics 365 |

It is also the only user-facing string in this feature that is not translated — it feeds the
App dropdown, the `Connect {appName}` button and the `{appName} isn't connected yet` prose,
all of which are wrapped in `<Trans>` around an untranslatable interpolation.

**Fix:** carry the app label through the generator. Either add `label` to
`BuiltIntegration["piece"]`, or emit a `WORKFLOW_INTEGRATION_APPS: Record<string, string>`
beside `WORKFLOW_INTEGRATION_CATALOG` in `buildPieceActionDeclarations()` — the value is
already in hand there (`entry.label`). Then delete `pieceLabel` entirely. If it goes through
the label pipeline it is translated for free, like every other catalog string.

---

## F2 — the per-vendor `hooks.server.ts` should not exist. Code judo.

`packages/ee/src/google-calendar/hooks.server.ts` is 28 lines whose entire content is
"revoke every connection for this piece":

```ts
const PIECE_NAME = "google-calendar";
export async function googleCalendarOnUninstall(companyId: string) {
  const client = getCarbonServiceRole();
  const { data } = await listConnections(client, companyId, PIECE_NAME);
  for (const connection of data ?? []) {
    if (connection.status === "Revoked") continue;
    await disconnectConnection(client, companyId, connection.id, "system");
  }
}
```

Nothing in it is vendor-specific. And the design *already guarantees* it can't be — the
config comment says `id` deliberately matches the piece name so no lookup table is needed.

So: make `getIntegrationServerHooks(id)` fall back to a generic piece `onUninstall` when
`PIECE_ALLOWLIST[id]` exists and no explicit hook is registered:

```ts
export function getIntegrationServerHooks(integrationId: string) {
  return serverHooks[integrationId]
    ?? (isAllowlistedPiece(integrationId)
        ? { onUninstall: (companyId: string) => revokeConnectionsFor(integrationId, companyId) }
        : undefined);
}
```

That deletes a file and a registry entry from step 5 of "adding a piece", and — more
importantly — removes the failure mode where someone adds a vendor and forgets the hook,
leaving live tokens behind after an uninstall. (`isAllowlistedPiece` is currently dead code,
F5 — this is its call site.)

---

## F3 — three implementations of "open the OAuth consent popup"

1. `useIntegrationInstall.ts:40-53` — the `oauth` branch, just extracted in this PR to be
   *the* place Install means something.
2. `packages/ee/src/google-calendar/config.tsx:29-53` — `onClientInstall`. Hardcodes
   `"/api/integrations/connections/google-calendar/connect"` as a string literal, bypassing
   `path.to.api.integrationConnect(piece)` which this PR added. Centered popup, falls back to
   `window.location.href`, throws on error.
3. `ConnectionsTab.tsx:61-70` + `109-115` — "Add account". Uses the path helper, opens
   `600x800` `_blank`, `toast.error`s on failure.

(2) and (3) hit the *same route* for the *same purpose* and behave differently. (2) is the
copy that gets duplicated once per vendor, and the hardcoded URL means a route rename breaks
it silently — `path.to` exists precisely to stop that.

**Fix:** one `connectIntegrationAccount(pieceName, name?)` in the settings module: fetch
`path.to.api.integrationConnect(pieceName)`, open the popup, one error behaviour. `config.tsx`'s
`onClientInstall` becomes `() => connectIntegrationAccount("google-calendar")` — one line,
and the only vendor-specific token in it is the id that already has to be there.

---

## F4 — `useHasConnection` is a second copy of `OptionsField`'s fetch

`IntegrationNodeForm.tsx:58-81` and `OptionsField.tsx:63-87` both: build a query string from
`source.provider` + JSON `source.params`, then `useEffect` → `fetcher.load` guarded on
`state === "idle" && data === undefined`. Same endpoint, same guard, same shape.

They have already drifted: `OptionsField` serializes `dependsOn` values into `values`,
`useHasConnection` ignores `dependsOn` entirely. That is fine today only because the
connection input happens to have none — it is a latent bug the moment a provider gains a
dependency.

**Fix:** one `useWorkflowOptions(source, values?)` hook returning
`{ options, emptyHref, error, loaded }`. `OptionsField` renders it; `IntegrationNodeForm`
reads `.length > 0`. Removes the drift by construction.

---

## F5 — a cluster of exports with zero callers

Verified by grep across `packages`, `apps`, `scripts`:

| symbol | file | callers |
|---|---|---|
| `parseIntegrationActionId` | `integrations/catalog.ts:23` | none |
| `INTEGRATION_ACTION_PREFIX` | `integrations/catalog.ts:16` | only `parseIntegrationActionId` |
| `isAllowlistedPiece` | `integrations/allowlist.ts:68` | none (see F2) |
| `PieceName` | `integrations/allowlist.ts:66` | none |
| `getCatalogIntegration` | `catalog/catalog.ts:145` | none |
| `integrationStepIds` | `catalog/catalog.ts:152` | none |
| `integrationActionId` | `integrations/catalog.ts:19` | 1, in its own file |

Three specific problems inside that list:

- `parseIntegrationActionId` exists to split an id apart, and the rule doc explicitly says
  *"Nothing parses an id"*. It is a documented non-goal with an implementation. Delete it —
  its existence invites the next person to route on a parsed id.
- `integrationStepIds()` is commented **"The id of every integration step, for the builder's
  picker."** The builder's picker does not call it — `IntegrationNodeForm.tsx:32` reaches into
  `WORKFLOW_INTEGRATION_CATALOG` directly and groups by piece itself. Pick one: either the
  builder uses the accessor, or the accessor goes.
- `PieceName = keyof typeof PIECE_ALLOWLIST` resolves to **`string`**, because
  `PIECE_ALLOWLIST` is annotated `Record<string, AllowlistEntry>`. It looks like a
  type-safety guarantee and provides none. Either drop it or write the constant as
  `{ ... } as const satisfies Record<string, AllowlistEntry>` so `keyof` means something.

`integrationActionId` is a bare `export const x = y` alias used once, inside the file that
declares it. Call `integrationStepId` directly.

---

## F6 — `AllowlistEntry.version` is never read

`allowlist.ts:22` carries `version: "0.10.3"` with the comment *"pinned exactly in
packages/jobs/package.json"*. Nothing reads it and nothing compares the two. It is a second
copy of a fact whose whole justification is that it must not drift — the exact shape the doc
warns about ("an upstream release must never silently change code we execute against a
customer's account").

Either delete the field, or make it load-bearing: have `loadPiece` (or the catalog check
script) compare it against the installed package's version and refuse on mismatch. A comment
is not an enforcement mechanism.

---

## F7 — three casts of the same row shape

- `connections.ts:272` — `row as unknown as IntegrationConnection`
- `connections.ts:353` — `data as unknown as IntegrationConnection | null`
- `integrations.$id.tsx:918` — `... .data ?? []) as ConnectionRow[]`

A double cast (`as unknown as`) means the two types genuinely disagree and nothing checks it.
The cause is `SELECT_COLUMNS` being an opaque string, so supabase-js can't infer the row.

**Fix:** one `readConnection(client, companyId, id): Promise<IntegrationConnection | null>`
and one `readConnections(...)` in `connections.ts` that own the cast, and have
`resolveConnectionAuth`, `awaitRefreshedToken` and the settings loader call those. `ConnectionRow`
in `ConnectionsTab.tsx` is a structural subset of `IntegrationConnection` — it should be
`Pick<IntegrationConnection, "id" | "pieceName" | "name" | "accountLabel" | "status" | "lastError">`
rather than a fourth hand-written declaration of the same fields.

---

## F8 — dead branch in the error path

`packages/jobs/src/workflows/actions/integration.ts:69-80`:

```ts
} catch (cause) {
  if (cause instanceof ConnectionRevokedError) {
    return { ok: false, error: `The ${label} connection needs to be reconnected.` };
  }
  return { ok: false, error: `The ${label} connection needs to be reconnected.` };
}
```

Both branches return an identical object. Either the `instanceof` check was meant to produce
a *different* message for the non-revoked case (a timeout and a revocation are not the same
problem to a customer, and `ConnectionRefreshTimeoutError` exists), or the check is noise.
As written it reads as an intent that was lost — collapse it or differentiate it.

---

## F9 — the two token exchanges are the same function

`connections.ts:386-405` and `:408-428`. Identical `fetch` shape, identical headers,
identical `!response.ok` throw with the same message, identical `readTokenResponse(await
response.json())`. Only the `URLSearchParams` body differs.

```ts
async function postTokenRequest(tokenUrl: string, body: Record<string, string>) {
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body)
  });
  if (!response.ok) throw new Error(`The connection was rejected (${response.status}).`);
  return readTokenResponse(await response.json());
}
```

Both exported functions become three lines. Matters beyond tidiness: the callback matches on
`message.includes("rejected")` (`integrations.connections.callback.ts:141`) to pick an error
code, so that string is a contract between two files — having it written twice is how it
starts differing.

---

## F10 — permission boundary worth confirming (not necessarily a change)

The `integrationConnection` SELECT policy is `settings_view`
(`20260827044707_...sql`), but `connectionProvider` runs at `workflows_view`
(`options-providers.server.ts:56`) using the requester's own client.

A workflow author with `workflows_update` but without `settings_view` therefore gets zero
rows from RLS. The builder reads that as "not connected" and renders the "Connect Google
Calendar" button — pointing at a settings page they also cannot use. The step is
unconfigurable, and the message tells them the wrong reason.

If workflow authors are always settings admins in practice, this is fine and worth a comment
on the provider saying so. If not, the connection list needs its own read path (a
`workflows_view`-scoped view, or a service-role read scoped by the run's `companyId` the way
the token read already is).

---

## Minor

- **`integrations.$id.tsx`** was already ~1700 lines and gains a
  `PIECE_ALLOWLIST[integrationId]` special case in its loader plus a tab. Not a threshold
  crossing and it follows the existing tabs pattern, so not a blocker — but this route is
  now the fifth integration-specific branch in one loader and is overdue for splitting the
  per-integration loader slices into their own module.
- **`buildPieceContext`** returns `Record<string, unknown>` with `server: { publicUrl: "",
  apiUrl: "", token: "" }` — three empty strings among ten stubs that all deliberately
  *throw*. Inconsistent with the module's own stated rule ("every stub THROWS rather than
  returning empty"). If a piece reads `server.token` it gets `""` and fails obscurely at the
  vendor instead of loudly here.
- **`BuiltIntegration`** duplicates every field of `BuiltAction` except `call`/`update`/
  `requireOneOf`. `IntegrationDeclarationLike` already models this correctly as
  `Omit<ActionDeclarationLike, "call" | "update"> & { piece }` — `BuiltIntegration` should
  mirror that rather than restate the fields.
- **`allowlist.ts` header comment** claims *"adding a vendor edits no shared file."* It edits
  at least five: `packages/jobs/package.json`, `packages/env/src/index.ts` (×5 spots),
  `packages/ee/src/index.ts`, `packages/ee/src/hooks.server.ts`, `.env.example`. Fix the
  comment, or fix the count (F2 and F3 remove two of them).

---

## The extensibility claim, measured

The rule doc lists 6 steps for adding a piece. The actual touch points today:

1. `packages/jobs/package.json` — dependency
2. `allowlist.ts` — the row *(the one that should be the only one)*
3. `.env.example` — 3 vars
4. `packages/env/src/index.ts` — 3 `getEnv` exports + 2 `declare global` blocks + `getBrowserEnv()`
5. `packages/ee/src/<vendor>/config.tsx` — new file, incl. a copy-pasted `onClientInstall`
6. `packages/ee/src/index.ts` — import + array + re-export
7. `packages/ee/src/<vendor>/hooks.server.ts` — **new file, 100% boilerplate**
8. `packages/ee/src/hooks.server.ts` — register it
9. `pnpm run generate:workflow-catalog && pnpm run check:workflow-catalog`

F2 deletes 7 and 8. F3 reduces 5 to a near-empty config. That gets it to a row, a config
object, an env block and a regen — which is a defensible "easy".

Step 4 is the stubborn one, and the doc is honest that `getBrowserEnv()` can't be indexed by
name. Worth noting there is a way out if it becomes annoying: `active` only exists so the
card can say "Coming soon", and the integrations page loader runs server-side — it could
return the set of pieces for which `resolveOAuthApp` succeeds and let the card read that,
removing the browser-env step entirely. Not required for this PR.

---

---

## Resolution (2026-08-28)

Applied in the working tree. Verified: 4 typechecks (erp, ee, jobs, workflows) pass,
1513 package tests + 160 erp module tests pass, `pnpm run check:workflow-catalog` ok,
biome error-level clean on every touched path.

| # | What changed |
|---|---|
| F1 | `IntegrationDeclarationLike.piece` gained `label`; `buildCatalog` emits it under the new `integrationAppLabelKey(piece)` → `labels.generated.ts` now has `"integration.google-calendar": msg\`Google Calendar\``. `pieceLabel()` deleted; the builder reads it through `useWorkflowLabel` like every other catalog string, so it is translated too. |
| F2 | `packages/ee/src/google-calendar/hooks.server.ts` **deleted**. Replaced by generic `revokeConnectionsForPiece(client, piece, companyId)` in `connections.ts` + a one-line `serverHooks` entry. (Kept in `@carbon/ee`: `ee → jobs` would be an import cycle, so the allowlist cannot be consulted from there.) |
| F3 | New `packages/ee/src/integrations/connect.ts` — `openConsentPopup` / `startIntegrationConnect`. `google-calendar/config.tsx` drops ~25 lines of popup code; `ConnectionsTab` uses the same opener. |
| F4 | New `useWorkflowOptions` hook; `OptionsField` (−51 lines) and `IntegrationNodeForm` (−64) both call it. The `dependsOn` divergence is gone by construction. |
| F5 | Deleted `parseIntegrationActionId`, `INTEGRATION_ACTION_PREFIX`, `integrationActionId`, `isAllowlistedPiece`, `PieceName`, `getCatalogIntegration`, `integrationStepIds` — verified 0 references remain. |
| F6 | `assertPinnedVersions(dependencies)` added and wired into `check-workflow-catalog.ts`. Confirmed it rejects `^0.10.3` and a missing dependency, and accepts `0.10.3`. |
| F7 | `getConnection`/`listConnections` → `readConnection`/`readConnections`, which own the single cast. Removed the double casts in `resolveConnectionAuth` + `awaitRefreshedToken` and the `as ConnectionRow[]` in the settings loader. `ConnectionRow` is now a `Pick<IntegrationConnection, …>`. |
| F8 | Branch differentiated rather than collapsed: refresh-timeout → "was busy refreshing. Try again."; revoked/secret-unavailable → "needs to be reconnected."; anything else (e.g. a missing OAuth app) → "is unavailable." Three new tests cover them. |
| F9 | `postTokenRequest` extracted; both exchanges are now 6 lines each. |
| minor | `buildPieceContext`'s `server` is a throwing getter, consistent with the other nine stubs (verified the piece never reads it, so no behaviour change today). `BuiltIntegration` now `extends Omit<BuiltAction, …>`. Stale `allowlist.ts` header claim and the `.claude/rules/workflow-integrations.md` checklist corrected. |

Adding a piece is now: the allowlist row, a `defineIntegration` config, a one-line hooks
entry, the env block, and a regen. The two boilerplate files are gone.

### Deliberately not done

- **F10** — needs a product answer, not a code change. See above.
- **Onshape / Slack popup duplication.** Both pre-date this branch and Onshape's variant
  carries an `app_oauth_completed` message listener; converting them is a behaviour risk
  outside this PR's scope. `connect.ts` is where they should land when someone does.
- **`pnpm run lingui:extract`** for the one new `integration.google-calendar` key. Lingui
  falls back to the message itself, so it renders "Google Calendar" untranslated meanwhile;
  extract on this branch churns ~120k lines of unrelated `.po` diff.

---

## Suggested order

1. F1 (blocker — wrong on vendor #2, and untranslated)
2. F2, F3 (the two deletions that make the extensibility claim true)
3. F8, F9, F5 (small, mechanical, and F5 is ~7 symbols of pure deletion)
4. F4, F7 (drift-prevention refactors)
5. F10 (answer it; change only if the answer is "no")
