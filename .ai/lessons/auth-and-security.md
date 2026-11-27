# Auth and security lessons

Auth, sessions, permissions, API keys, request headers, secrets, the MCP and API surface.

## A form validator is not an API contract

```scope
id: a-form-validator-is-not-an-api-contract
paths: ["apps/erp/app/modules/*/*.server.ts"]
triggers: ["defineServiceFn","z.preprocess","z.coerce","z.any()","databaseRefusal"]
```

**Context:** `production_createJobOperation` answered a bare 500 "Failed to insert job operation" to an API caller (2026-10-27).

**Problem:** Operations moved from routes kept the route's input and error handling. The form sent a fresh client-made `id` for each new row, so the create input required one and an API caller had to invent it; a reused id failed the insert. The route's toast-only `ctx.error("internal", "Failed to …", error)` (448 of them) then hid the database's reason, so a duplicate key or a reference to nothing read as our failure.

**Rule:** A create input leaves the new row's `id` optional when the table has a default (`mcp-create-inputs.test.ts` fails otherwise). A database refusal the caller can fix is reported as itself: `defineServiceFn` maps an `internal` error whose cause is one (`databaseRefusal`), so don't swallow the cause. A yes/no field is a real boolean that also parses the form's `"true"` / `"false"` (`booleanField`, `shared.models.ts`), so the API publishes `boolean`. A rich-text (JSON) column takes `optionalTiptapDoc` / `requiredTiptapDoc`, never `z.string()` or `z.unknown()`: a raw string is stored as a JSON scalar the editor cannot read. A JSON value a form posts as text takes `jsonInput(schema)`. Never `z.preprocess` / `z.coerce` / `z.any()` bare in an operation's input: the manifest publishes those as "anything".

**Applies to:** every `defineServiceFn` in `apps/erp/app/modules/*/*.server.ts`, and any validator reused as an operation's input.

## A key looked up "anywhere in the payload" finds the wrong one

```scope
id: a-key-looked-up-anywhere-in-the-payload-finds-the-wrong-one
paths: ["apps/erp/app/routes/api+/v1+/lib/*.server.ts"]
triggers: []
```

**Context:** An earlier API dispatcher decided whether an upsert creates or updates from
the record's `id`. It looked for `id` at the top level and then inside any nested object,
to support `{ job: { id } }`. That dispatcher no longer exists.

**Problem:** `{ name: "x", customFields: { id: "z" } }` matched the nested `id`, so a
create was stamped as an update and went down the service's update branch.

**Rule:** Read a record's key only where the record can be: the body itself or the wrapper
named by the service's payload parameter. A search that descends into arbitrary objects
will eventually match user data.

**Applies to:** any code in `apps/erp/app/routes/api+/v1+/lib/` that reads a key or an id
out of a caller's payload.

## Bind authorization to the authenticated subject

```scope
id: bind-authorization-to-the-authenticated-subject
paths: ["apps/erp/app/modules/shared/shared.service.ts"]
triggers: ["postingCaller","authorizePostingCaller","requireCaller"]
```

**Context:** An edge-function request carried a `userId` in its JSON body and also carried an authenticated Supabase JWT.

**Problem:** The permission helper looked up claims for the body-supplied user without proving that user matched the JWT `sub`, so a caller could borrow another user's permissions by changing one request field.

**Rule:** For an `authenticated` JWT, require a non-empty `sub`, require it to match the requested actor id, and use that subject for permission lookup. Treat body actor ids as attribution inputs only for trusted service-role/API-key flows; they are never authentication evidence.

**Applies to:** `postingCaller` / `authorizePostingCaller` (`apps/erp/app/modules/shared/shared.service.ts`) and any endpoint that accepts a caller/actor id alongside a bearer token.

## OAuth signup bypasses app-level email gates — GoTrue provisions before your code runs

```scope
id: oauth-signup-bypasses-app-level-email-gates-gotrue-provision
paths: ["apps/erp/app/routes/_public+/callback.tsx","apps/mes/app/routes/_public+/callback.tsx","packages/auth/src/services/self-signup.server.ts"]
triggers: ["isSelfSignupBlockedForEmail","signInWithOAuth"]
```

**Context:** The free/disposable-domain self-signup blocklist (#1661) was enforced only on the email/password path (`login.tsx` unknown-user branch, `verify.tsx` before `createEmailAuthAccount`). "Sign in with Google" / "Sign in with Outlook" (`signInWithOAuth`) let a gmail/outlook address self-sign-up anyway.

**Problem:** For OAuth there is no app-code seam before account creation. GoTrue creates the `auth.users` row during the IdP handshake and the `create_public_user` trigger fires inside that same transaction — all before the app's `/callback` action runs. So an email-path-only check has an OAuth-shaped hole, and the callback is the *first* point app code can react. The tempting "let it create, then delete it" teardown is a smell; the truly-earlier options (a GoTrue `before-user-created` hook, `GOTRUE_DISABLE_SIGNUP=true`, or a trigger `RAISE`) each cost more than they save (infra + Cloud config, or breaking existing-user first-time OAuth login, or a DB-resident blocklist + no edition signal + a raw error instead of a message).

**Rule:** Any signup/identity gate must cover OAuth, not just the email path, and OAuth is enforced in the auth callback's non-SSO branch (both ERP and MES). Gate on a GENUINE self-signup only — no company membership AND no pending invite — so existing members and invited contractors pass. Prefer *not minting a session* over deleting the account: a membership-less `user` row can access nothing and is reused by `createEmployeeAccount` if the address is later invited, so no teardown is needed and the email stays invitable. Keep the check + domain list in one shared home (`@carbon/auth/self-signup.server`) so every entry point (ERP login/verify/callback + MES callback) shares one copy.

**Applies to:** `apps/{erp,mes}/app/routes/_public+/callback.tsx` (non-SSO branch), `packages/auth/src/services/self-signup.server.ts`, and any future email/domain restriction — check the OAuth callback, not only the email/password flow.

## A constant between `/** @mcp read */` and its function drops the MCP tool

```scope
id: a-constant-between-mcp-read-and-its-function-drops-the-mcp-t
paths: ["apps/erp/app/modules/*/*.server.ts","apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json","scripts/lib/service-fn-metadata.ts"]
triggers: ["@mcp","_PAGING"]
```

**Context:** Cursor paging (2026-10-13) gave each paged list an exported `*_PAGING` constant. Twice during that work, a constant went between a doc block and its function, and the function silently stopped being an MCP tool. Typecheck, tests and the build all passed.

**Rule:** After you edit the doc blocks or the declarations of a `*.server.ts` file, run `pnpm run generate:mcp`. Then diff the tool names in `tool-manifest.digest.json`. A tool name that disappears is a displaced tag until you prove otherwise. The generator reads the doc block of the `defineServiceFn` variable statement (`leafDocs` in `scripts/lib/service-fn-metadata.ts`). The rest is in `.claude/rules/table-infinite-scroll.md`.

**Applies to:** `apps/erp/app/modules/*/*.server.ts`, `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`.

## A link minted for an API key names its creator, not the key

```scope
id: a-link-minted-for-an-api-key-names-its-creator-not-the-key
paths: []
triggers: ["generateDownloadToken","FILE_LINK_SECONDS","expiresInSeconds","createSignedUrl"]
```

- **Rule:** Any NEW operation that returns a shareable link, share token or signed URL to an API or MCP caller carries an expiry (`expiresInSeconds`, as `FILE_LINK_SECONDS` sets), not only the document download. Re-checking the named user's access is not enough when that user is not the caller. The rest is in `.claude/rules/mcp-tools-reference.md` ("File downloads").
- **Applies to:** any future operation that returns a link or token to an API caller.

## A shared executor acquires callers nobody planned for — grep every importer before deleting one

```scope
id: a-shared-executor-acquires-callers-nobody-planned-for-grep-e
paths: ["apps/erp/app/routes/api+/v1+/lib/call.server.ts","packages/jobs/src/workflows/actions/dispatcher.ts"]
triggers: ["setWorkflowDispatch","callOperation"]
```

**Context:** The oRPC migration plan said MCP `call_tool` and the in-app agent were the two consumers of the old MCP executor, so once both moved to `callOperation` its file could be deleted. A pre-deletion grep found a THIRD caller: `apps/erp/app/routes/api+/inngest.ts` registered the executor as the workflow engine's `setWorkflowDispatch` seam — every customer workflow `*.create` action ran through it.

**Problem:** A convenient shared function gets wired into new seams (dependency-injection slots, dispatchers, adapters) without its own file ever changing, so the mental list of "who uses this" goes stale. Deleting it on the strength of the plan's caller list would have broken customer workflow create actions in production while every named caller kept working.

**Rule:** Before deleting or changing the contract of any shared executor/service entry point, grep the WHOLE repo for its name (not just imports of its file — injection sites pass it by value: `setX(fn)`, `register(fn)`, config objects), and treat each hit as a caller to migrate in the same change. A DI/seam registration is a caller even though the dependency arrow points away from the file.

**Applies to:** `apps/erp/app/routes/api+/v1+/lib/call.server.ts` (the shared entry point now), `packages/jobs/src/workflows/actions/dispatcher.ts`, any `set*`/`register*` seam.

## "Come back here" must carry the query string

```scope
id: come-back-here-must-carry-the-query-string
paths: ["packages/auth/src/utils/http.ts","apps/*/app/routes/**/login*.tsx","apps/*/app/routes/**/callback.tsx"]
triggers: ["getCurrentPath","makeRedirectToFromHere","redirectTo="]
```

**Context:** Notification emails link to `/api/link?event=…&documentId=…&companyId=…`, and `requireAuthSession` sends a request away and back for a token refresh, login, MFA or idle unlock.

**Problem:** `getCurrentPath` returned `pathname` only, so every one of those round trips came back to a bare `/api/link`, which has nothing to resolve and redirects to the home page. The link itself was correct, and it worked on a second click (the token was fresh by then), so it read as an email bug. The token-refresh branch hit anyone idle for longer than the refresh threshold, which is the normal state of someone arriving from an email.

**Rule:** A "return to where you were" target is `pathname + search`, never `pathname`. When it is passed on inside another URL, encode it (`encodeURIComponent` / `URLSearchParams`), or its own `&` splits it. Test the round trip with a URL that has a query string. Drop React Router's `_routes` param from it, and only when present: middleware sees that param (loaders do not), a page URL that carries it limits which loaders later data requests run, and `searchParams.delete` re-encodes the whole query even when it removes nothing. Whatever sends the target on must be matched by something that reads it: three of the four callbacks ignored the `redirectTo` their login page sent.

**Applies to:** `packages/auth/src/utils/http.ts` (`getCurrentPath`, `makeRedirectToFromHere`), `requireAuthSession` / `refreshAuthSession`, every app's `login.tsx` callback URL and the `callback.tsx` that consumes it.

## Export permission must cover enrichment reads

```scope
id: export-permission-must-cover-enrichment-reads
paths: ["apps/erp/app/routes/x+/reports+/*aging*csv*"]
triggers: ["aging.server"]
```

**Context:** AR/AP aging CSV downloads admit accounting or invoicing viewers, then
look up customer or supplier names to label the rows.

**Problem:** Customer RLS requires sales view and supplier RLS requires purchasing
view. An otherwise authorized export received empty name results and silently
fell back to party IDs.

**Rule:** Trace every enrichment lookup against the route's permission contract.
After authorizing the export, use a company-scoped privileged read when the
related table has a narrower RLS gate than the export itself.

**Applies to:** AR/AP aging CSV routes and other server exports that enrich
authorized rows from tables protected by different module permissions.

## Moving a list building block out of its module drops the published tool's filters

```scope
id: moving-a-list-building-block-out-of-its-module-drops-the-pub
paths: ["scripts/lib/input-docs.ts","apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json"]
triggers: ["setGenericQueryFilters","appliesGenericFilters"]
```

**Context:** A review asked to move the customer portal reads from `shared.service.ts` to
`sales.service.ts`. After the move, `shared_getCustomerPortals` silently lost its `filters`
and `sorts` inputs. Typecheck and tests stayed green; only the `schema` hash in
`tool-manifest.digest.json` changed.

**Rule:** A list building block stays in the `.service.ts` of the module whose `.server.ts`
publishes it. After moving any building block, check `git diff` on
`tool-manifest.digest.json`: a changed `schema` hash is a changed public contract, so
regenerate (`pnpm generate:mcp`) and diff the tool's entry in `tool-metadata.json`. The rest
is in `.claude/rules/mcp-tools-reference.md` (`appliesGenericFilters`).

**Applies to:** any building block a `defineServiceFn` with `@mcp` calls, `scripts/lib/input-docs.ts`.

## `permission: {}` admits a read-only API key

```scope
id: permission-admits-a-read-only-api-key
paths: ["packages/api/src/permissions.ts"]
triggers: ["permission: {}","refuseKeyWithout"]
```

**Context:** A person logs their own time, so `logTimesheetEntry` and its siblings gate on
company membership (`permission: {}`).

**Problem:** For an API key, membership means any scope in the company. Publishing these
operations let a key with only View on a sales page write time and post labor cost under the name of
the person who created the key. The manifest shows no permission, so nothing looks wrong.

**Rule:** Before you tag an operation `@mcp`, ask what its gate means for a key, not only for
a person. The rest is in `.claude/rules/mcp-tools-reference.md` (`refuseKeyWithout`).

**Applies to:** `permission: {}` on any published write, `packages/api/src/permissions.ts`.

## RLS does not bound an MCP tool handed `db`; its declared permission is the only gate

```scope
id: rls-does-not-bound-an-mcp-tool-handed-db-its-declared-permis
paths: ["apps/erp/app/routes/api+/v1+/lib/base.server.ts","apps/erp/app/routes/api+/mcp+/_index.ts","apps/erp/test/mcp-tool-permissions.test.ts"]
triggers: ["scopesFromPermissions","asSystem.pg"]
```

**Context:** A 2026-10 security disclosure: an OAuth (MCP connector) token for a user with no accounting permission could create draft GL journals through `inventory_createInventoryReconciliationJournal`.

**Problem:** Two gaps stacked. The oRPC `gate()` skipped OAuth callers on the theory that RLS bounds them, but a service handed `db` got the direct connection, which bypasses RLS. And a tool's default permission was then its own module plus its verb's action, so the journal tool was gated on `inventory:create` while the Reconcile screen requires `accounting:create`. Supplier and customer bank accounts (`purchasing`/`sales` vs `accounting`) and return-order credits (`purchasing`/`sales` vs `invoicing`) had the same mismatch, for API keys as well.

**Rule:** Every non-session caller (API key AND OAuth) is gated per operation, OAuth on the user's live permissions in the token's company (`scopesFromPermissions`). When a tool does what an ERP route does, its permission must equal that route's `requirePermissions`: set the service function's own `permission` to it (the generator reads that gate, `leafPermission` in `scripts/lib/service-fn-metadata.ts`), regenerate, and pin it in `OVERRIDES` in `mcp-tool-permissions.test.ts`. Never reason "RLS will catch it" for a tool that writes through `ctx.asSystem.pg` or `db`.

**Applies to:** `apps/erp/app/routes/api+/v1+/lib/base.server.ts`, `apps/erp/app/routes/api+/mcp+/_index.ts`, every `@mcp`-tagged service function that uses `ctx.asSystem.pg` or a building block taking `db: Kysely<KyselyDatabase>`.

## A service-role job must check that a stored path belongs to the row's company

```scope
id: a-service-role-job-must-check-that-a-stored-path-belongs-to
paths: ["packages/jobs/src/inngest/functions/tasks/assembler-client.ts","packages/jobs/src/inngest/functions/tasks/company-backup.ts"]
triggers: ["resolveModelSourceBucket","modelPath","temp-staging","copyAssetsToBackup"]
```

**Context:** The model jobs found a raw file by the company named in `modelUpload.modelPath` and read storage as the service role.

**Problem:** The forms insert `modelUpload` under RLS, and RLS does not check `modelPath`. So a row in one company could name another company's staged upload in the shared `temp-staging` bucket, and the optimise would copy that file into the first company's bucket.

**Rule:** A job that reads storage as the service role takes the company from the row, never from the path, and refuses a path outside `${companyId}/` (`resolveModelSourceBucket`). Test it with a real object and a positive control, so the test fails when the guard goes.

**Applies to:** `packages/jobs` storage reads keyed by a path a user can write, and every copy that picks a bucket (`copyAssetsToBackup` took the source bucket from the first path segment until 2026-10-17).

## Features live inside existing permission modules

```scope
id: features-live-inside-existing-permission-modules
paths: ["apps/erp/app/routes/x+/*+/_layout.tsx","packages/database/src/access/pages/*.ts"]
triggers: ["ALTER TYPE \"module\""]
```

**Context:** Building a new feature that belongs to an existing domain (e.g., assembly instructions within production).

**Problem:** Creating a standalone module enum value (an `Assembly` module) for something that is really part of an existing domain. Assembly instructions belong to **production**.

**Rule:** Don't invent a new module for a feature that fits an existing domain. Add a page to that module's page file (`packages/database/src/access/pages/<module>.ts`), and list in its `paths` both the list URL and the editor tree (`production.assemblies`: `/x/production/assemblies`, `/x/assembly/`). Add a sub-link in the module's sidebar group (like Procedures) and a full-screen editor in its own route tree (`x+/assembly+/$id`, mirroring `x+/procedure+/`). Module folder = page module = nav module. The rest is in the `route-gate-names-page` check (a route's gate names the page its URL maps to).

**Applies to:** New features under `apps/erp/app/routes/x+/`, `apps/erp/app/modules/`.

## Secret material is read through ONE reader — never off a column

```scope
id: secret-material-is-read-through-one-reader-never-off-a-colum
paths: []
triggers: ["resolveIntegrationSecrets","readConnectionAccessToken","resolveConnectionAuth","access_token","secretRef"]
```

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

## A helper that writes the rows you are about to update

```scope
id: a-helper-that-writes-the-rows-you-are-about-to-update
paths: ["apps/erp/app/modules/users/users.server.ts", "packages/auth/src/services/users.server.ts"]
triggers: ["revokeInvites", "deactivateUser"]
```

**Context:** `users_revokeInvites` deactivates each user, then marks the invites revoked with an UPDATE filtered on `revokedAt IS NULL`.

**Problem:** `deactivateUser` (`@carbon/auth/users.server`) already stamps the invite revoked. For one user the operation's own UPDATE matched nothing, so it answered `{ revoked: 0 }` for a revoke that worked and skipped the audit entry that records the request's origin. Its unit test used two users, which take the job path, so it never saw the one-user path.

**Rule:** Before calling a helper, read it to its end. If it writes the rows the next statement filters on, read their ids first and update by id. Count from the rows found, not from a second filtered write.

**Applies to:** Any operation that calls a shared write (deactivate, post, close) and then updates the same rows.

## A gate the manifest cannot show reads as membership

```scope
id: a-gate-the-manifest-cannot-show-reads-as-membership
paths: ["scripts/lib/service-fn-metadata.ts", "scripts/lib/manifest-digest.ts", "apps/erp/test/mcp-tool-permissions.test.ts"]
triggers: ["describe_tool"]
```

**Context:** The MCP manifest published a gate over two or more modules (`{ create: "production", view: "projects" }`) as `{ module: null, actions: [] }`, the shape of a company-membership gate.

**Problem:** `describe_tool` printed no permission and the digest wrote `none`, so a gate could lose a module, or become `{}`, without any digest line changing. The API still enforced the full gate, so nothing was open, but the contract a caller reads was wrong.

**Rule:** The manifest publishes every page a gate names (`allOf` for pages of several modules, `oneOf` for a choice), and the digest line names them. When the generator meets a gate shape it does not know, fail generation rather than fall back to membership.

**Applies to:** `scripts/lib/service-fn-metadata.ts`, `scripts/lib/manifest-digest.ts`, `apps/erp/test/mcp-tool-permissions.test.ts`.

## Decide with the conditional write, then act on the rows it returned

```scope
id: decide-with-the-conditional-write-then-act-on-the-rows-it-re
paths: ["apps/erp/app/modules/users/users.server.ts"]
triggers: ["revokeInvites", "revokedAt"]
```

**Context:** `users_revokeInvites` checked the invites were pending, then deactivated the users, then marked the invites revoked.

**Problem:** An invite accepted between the check and the deactivation got its new account deactivated.

**Rule:** Do the conditional write that decides first: stamp `revokedAt` where `acceptedAt` and `revokedAt` are still null. Deactivate only the users whose rows it returned, and clear the stamp if the deactivation fails. Acceptance requires `revokedAt IS NULL` under the invite's row lock.

**Applies to:** A destructive step that follows a status check: revoke, cancel, close, deactivate.
