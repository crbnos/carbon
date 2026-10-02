# MES Mobile (Carbon MES app for iOS and Android) — implementation plan

**Spec:** `.ai/specs/2026-09-30-mes-mobile-app.md` (merged in crbnos/carbon#1766; Q1–Q15 all resolved)
**Research:** `.ai/research/mes-mobile-app.md`
**Plan date:** 2026-10-02
**Branches (one PR per phase):** `feat/mobile-scaffold` (Phase 0), `feat/mobile-spike` (Phase 1), `feat/mes-api` (Phase 2), `feat/mobile-screens` (Phase 3; may be split into one PR per screen group), `feat/mobile-ship` (Phase 4). Never put "claude" in a branch name; no `Co-Authored-By` trailers.

## Progress

**Session of 2026-10-02 (second pass).** Tasks 23, 31, 34–43, 45–48 and 52's
groundwork are done; the branch is `sid/carbon-mobile`, PR crbnos/carbon#1811.
Not done: Task 44 (the shared-terminal UI on top of Task 23's endpoints),
Task 49 (TestFlight / Play builds — needs the user's own Apple and Google
accounts and `expo-dev-client`, which is an Ask First native module), Task 50
(the store-review account on Carbon Cloud), Task 51 (the acceptance matrix —
needs the three devices), and Task 52's docs page and changelog entry.
Translations for the 339 newly-extracted strings need `pnpm translate`, which
calls an external LLM service, so it is left for the user to run.

Three bugs found while building, all recorded in the commits: the supabase
client never had a session set (so every direct read returned zero rows, not an
error); the instance cache key was a server-chosen display name rather than the
local uuid; and `typecheck` depended on a gitignored Uniwind declaration, which
is now a lesson in `.ai/lessons.md`.

- [x] Task 1: Record the spec corrections found during planning
- [x] Task 2: Scope the React pin to the packages that need it
- [x] Task 3: Create `packages/mes-core`
- [x] Task 4: Create the Expo app at `apps/mobile`
- [x] Task 5: Styling — Uniwind, Carbon tokens, React Native Reusables
- [x] Task 6: Lingui on Metro (shared `mes` catalog)
- [x] Task 7: App shell — providers and the Expo Router skeleton
- [x] Task 8: Developer loop — LAN env, Expo Go on the three devices, `apps/mobile/AGENTS.md`
- [x] Task 9: `@carbon/env` — `APP_REVIEW_EMAILS` and `CARBON_DEPLOYMENT_MODE`
- [x] Task 10: `@carbon/mes-core` contract for the Phase 1 endpoints
- [x] Task 11: `@carbon/auth` — `requireApiUser` and the API error helpers
- [x] Task 12: Shared sign-in gates — `apps/mes/app/services/auth.server.ts`
- [x] Task 13: Public auth endpoints — `auth/code`, `auth/verify`, `auth/mfa`, `auth/password`
- [x] Task 14: `GET /api/v1/me`
- [x] Task 15: Extract the operations list screen and expose `GET /api/v1/operations`
- [x] Task 16: Magic-link email template — add the 6-digit code
- [x] Task 17: Web "Connect mobile app" QR page (MES + ERP Settings)
- [x] Task 18: App — instance store, Connect screen, Instances screen
- [x] Task 19: App — API client, session storage, sign-in / verify / two-factor / password screens
- [x] Task 20: App — context picker, Operations list, Phase 1 parity check
- [x] Task 21: Re-check the routes to move; JSON schemas in `@carbon/mes-core/models`
- [x] Task 22: Idempotency keys and request plumbing for every POST
- [ ] Task 23: Terminal and operator tokens; `/console/*` endpoints — NOT STARTED. The app has no shared-terminal mode yet; `requireApiUser` already has the operator hook, so this is the token signing plus the three `/console/*` endpoints.
- [x] Task 24: Commands — time events (`event.tsx`, `start.$operationId.tsx`, `end.$operationId.tsx`)
- [x] Task 25: Commands — quantities (`complete.tsx`, `scrap.tsx`, `rework.tsx`, `finish.tsx`)
- [x] Task 26: Commands — materials (`issue.tsx`, `issue-tracked-entity.tsx`, `unconsume.tsx`)
- [x] Task 27: Commands — step records and notes
- [x] Task 28: Commands — quality issue and print
- [x] Task 29: Commands — picking
- [x] Task 30: Commands — timecard
- [~] Task 31: Screens — operation detail, rework targets, picking, tracked options, timecard — PARTIAL. `getOperationScreen` and `getReworkTargetsScreen` are extracted and exposed; the picking, tracked-options and timecard screen reads are not.
- [~] Task 32: API route tests and the web regression pass — PARTIAL. Every route has a test (194 in apps/mes) and the command chain was verified live against seeded data; the manual web regression pass through the browser has NOT been run.
- [x] Task 33: Docs — `.claude/rules/mes-mobile-api.md`, AGENTS.md rows, spec changelog
- [ ] Task 34: Design primitives — tokens, `ActionDock`, `HeroButton`, `StatusBadge`, `OperationCard`
- [ ] Task 35: Operation detail — Details tab and the dock (start / pause, work type, times)
- [ ] Task 36: Report good / scrap / rework / finish / end
- [ ] Task 37: Materials tab — issue by scan, tracked entities, undo
- [ ] Task 38: Instructions tab — steps, step records, photos
- [ ] Task 39: Notes tab, quality issue, print labels
- [ ] Task 40: Picking list and picking detail
- [ ] Task 41: Timecard — clock in, clock out, end shift
- [ ] Task 42: Scan tab — camera and keyboard wedge, Carbon URLs navigate
- [ ] Task 43: Outbox — ordered per-operation queue, offline banner, needs-attention
- [ ] Task 44: Shared terminal — terminal mode, PIN screen, operator header
- [ ] Task 45: More screen — instances, language, theme, outbox, sign out; idle lock; analytics gating
- [ ] Task 46: Tablet split layout, keep-awake, phone polish
- [ ] Task 47: Lingui extraction and translations for the app's strings
- [ ] Task 48: Store configuration — `app.json`, icons, `eas.json`, EAS Update channels
- [ ] Task 49: Internal testing builds — TestFlight and Play internal testing
- [ ] Task 50: Store-review account path on Carbon Cloud
- [ ] Task 51: Acceptance matrix on iPad, Android tablet and phones
- [ ] Task 52: Docs and changelog — reference page, `/changelog-entry`, AGENTS.md refresh

## Deviations (recorded as they happened)

- **Task 2 — `apps/mobile` is NOT a pnpm workspace member.** The plan assumed the
  React pin could be scoped. It cannot: both shapes were measured against main
  (which has zero dual-major pairings) and both put two React majors in one tree —
  parent-scoped pins alone gave `react-dom@19` beside `react@18` inside erp AND
  mes (react-router declares `react-dom: ">=18"`, and pnpm resolves a permissive
  peer to the newest match rather than reusing the app's copy), and a
  version-qualified `react@^19.2.0` key matched the RESOLVED version rather than
  the requested range, giving 144 `react-dom@18` / `react@19` pairings. So the app
  is excluded from `packages:`, keeps its own lockfile, shares `packages/mes-core`
  and the `@carbon/utils` subpaths as SOURCE through Metro aliases, and is driven
  in CI by root `mobile:*` scripts. `pnpm-lock.yaml` is byte-identical to main.
- **Task 4 — `expo install` is unusable here.** It shells out to `pnpm add` without
  `--ignore-workspace`, so the root's `minimumReleaseAge: 4320` rejects freshly
  published SDK packages. Versions come from `bundledNativeModules.json` by hand.
- **Task 6 — no Lingui Metro transformer.** The collision the plan feared did not
  materialise (Uniwind wraps `transformerPath`, Lingui sets
  `babelTransformerPath`), but the catalogs are still compiled ahead of time by
  `scripts/build-catalogs.mjs` through the repo's existing `lingui:compile`: it
  reuses machinery that is already a turbo build step, `tsc` then typechecks every
  catalog, and Metro needs no `.po` resolution.
- **Task 5 — React Native Reusables not used.** Its CLI is interactive. The
  primitives in `src/components/ui.tsx` are written against
  `carbon-design/shop-floor-mes.md` directly (48pt default controls, no hover, one
  colour-coded primary action), which is fewer dependencies and a closer fit.
- **Task 5 — toasts are bottom-CENTRE, not bottom-left.** `sonner-native` offers
  only centre positions. The rule it serves (never cover the primary action) is
  kept with an offset clear of the dock.
- **Task 9 — `CARBON_DEPLOYMENT_MODE` validates at module load**, not at the call
  site like `BOT_PROTECTION` (the plan's cited precedent has no boot validation).
  A typo must fail boot rather than let an air-gapped install phone home.
- **Task 11 — no shared-claims-cache change.** The plan would have added
  `permissions:${userId}:${companyId}` and updated six web invalidation sites plus
  five `vi.mock` fixtures. Instead `requireApiUser` keeps its own 60s
  company-scoped key (`mes-api:claims:…`), which is correct for a per-request
  company header and strictly tighter than the shared cache's hour, with zero
  blast radius on the web.
- **Task 12 — `requestSignInCode` gained `ip` and `allowBypass`.** Without `ip`
  the moved `logAuthEvent` calls would have silently dropped the IP from every
  audit event; `allowBypass: false` reproduces the web action's existing
  fall-through when `signInWithBypassEmail` returns null.
- **Task 17 — the ERP settings entry is alphabetical** (between Backups and Custom
  Fields), not literally beside API Keys: that group is strictly alphabetical.
- **Task 13 — the dev bypass is exempt from the API's MFA gate**, gated on
  `IS_LOCAL_DEV`. Found by live testing; see the new lesson in `.ai/lessons.md`.
- **Tasks 10/15 — `operationsScreen` is a subset** of what the web loader returns
  (cards, not a Kanban board), with `.passthrough()` so a newer server's extra
  fields cannot fail an older app build.
- **Phase 2 — commands split across six area modules.** The plan called for one
  `commands.server.ts`; it would be ~2000 lines over unrelated domains, and three
  agents had to write it concurrently. `commands.server.ts` is now the barrel and
  holds the contract; the commands live in `commands.{time,quantities,materials,steps,picking,timecard}.server.ts`,
  which matches MES's existing flat-services convention.
- **Phase 2 — `FAILURE_STATUS.blocked` is 409, not the plan's 403.** A rule
  violation is a state conflict, not a permission problem; the operator may be
  able to proceed after acknowledging.
- **Phase 2 — two table-driven test files rather than one per route.** The eight
  materials/steps routes and the three time-card routes are siblings sharing
  every behaviour under test, so a new endpoint is one row rather than a new file
  to copy wrong. `.claude/rules/testing-no-mock-theater.md` applies: the
  assertion that earns its place everywhere is that a command receives the pinned
  operator and not the terminal account.
- **Phase 2 — `@carbon/auth/api-user.server` cannot be partially mocked under
  mes's vitest.** Its auth chain reaches `@carbon/content`'s glossary, whose
  lingui `msg` macro vitest does not transform. Each route test mirrors the
  self-contained `ApiError` / `apiErrorResponse` pair instead.
- **Phase 2 — `endEventBody.exclusive` is implemented though no web caller passes
  it**, so a declared schema field is not silently ignored.

## Dependencies
- Phase 0 (Tasks 1–8) runs in order: 2 → 3 → 4 → 5 → 6 → 7 → 8. Task 1 is independent.
- Phase 1 (Tasks 9–20): 9 → 10 → 11 → 12 → 13 → 14 → 15; 16 and 17 are independent of each other and of 13–15 (16 must be done before 19 is device-tested); 18 → 19 → 20; 19 needs 13 and 14; 20 needs 15.
- Phase 2 (Tasks 21–33): 21 → 22 → 23, then 24–30 are independent of each other (one commit per moved route); 31 after 21; 32 after 24–31; 33 last.
- Phase 3 (Tasks 34–47): 34 first; 35 → 36 → 37 → 38 → 39 in order; 40, 41, 42 independent after 34; 43 after 35; 44 after 35 and Task 23; 45 after 43; 46 after 35 and 40; 47 last.
- Phase 4 (Tasks 48–52): 48 → 49 → 50 → 51 → 52.
- Tasks that `/execute` may run as parallel subagents: 16 ∥ 17 ∥ 18; 24 ∥ 25 ∥ 26 ∥ 27 ∥ 28 ∥ 29 ∥ 30; 40 ∥ 41 ∥ 42.

## Stop-points
Stop and open a PR after Task 8 (Phase 0), Task 20 (Phase 1), Task 33 (Phase 2), Task 47 (Phase 3) and Task 52 (Phase 4). Phase 2 is the risky one (it moves web code): also pause after Task 23 for a security review of the token design before any command is exposed.

## Prerequisites the user owns (not tasks)
- Free Expo account (`npx expo login` on the Mac; the same account signed into Expo Go on the iPhone and iPad). Needed from Task 8.
- Apple Developer Program membership and a Google Play Console account under Carbon's name. Needed from Task 49. Without the Apple membership, iOS development builds are limited to Expo Go, or to Xcode-signed USB installs (7-day certificates).
- Xcode (free, ~1 h to install) and Android Studio are optional: they add the iOS Simulator and Android Emulator for the agent's own checks. Nothing in Phases 0–3 requires them.

## Device test loop (referenced by every UI task as "Device check")
The dev Mac has no Xcode and no Android SDK as of 2026-10-02; the loop uses Expo Go on the user's iPhone 13, iPad and Android phone, all on the Mac's Wi-Fi.

1. Stack without app servers: `crbn up --no-portless --no-apps`.
2. Make Supabase reachable from the phones. Root `.env` gets one line (replace the IP with `ipconfig getifaddr en0`):
   `SUPABASE_URL=http://192.168.1.100:54321 #force`
   The `#force` marker makes `crbn up` omit the key from `.env.local`, so `.env` wins (`.claude/rules/environment-configuration.md` → "#force escape hatch"). Run `crbn up --no-portless --no-apps` once more after adding it. Remove the line when done with device testing.
3. MES bound to the LAN: `pnpm --filter mes run dev:lan` (script added in Task 8; `crbn up` itself always binds `127.0.0.1`).
4. App: `pnpm --filter mobile start`. Scan the QR with the iOS Camera app (opens Expo Go) or from inside Expo Go on Android. Devices on another network: `pnpm --filter mobile start -- --tunnel`.
5. In the app, link the instance to `http://192.168.1.100:3001` (Connect screen, Phase 1+), sign in with a seeded user's email and read the code from the dev mailbox (`crbn status` prints the Inbucket URL).
6. Every write made from a device is checked in the database before the next action (lesson "Browser-testing MES flows that write data" in `.ai/lessons.md` applies to devices too).

Expo Go limits that do not block Phases 0–3: the `carbon-mes://` scheme (the QR deep link from the camera app) and anything needing a native module outside Expo Go need a development build (Task 49). The in-app scanner covers the QR flow until then.

## Spec corrections found during planning (applied to the spec in Task 1)
1. `verifyTotpChallenge` lives in `packages/auth/src/services/mfa.server.ts`, not `session.server.ts`, and needs the refresh token as well as the access token — `POST /auth/mfa` must take both.
2. `x+/start.$operationId.tsx` and `x+/end.$operationId.tsx` are GET loaders that write (the QR-scan and kanban-wedge flows, behind `rejectCrossSiteNavigation`). The in-app Start/Stop button posts to `x+/event.tsx` (`action: "Start" | "End"`), whose Start branch has no floor gate, no blocked-work-center check and no `operationStart` rules check. The API gets both: `POST /operations/:id/events` runs the button command, or the scan command when the body carries `viaScan: true`; `POST /operations/:id/end` is the kanban-scan completion.
3. Clock in/out already has a server entry point the UI uses: `apps/mes/app/routes/api+/timecard.ts` (adds `note` on clock-out). The API commands are extracted from it, not from `x+/timecard.tsx`.
4. `StoredConsolePinIn`, `consolePinMaxAgeMs` and the DB re-validation (`loadConsolePinIn`) are module-private in `console-pin.server.ts`; Task 23 exports them.
5. `@carbon/auth` cannot import `@carbon/ee` (ee depends on auth). `isConsoleModeEnabledForCompany`, `verifyEmployeePin` and `isSsoRequiredForEmail` are called from MES app code or injected into `requireApiUser`.
6. There is no `verifyOtp({ email, token, type: "email" })` call anywhere yet; existing calls use `token_hash` + `magiclink`. `sendMagicLink` uses the service-role client.
7. The claims cache key `permissions:${userId}` is not company-scoped; the web deletes it on company switch. A per-request `X-Carbon-Company` needs a company-scoped read (Task 11).
8. `requirePermissions` throws redirects, so `requireApiUser` cannot wrap it; it uses `getAuthAccountByAccessToken` / `verifyAuthSession` + claims.
9. The magic-link template GoTrue loads in both docker setups is `apps/erp/public/templates/magic-link.html` (served at `${ERP_URL}/templates/magic-link.html`); `packages/database/supabase/templates/magic-link.html` is the `config.toml` copy. Both change.
10. The anon key export is `SUPABASE_ANON_KEY` (not `SUPABASE_ANON_PUBLIC`). `/me` must return `SUPABASE_URL`, never `SUPABASE_INTERNAL_URL`.
11. `@react-email/preview-server@4.2.8` hard-depends on `react` 19.0.0, `react-dom` 19.0.0, `@types/react` 19.0.10 and `@types/react-dom` 19.0.4 (the spec listed only react-dom); seven more packages depend on `@types/react: *`.
12. `apps/mes/app/services/models.ts` is 478 lines (spec: 467); service modules are `~/services/<name>.service`.
13. The MES login action records a lockout attempt on every request (`lockout.recordFailure` runs before the user lookup), and the login, mfa and unlock IP limiters share one `RATE_LIMIT`/hour bucket per IP.
14. `userContext` (location, effective user) is set only under `x+/_layout.tsx`; under `api+/` it is `null`, so every extracted function takes `locationId` and the effective `userId` as arguments.

## Decisions made in this plan (the spec was silent)
- **Result shape of extracted code.** `commands.server.ts` and `screens.server.ts` return `CommandResult<T> = { ok: true; data: T } | { ok: false; failure: CommandFailure }` with `CommandFailure = { kind: "validation" | "forbidden" | "not_found" | "conflict" | "blocked" | "needs_acknowledgement" | "redirect" | "error"; message: string; fields?: Record<string, string[]>; redirectTo?: string; details?: unknown }`. The web route maps a failure to exactly the redirect / flash / `data()` it returns today; the API maps `kind` to a status (400, 403, 404, 409, 409, 409, 409, 500). Nothing in the moved body changes.
- **API route file names.** Under `apps/mes/app/routes/api+/v1+/` every endpoint is a leaf: list reads are `._index.ts` files (`operations._index.ts`, `picking._index.ts`, `timecard._index.ts`) and detail reads are `operations.$id._index.ts` / `picking.$listId._index.ts`, so no file becomes a layout for its siblings (remix-flat-routes nests `a.b.ts` under `a.ts`). Helpers live in `lib/*.server.ts` (ignored by `routes.ts`).
- **Rate limits.** Mobile auth endpoints use their own prefix `@carbon/mes-api:auth` with `Ratelimit.slidingWindow(RATE_LIMIT * 6, "1 h")` per IP (30/h at the default), because a plant's tablets share one NAT address and the web bucket is 5/h shared with login, mfa and unlock. The per-email `AccountLockout` (5 attempts / 15 min) is shared with web unchanged — that is the NIST control. Signed-in calls: `@carbon/mes-api:user`, `slidingWindow(300, "1 m")` per user. Revisit after the pilot.
- **Claims per company.** `requireApiUser` reads claims through a new `getUserClaimsForCompany(userId, companyId)` cached at `permissions:${userId}:${companyId}`, and every existing `redis.del(getPermissionCacheKey(userId))` site also deletes the company-scoped key. This is an auth change: raise it in the Phase 1 PR description for Brad.
- **Instance name in `/me`.** `"Carbon Cloud"` when `CARBON_EDITION === "cloud"`, else the hostname of `getMESUrl()`.
- **Analytics key in `/me`.** Returned only when `CARBON_EDITION === "cloud"` and neither `CONTROLLED_ENVIRONMENT` nor `CARBON_DEPLOYMENT_MODE === "airgapped"`.
- **Terminal token transport.** `POST /console/pin-in` sends the user's Bearer token plus `X-Carbon-Terminal: <terminal token>`.
- **`WorkSource`.** A new value `"mes_mobile"` (TypeScript union, not a DB enum) tags events the API creates.
- **Tracked pick options.** A read the spec did not list, `GET /picking/:listId/lines/:lineId/tracked-options`, mirrors the loader of `picking.$pickingListId.tracked.$lineId.tsx`; the app cannot pick a tracked entity without it. Additive.
- **`@carbon/utils` from React Native.** The barrel exports tiptap, dompurify and cookie helpers. The app imports only subpaths; Task 20 adds `./format`, `./date`, `./datetime`, `./status` next to the existing `./status-colors` export.
- **Locale list.** `@carbon/mes-core` exports `MES_LOCALES`, pinned by a test against `lingui.config.js`, because `@carbon/locale`'s `config.ts` boots `@carbon/env` at import and cannot run in Hermes.
- **Tests.** Pure logic (outbox policy, URL resolution, error mapping, contract schemas) is tested with vitest in Node; React Native components are verified on devices. No jest-expo.

## Conventions (all tasks)
- New file → AGPL SPDX header via `pnpm license:headers` (run it; never hand-type). Tracked `metro.config.js`, `babel.config.js` and `*.d.ts` need it too; `app.json` / `eas.json` do not.
- No JavaScript `Date` for parsing, formatting or arithmetic: `@internationalized/date` + `@carbon/utils` `formatDate` / `datetime`. Quantities through the quantity kind (`formatQuantity`); no `Math.round` on values.
- Every user-facing string, including accessibility labels, through Lingui (`useLingui().t` or `<Trans>` from `@lingui/react/macro`). Never `import { t } from "@lingui/core/macro"`.
- Every persisted client cache, query key and outbox row is keyed by `(instanceId, companyId)`; hydration callbacks check the instance and company are still current before writing state.
- Every API request carries `Authorization`, `X-Carbon-Company`, `X-Carbon-App-Version`, and when relevant `X-Carbon-Location`, `X-Carbon-Operator`, `Idempotency-Key` (every POST). Every API response carries `carbon-api: 1`. No CORS headers.
- Web routes keep their paths and behaviour. Move bodies, do not edit them; one route per commit; rerun the moved flow on web before the API uses it.
- Service shape: `(client, args) => { data, error }`; never build a DB client inside a `*.service.ts`; Kysely only in `.server` files via `getDatabaseClient()`.
- Typecheck scoped: `pnpm exec turbo run typecheck --filter=<pkg>`. Never the whole repo.
- Dependency versions: `pnpm-workspace.yaml` has `minimumReleaseAge: 4320` (3 days); a version younger than that is refused by `pnpm install` — pick the previous release.
- Ask First items in this plan: the Lingui catalog glob change (approved in spec Q10), the claims cache key (Task 11), and adding a QR production dependency if none exists (Task 17).

---

# Phase 0 — Scaffold (branch `feat/mobile-scaffold`, ~1 week)

Done when: CI is green with an empty app that opens on the iPhone 13, the iPad and the Android phone through Expo Go, and `pnpm why react` for `erp` and `mes` shows only 18.3.1.

## Task 1: Record the spec corrections found during planning

**Depends on:** none
**Files:**
- Modify: `.ai/specs/2026-09-30-mes-mobile-app.md` — fix the inline facts and add a Changelog entry.

**Steps:**
1. Apply the 14 items under "Spec corrections found during planning" (this file) to the spec text: the `verifyTotpChallenge` location and the `/auth/mfa` body (`{ accessToken, refreshToken, code }`); the start/end/event route roles in the Commands table (`POST /operations/:id/events` → `x+/event.tsx` Start, or `x+/start.$operationId.tsx` when `viaScan`; `POST /events/:id/end` → `x+/event.tsx` End; `POST /operations/:id/end` → `x+/end.$operationId.tsx`); `POST /timecard/clock-in|clock-out` → `api+/timecard.ts`; `SUPABASE_ANON_KEY`; the ERP template copy under Data Model Changes; `@react-email/preview-server` pins under Tooling; `models.ts` 478 lines; `~/services/<name>.service` naming.
2. Append to `## Changelog`: `- 2026-10-02: Planning pass (.ai/plans/2026-10-02-mes-mobile-app.md). Corrected …` listing the items in one sentence each.
3. Do not change any decision; this task records facts only.

**Verify:**
```bash
grep -c "2026-10-02" .ai/specs/2026-09-30-mes-mobile-app.md
# Expected: 1 or more
grep -n "mfa.server" .ai/specs/2026-09-30-mes-mobile-app.md | head -1
# Expected: one line (the corrected location)
git diff --stat -- .ai/specs/2026-09-30-mes-mobile-app.md
# Expected: only this file changed
```

**Out of scope:** rewriting sections, changing scope or answers to Q1–Q15.

## Task 2: Scope the React pin to the packages that need it

**Depends on:** none
**Files:**
- Modify: `pnpm-workspace.yaml` — `overrides:` block (lines 13–17 today hold the four global React pins).
- Modify: `pnpm-lock.yaml` — regenerated by `pnpm install`.

**Steps:**
1. Delete these four lines from `overrides:`: `react: 18.3.1`, `react-dom: 18.3.1`, `"@types/react": 18.3.28`, `"@types/react-dom": 18.3.7`. Leave every other override (semver and the security pins) untouched.
2. Add parent-scoped overrides in their place (pnpm `parent>child` selector), covering every installed package that hard-depends on React or `@types/react`:
   ```yaml
     "@react-email/preview-server>react": 18.3.1
     "@react-email/preview-server>react-dom": 18.3.1
     "@react-email/preview-server>@types/react": 18.3.28
     "@react-email/preview-server>@types/react-dom": 18.3.7
     "linguito>react": 18.3.1
     "@types/react-csv>@types/react": 18.3.28
     "@types/react-reconciler>@types/react": 18.3.28
     "@types/react-window>@types/react": 18.3.28
     "@visx/group>@types/react": 18.3.28
     "@visx/responsive>@types/react": 18.3.28
     "@visx/shape>@types/react": 18.3.28
     "@visx/text>@types/react": 18.3.28
   ```
3. `pnpm install`.
4. Prove web is unchanged with the commands below. If `pnpm why` prints any React other than 18.3.1 for `erp`, `mes` or `@carbon/documents`, STOP and report the dependency path — do not restore a global override.

**Verify:**
```bash
pnpm install 2>&1 | tail -3
# Expected: "Done" with no ERR lines
for p in erp mes @carbon/documents; do pnpm why react --filter $p | grep -E "^react " | sort -u; done
# Expected: exactly one line per package: "react 18.3.1"
pnpm why @types/react --filter erp | grep -E "^@types/react " | sort -u
# Expected: "@types/react 18.3.28" only
pnpm exec turbo run typecheck --filter=erp --filter=mes --filter=@carbon/documents --filter=@carbon/react
# Expected: "Tasks: 4 successful, 4 total"
```

**Out of scope:** adding the `mobile` catalog (Task 4, once `expo install --fix` has resolved the SDK 57 set).

## Task 3: Create `packages/mes-core`

**Depends on:** none
**Files:**
- Create: `packages/mes-core/package.json`, `packages/mes-core/tsconfig.json`, `packages/mes-core/vitest.config.ts`, `packages/mes-core/src/index.ts`, `packages/mes-core/src/contract.ts`, `packages/mes-core/src/contract.test.ts`, `packages/mes-core/src/locales.ts`, `packages/mes-core/src/locales.test.ts`, `packages/mes-core/AGENTS.md`, `packages/mes-core/CLAUDE.md`
- Modify: `packages/checks/src/sources/typescript.ts` — add `"packages/mes-core/src"` to `TYPESCRIPT_ROOTS` (lines 12–32). Do NOT add `apps/mobile/src` yet: `walk()` has no `existsSync` guard and the directory does not exist until Task 4.
- Modify: `AGENTS.md` (root) — the "Packages" line under Architecture Quick Reference: add `mes-core` (and, while there, the missing `workflows-core`, `planning`, `viewer`).
- Copy from (precedent): `packages/workflows-core/package.json`, `packages/workflows-core/tsconfig.json`, `packages/workflows-core/vitest.config.ts`; AGENTS.md shape from `packages/kv/AGENTS.md` and `packages/kv/CLAUDE.md`.

**Steps:**
1. `package.json`: `"name": "@carbon/mes-core"`, `"private": true`, `"version": "0.0.0"`, `"type": "module"`, `"sideEffects": false`, `"exports": { ".": "./src/index.ts", "./contract": "./src/contract.ts", "./locales": "./src/locales.ts" }` (Task 21 adds `./models` and `./queries`), scripts `clean`, `lint`, `test: vitest run`, `typecheck: tsgo --noEmit` as in the precedent, `dependencies: { "zod": "catalog:" }`, `devDependencies: { "@carbon/config": "workspace:*", "@carbon/database": "workspace:*", "@supabase/supabase-js": "catalog:", "typescript": "catalog:", "vitest": "catalog:" }`. The package must never import React, DOM APIs, Node APIs, `@carbon/env`, `@carbon/auth` or `@carbon/ee` — it is bundled into the phone app.
2. `tsconfig.json` and `vitest.config.ts`: copy the precedent files verbatim (`extends: "@carbon/config/tsconfig/base.json"`, `include: ["src"]`; `export { default } from "@carbon/config/vitest";`).
3. `src/contract.ts`:
   ```ts
   export const API_VERSION = 1 as const;
   export const API_PREFIX = "/api/v1" as const;
   export const HEADERS = {
     company: "x-carbon-company",
     location: "x-carbon-location",
     operator: "x-carbon-operator",
     terminal: "x-carbon-terminal",
     appVersion: "x-carbon-app-version",
     idempotencyKey: "idempotency-key",
     apiVersions: "carbon-api",
   } as const;
   export type ApiErrorCode =
     | "validation_failed" | "invalid_token" | "token_expired" | "mfa_required"
     | "operator_expired" | "company_required" | "location_required" | "forbidden"
     | "sso_required" | "not_found" | "conflict" | "blocked" | "needs_acknowledgement"
     | "request_in_progress" | "idempotency_key_required" | "idempotency_key_reused"
     | "update_required" | "rate_limited" | "locked" | "retry_later" | "invalid_code" | "internal";
   export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; fields?: Record<string, string[]>; details?: unknown } };
   export function compareAppVersion(a: string, b: string): -1 | 0 | 1  // numeric dotted compare, missing parts = 0
   ```
4. `src/locales.ts`: `export const MES_LOCALES = ["en","es","de","it","ja","zh","fr","pl","pt","ru","hi","tr","ko"] as const; export type MesLocale = (typeof MES_LOCALES)[number];`
5. `src/locales.test.ts`: `createRequire(import.meta.url)("../../../lingui.config.js").locales` must deep-equal `[...MES_LOCALES]`. `src/contract.test.ts`: `compareAppVersion("1.2.0","1.10.0") === -1`, `("2","1.9.9") === 1`, `("1.0","1.0.0") === 0`.
6. `src/index.ts`: `export * from "./contract"; export * from "./locales";`
7. `AGENTS.md`: Always (zod + types only; every schema has a JSON shape; `client` first, `{ data, error }` returned from `queries.ts`), Ask First (changing a wire contract — `/api/v1` is additive-only), Never (React, DOM, Node, `@carbon/env`, `@carbon/auth`, `@carbon/ee` imports). `CLAUDE.md` contains `@AGENTS.md`.
8. `pnpm install`, then `pnpm license:headers`.

**Verify:**
```bash
pnpm --filter @carbon/mes-core test
# Expected: 2 test files passed
pnpm exec turbo run typecheck --filter=@carbon/mes-core
# Expected: 1 successful
pnpm --filter @carbon/config build && pnpm --filter @carbon/checks exec vitest run src/run.test.ts
# Expected: passes (no new conformance findings)
head -1 packages/mes-core/src/contract.ts
# Expected: // SPDX-License-Identifier: AGPL-3.0-only
```

**Out of scope:** command/query schemas (Task 21), the `/me` and screen contracts (Tasks 10, 31).

## Task 4: Create the Expo app at `apps/mobile`

**Depends on:** Task 2, Task 3
**Files:**
- Create: `apps/mobile/` from the Expo SDK 57 default template, then: `apps/mobile/package.json` (rewritten), `apps/mobile/app.json`, `apps/mobile/tsconfig.json`, `apps/mobile/.gitignore`, `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/index.tsx`
- Modify: `pnpm-workspace.yaml` — add `catalogs: mobile:`; `apps/biome.jsonc` — add `"./mobile/src/**/*.ts*"` to `files.includes`; `packages/checks/src/sources/typescript.ts` — add `"apps/mobile/src"` to `TYPESCRIPT_ROOTS`; `turbo.json` — add `"apps/mobile/src/**"` to the `//#lingui:compile` `inputs` (next to `"apps/mes/app/**"`).
- Copy from (precedent): `apps/mes/.gitignore` (shape), `apps/mes/package.json` scripts (`lint`, `typecheck`, `test`).

**Steps:**
1. From the repo root: `npx create-expo-app@latest apps/mobile --template default@sdk-57 --no-install`. If the `@sdk-57` tag is rejected, run `--template default` and confirm the generated `expo` version is `~57.x`; if it is 58 or newer, STOP and report — the spec pins SDK 57 (React Native 0.86, React 19.2).
2. Rewrite `apps/mobile/package.json`: `"name": "mobile"`, `"private": true`, `"sideEffects": false`, `"main": "expo-router/entry"`, scripts:
   `"start": "expo start"`, `"android": "expo run:android"`, `"ios": "expo run:ios"`, `"typecheck": "tsgo --noEmit"`, `"lint": "biome lint --write "`, `"test": "vitest run"`, `"export:check": "expo export --platform ios --platform android --output-dir .expo-export --clear"`, `"clean": "rimraf .expo .expo-export node_modules"`. No `build` script (EAS builds; `pnpm run build` stays unaffected).
3. `pnpm install`, then `pnpm --filter mobile exec expo install --fix` so every Expo/RN package is the SDK 57 version. Read the resolved versions of `expo`, `react`, `react-native`, `@types/react`, `expo-router`, `expo-linking`, `expo-constants`, `expo-status-bar`, `react-native-safe-area-context`, `react-native-screens`, `react-native-reanimated`, `react-native-gesture-handler` out of the lockfile and write them into `pnpm-workspace.yaml`:
   ```yaml
   catalogs:
     mobile:
       expo: <resolved>
       react: <resolved 19.2.x>
       react-native: <resolved 0.86.x>
       "@types/react": <resolved ~19.2>
       expo-router: <resolved>
       ... (one line per package above)
   ```
   then change those specs in `apps/mobile/package.json` to `"catalog:mobile"` and run `pnpm install` again. Every later `expo install <pkg>` in this plan is followed by moving the version into `catalogs.mobile`.
4. Move the template's `app/` directory to `src/app/`, delete the example screens, keep `_layout.tsx` (Stack) and add `index.tsx` rendering the text "Carbon MES" (a plain `<Text>` for now; Lingui arrives in Task 6).
5. `app.json` → `expo`: `"name": "Carbon MES"`, `"slug": "carbon-mes"`, `"scheme": "carbon-mes"`, `"version": "1.0.0"`, `"orientation": "default"`, `"userInterfaceStyle": "automatic"`, `"newArchEnabled": true`, `"ios": { "bundleIdentifier": "ms.carbon.mes", "supportsTablet": true }`, `"android": { "package": "ms.carbon.mes" }`, `"plugins": ["expo-router"]`, `"experiments": { "typedRoutes": true }`. Keep the template's icon/splash entries until Task 48.
6. `tsconfig.json`: `{ "extends": "expo/tsconfig.base", "compilerOptions": { "strict": true, "paths": { "~/*": ["./src/*"] } }, "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"] }`.
7. `.gitignore` (the app's own): `node_modules/`, `.expo/`, `.expo-export/`, `expo-env.d.ts`, `ios/`, `android/`, `dist/`, `*.jks`, `*.p8`, `*.p12`, `*.key`, `*.mobileprovision`, `*.orig.*`, `web-build/`.
8. Tooling edits listed under Files. Then `pnpm license:headers` (adds the AGPL header to `metro.config.js`, `babel.config.js`, every `src/**` file and any `.d.ts`).
9. If `tsgo --noEmit` cannot handle the Expo project (unknown compiler options or React Native type errors that `tsc` accepts), switch the script to `"typecheck": "tsc --noEmit"` (precedent `packages/jobs`) and say so in the PR.

**Verify:**
```bash
pnpm install 2>&1 | tail -2 && git status --short pnpm-lock.yaml
# Expected: lockfile modified, no install errors
pnpm --filter mobile exec expo-doctor
# Expected: "No issues detected" (all checks passed)
pnpm why react --filter mobile | grep -E "^react " | sort -u
# Expected: one line, react 19.2.x
pnpm exec turbo run typecheck --filter=mobile --filter=erp --filter=mes
# Expected: 3 successful
pnpm --filter mobile run export:check 2>&1 | tail -3
# Expected: "Exported: .expo-export" (bundles for ios and android, no errors)
pnpm exec biome check apps/mobile && pnpm --filter @carbon/checks exec vitest run src/run.test.ts
# Expected: both pass
```

**Out of scope:** styling, i18n, EAS, any real screen.

## Task 5: Styling — Uniwind, Carbon tokens, React Native Reusables

**Depends on:** Task 4
**Files:**
- Create: `apps/mobile/global.css`, `apps/mobile/metro.config.js`, `apps/mobile/components.json` (written by the RNR CLI), `apps/mobile/src/components/ui/*.tsx` (copied in by the RNR CLI), `apps/mobile/src/lib/utils.ts` (`cn`, written by the CLI), `apps/mobile/src/theme.test.ts`
- Modify: `apps/mobile/src/app/_layout.tsx` — `import "../../global.css";` first line after the header; `apps/mobile/package.json`.
- Copy from (precedent): colour tokens in `packages/config/tailwind/theme.css` (the `:root` / `.dark` colour variable blocks — `grep -n "background" packages/config/tailwind/theme.css` to find them); MES usage in `apps/mes/app/styles/tailwind.css`.

**Steps:**
1. `pnpm --filter mobile add uniwind tailwindcss@catalog:` — Tailwind comes from the default catalog (4.x, the version Carbon web uses); pin `uniwind` to the newest release that is at least 3 days old. Record both in `catalogs.mobile`.
2. `metro.config.js`:
   ```js
   const { getDefaultConfig } = require("expo/metro-config");
   const { withUniwindConfig } = require("uniwind/metro");
   const config = getDefaultConfig(__dirname);
   module.exports = withUniwindConfig(config, { cssEntryFile: "./global.css" });
   ```
   (Task 6 adds the Lingui transformer to this file.)
3. `global.css`: `@import "tailwindcss"; @import "uniwind";` then a `@theme` block that re-declares Carbon's colour tokens (`--color-background`, `--color-foreground`, `--color-card`, `--color-primary`, `--color-primary-foreground`, `--color-secondary`, `--color-muted`, `--color-muted-foreground`, `--color-accent`, `--color-destructive`, `--color-border`, `--color-input`, `--color-ring`, plus the emerald/red hero colours used by `Controls.tsx`) with the exact values from `theme.css`, and a `.dark` block with the dark values. Do NOT `@import` `theme.css` itself: it carries `@source`, `@plugin` and `@property` rules Uniwind does not process.
4. `src/theme.test.ts` (vitest, Node): read both CSS files with `node:fs`, extract every `--color-*` declaration present in `global.css`, and assert each value equals the value of the same variable in `theme.css` (light and dark). This is the drift guard; the copy is deliberate.
5. React Native Reusables: in `apps/mobile`, run `npx @react-native-reusables/cli@latest init` and choose **Uniwind** as the styling engine when prompted; set the aliases in `components.json` to `~/components/ui` and `~/lib/utils`. Then `npx @react-native-reusables/cli@latest add button text input label card badge dialog tabs select separator skeleton checkbox switch alert-dialog`. Move any dependency it installs into `catalogs.mobile`. The copied components are ours to edit — set `size="lg"` as the Button default (shop-floor rule: 44–48 pt targets).
6. Toasts: `pnpm --filter mobile add sonner-native` (pin; record in the catalog) and mount `<Toaster position="bottom-left" />` in `_layout.tsx` (MES puts toasts bottom-left because the dock lives bottom-right).
7. Replace `index.tsx`'s plain `<Text>` with the RNR `Text` inside a `View className="flex-1 items-center justify-center bg-background"` and a `Button size="lg"` labelled "Carbon MES".

**Verify:**
```bash
pnpm --filter mobile test
# Expected: theme.test.ts passes (every token matches theme.css)
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: typecheck successful; "Exported: .expo-export"
```
Device check: the screen background and button use Carbon's colours in light and dark mode (toggle the device appearance). Attach one screenshot per mode to the PR.

**Out of scope:** the dock and hero buttons (Task 34), theme switching from the More screen (Task 45).

## Task 6: Lingui on Metro (shared `mes` catalog)

**Depends on:** Task 5
**Files:**
- Create: `apps/mobile/babel.config.js` (if the template did not), `apps/mobile/src/i18n/catalogs.ts`, `apps/mobile/src/i18n/index.tsx`, `apps/mobile/src/i18n/po.d.ts`, `apps/mobile/src/i18n/polyfills.ts`
- Modify: `apps/mobile/metro.config.js` — Lingui transformer; `lingui.config.js` (root) — the `mes` catalog's `include` gains `"apps/mobile/src"` (Ask First item approved in spec Q10; mention it in the PR); `apps/mobile/src/app/_layout.tsx` — providers; `apps/mobile/src/app/index.tsx` — the string goes through `<Trans>`.
- Copy from (precedent): `apps/mes/app/services/lingui.ts` (catalog map + preload), `packages/locale/src/i18n.tsx` (`setupI18n` + `load` + `activate`).

**Steps:**
1. Dependencies (versions = the `@lingui/*` catalog version, 5.9.4): `pnpm --filter mobile add @lingui/core@catalog: @lingui/react@catalog: @lingui/babel-plugin-lingui-macro@5.9.4 @formatjs/intl-locale @formatjs/intl-pluralrules` and `pnpm --filter mobile add -D @lingui/metro-transformer@5.9.4`. If `@lingui/babel-plugin-lingui-macro` or `@lingui/metro-transformer` has no 5.9.4 release, use the nearest published 5.x and add it to the root catalog so the four `@lingui/*` entries stay aligned.
2. `babel.config.js`: `module.exports = (api) => { api.cache(true); return { presets: ["babel-preset-expo"], plugins: ["@lingui/babel-plugin-lingui-macro"] }; };` (the macro plugin first in `plugins`).
3. `metro.config.js`: after `getDefaultConfig`, set `config.transformer = { ...config.transformer, babelTransformerPath: require.resolve("@lingui/metro-transformer/expo") }` and `config.resolver = { ...config.resolver, sourceExts: [...config.resolver.sourceExts, "po", "pot"] }`, then pass the result to `withUniwindConfig`. If Uniwind also sets `transformer.babelTransformerPath` (check the config object it returns), STOP and report: the two transformers need a chaining shim and that is a design decision.
4. `src/i18n/po.d.ts`: `declare module "*.po" { import type { Messages } from "@lingui/core"; export const messages: Messages; }`
5. `src/i18n/catalogs.ts`: one entry per locale in `MES_LOCALES` (from `@carbon/mes-core/locales`), each a static dynamic import so Metro bundles it lazily:
   `export const catalogs = { en: () => import("../../../../packages/locale/locales/en/mes.po"), es: () => import("../../../../packages/locale/locales/es/mes.po"), /* …all 13… */ } satisfies Record<MesLocale, () => Promise<{ messages: Messages }>>;`
6. `src/i18n/polyfills.ts`: `import "@formatjs/intl-locale/polyfill-force"; import "@formatjs/intl-pluralrules/polyfill-force";` plus `import "@formatjs/intl-pluralrules/locale-data/<l>"` for each of the 13 locales. Import this file first in `_layout.tsx`.
7. `src/i18n/index.tsx`: `const i18n = setupI18n();` `export async function activateLocale(locale: MesLocale) { const { messages } = await catalogs[locale](); i18n.load(locale, messages); i18n.activate(locale); }` and `export function I18nRoot({ children })` rendering `<I18nProvider i18n={i18n}>`; initial locale from `expo-localization` (`getLocales()[0].languageCode`) when it is in `MES_LOCALES`, else `"en"` (Task 45 adds the user's choice).
8. `index.tsx`: `<Trans>Carbon MES</Trans>`.
9. `pnpm run lingui:extract` — the string must appear in `packages/locale/locales/en/mes.po` with an `apps/mobile/src/app/index.tsx` origin; then `pnpm run lingui:clean` is NOT needed (origins are stripped only by the `translate` script; follow whatever `pnpm run lingui:check` leaves).

**Verify:**
```bash
pnpm run lingui:check 2>&1 | tail -3
# Expected: extract + compile succeed
grep -n "Carbon MES" packages/locale/locales/en/mes.po
# Expected: one msgid line
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Device check: the title renders; with the device language set to Spanish (or `activateLocale("es")` forced in dev), the Spanish `msgstr` renders once it exists in `es/mes.po`.

**Out of scope:** the language picker (Task 45), translating the new strings (Task 47).

## Task 7: App shell — providers and the Expo Router skeleton

**Depends on:** Task 6
**Files:**
- Create: `apps/mobile/src/app/_layout.tsx` (rewrite), `apps/mobile/src/app/(setup)/connect.tsx`, `apps/mobile/src/app/(setup)/instances.tsx`, `apps/mobile/src/app/(auth)/sign-in.tsx`, `apps/mobile/src/app/(auth)/verify.tsx`, `apps/mobile/src/app/(auth)/two-factor.tsx`, `apps/mobile/src/app/(auth)/password.tsx`, `apps/mobile/src/app/(app)/_layout.tsx`, `apps/mobile/src/app/(app)/context.tsx`, `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`, `apps/mobile/src/app/(app)/(tabs)/operations/index.tsx`, `apps/mobile/src/app/(app)/(tabs)/operations/[id].tsx`, `apps/mobile/src/app/(app)/(tabs)/picking/index.tsx`, `apps/mobile/src/app/(app)/(tabs)/picking/[listId].tsx`, `apps/mobile/src/app/(app)/(tabs)/timecard.tsx`, `apps/mobile/src/app/(app)/(tabs)/more.tsx`, `apps/mobile/src/app/(app)/scan.tsx`, `apps/mobile/src/app/(app)/pin.tsx`, `apps/mobile/src/lib/query/client.ts`, `apps/mobile/src/lib/query/keys.ts`
- Delete: `apps/mobile/src/app/index.tsx` (the root redirects to `(setup)/connect` until an instance exists; Task 18 wires the real guard).
- Copy from (precedent): tab list from the spec's Screens section (Operations · Picking · Scan · Timecard · More); MES queue names in `apps/mes/app/components/AppSidebar.tsx`.

**Steps:**
1. `pnpm --filter mobile add @tanstack/react-query@5.97.0 lucide-react-native` (the same react-query literal `apps/mes/package.json` uses; add `lucide-react-native` to `catalogs.mobile`; `expo install react-native-svg` for lucide and record it).
2. `src/lib/query/client.ts`: `new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } } })`. `src/lib/query/keys.ts`: `export const keys = { operations: (s: Scope, locationId: string, workCenterIds: string[]) => ["ops", s.instanceId, s.companyId, locationId, ...workCenterIds] as const, operation: (s, id) => [...], picking: (s) => [...], pickingList: (s, listId) => [...], timecard: (s) => [...], me: (s) => ["me", s.instanceId] as const }` with `type Scope = { instanceId: string; companyId: string }`. Every query key in the app comes from this file.
3. `_layout.tsx`: `polyfills` import, `global.css` import, `GestureHandlerRootView` → `SafeAreaProvider` → `QueryClientProvider` → `I18nRoot` → `<Stack screenOptions={{ headerShown: false }} />` → `<Toaster />`.
4. `(app)/(tabs)/_layout.tsx`: Expo Router `Tabs` with five screens in the spec's order, lucide icons `ClipboardList`, `PackageCheck`, `ScanLine`, `Clock`, `Menu`; labels through `useLingui().t`; the Scan tab is a `href: null` tab that opens `(app)/scan` as a modal (`presentation: "modal"` in the `(app)/_layout.tsx` Stack). Tab bar height ≥ 56 and labels `text-sm` (shop-floor sizes).
5. Every other file: a screen with a header title through Lingui and a one-line body saying what the screen will hold. `(app)/_layout.tsx` is a `Stack` with no guard yet.
6. `pnpm license:headers`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
pnpm run lingui:extract >/dev/null && grep -c "apps/mobile/src/app" packages/locale/locales/en/mes.po
# Expected: 15 or more origins (one per placeholder title at least)
```
Device check: the five tabs switch; `operations/index` → tapping a placeholder link opens `operations/[id]`; Scan opens as a modal and dismisses.

**Out of scope:** data, auth, real layouts.

## Task 8: Developer loop — LAN env, Expo Go on the three devices, `apps/mobile/AGENTS.md`

**Depends on:** Task 7
**Files:**
- Create: `apps/mobile/AGENTS.md`, `apps/mobile/CLAUDE.md` (`@AGENTS.md`)
- Modify: `apps/mes/package.json` — add `"dev:lan": "react-router dev --host 0.0.0.0 --port 3001"`; `.claude/launch.json` — add `{ "name": "mes-lan", "runtimeExecutable": "pnpm", "runtimeArgs": ["--filter", "mes", "run", "dev:lan"], "port": 3001, "url": "http://localhost:3001" }`; `AGENTS.md` (root) — Apps list gains `mobile` (shop-floor native app) and the Task Router gains the row `| MES mobile app (Expo) | apps/mobile/AGENTS.md |` under Domain Modules; `.claude/rules/environment-configuration.md` — one paragraph "Device testing" pointing at the `#force` `SUPABASE_URL` line and `dev:lan`.
- Copy from (precedent): `packages/kv/AGENTS.md` (Always / Ask First / Never shape); the Device test loop section of this plan (copy its six steps into AGENTS.md).

**Steps:**
1. `apps/mobile/AGENTS.md` sections: What this app is (one paragraph, links to the spec and this plan); Run it (the six Device test loop steps, verbatim); Layout (`src/app` routes, `src/features/*`, `src/lib/*`, `src/components/ui` = RNR copies); Always (Lingui for every string; `(instanceId, companyId)`-keyed state; `@carbon/utils` subpaths only; no JS `Date`; `catalogs.mobile` for every dependency; `pnpm license:headers`); Ask First (new native module — it ends Expo Go compatibility; new production dependency; any change to `/api/v1` contracts); Never (service-role key, calling web route actions, `localStorage`-style unscoped caches, `fetch` to any host but the instance's own before sign-in); Validation commands (`pnpm exec turbo run typecheck --filter=mobile`, `pnpm --filter mobile test`, `pnpm --filter mobile run export:check`, `pnpm run lingui:check`).
2. Run the Device test loop end to end on the iPhone 13, the iPad and the Android phone with the Task 7 skeleton. Note: at this task there is no instance linking yet, so step 5 is skipped; steps 1–4 prove the bundler, the LAN MES server and the Supabase URL are reachable from the devices.
3. Record each device's OS version in the PR description (Expo Go needs iOS/iPadOS 16.4+).

**Verify:**
```bash
pnpm --filter mes run dev:lan >/tmp/mes-lan.log 2>&1 & sleep 15; curl -s -o /dev/null -w "%{http_code}\n" http://$(ipconfig getifaddr en0):3001/login
# Expected: 200 (the MES login page answers on the LAN address); then stop the server
curl -s http://$(ipconfig getifaddr en0):54321/auth/v1/health
# Expected: a JSON body (any 2xx/4xx JSON proves Kong is reachable on the LAN; "No API key" is fine)
grep -n "dev:lan" apps/mes/package.json .claude/launch.json
# Expected: one hit in each
```
Device check: `pnpm --filter mobile start` → scan on all three devices → the Task 7 skeleton renders on each; from the Android phone's browser, `http://<LAN-IP>:3001/login` loads. Attach three screenshots to the PR. Stop-point: open the `feat/mobile-scaffold` PR.

**Out of scope:** instance linking, sign-in (Phase 1).

---

# Phase 1 — Spike (branch `feat/mobile-spike`, ~1 week)

Done when: a user links the app to the local MES over the LAN, signs in with an emailed code (and 2FA when enrolled), and the operations list on the iPad and the Android phone matches web MES for the same location and work centers.

## Task 9: `@carbon/env` — `APP_REVIEW_EMAILS` and `CARBON_DEPLOYMENT_MODE`

**Depends on:** none
**Files:**
- Modify: `packages/env/src/index.ts` — two exports next to `BOT_PROTECTION` (~line 505) and the `NodeJS.ProcessEnv` declaration; NOT in `getBrowserEnv()` (neither is browser-safe or browser-needed).
- Modify: `.env.example` — commented examples under the Analytics / config block.
- Modify: `.claude/rules/environment-configuration.md` — add both to "Analytics / config".
- Copy from (precedent): `export const BOT_PROTECTION = getEnv("BOT_PROTECTION", { isRequired: false, isSecret: false });` and its boot-time validation.

**Steps:**
1. ```ts
   export const APP_REVIEW_EMAILS: readonly string[] = (getEnv("APP_REVIEW_EMAILS", { isRequired: false, isSecret: false }) ?? "")
     .split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
   const deploymentMode = getEnv("CARBON_DEPLOYMENT_MODE", { isRequired: false, isSecret: false }) ?? "connected";
   if (deploymentMode !== "connected" && deploymentMode !== "airgapped") throw new Error(`CARBON_DEPLOYMENT_MODE must be "connected" or "airgapped", got "${deploymentMode}"`);
   export const CARBON_DEPLOYMENT_MODE = deploymentMode as "connected" | "airgapped";
   ```
2. `.env.example`: `# APP_REVIEW_EMAILS="reviewer@carbon.ms"  # Carbon Cloud only: store-review accounts that sign in with a password` and `# CARBON_DEPLOYMENT_MODE="connected"  # or "airgapped": turns off every outbound call the mobile app would make`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/env --filter=mes
# Expected: 2 successful
CARBON_DEPLOYMENT_MODE=bogus pnpm --filter mes exec vitest run app/services/models.batch.test.ts 2>&1 | grep -c "CARBON_DEPLOYMENT_MODE must be"
# Expected: 1 (boot validation fires; the test file imports the env chain)
```
If that test file does not import the env chain (count is 0), run `CARBON_DEPLOYMENT_MODE=bogus pnpm --filter mes exec react-router dev --port 3999` for 10 seconds instead and expect the same message in its output.

**Out of scope:** reading these flags anywhere (Task 14).

## Task 10: `@carbon/mes-core` contract for the Phase 1 endpoints

**Depends on:** Task 3
**Files:**
- Modify: `packages/mes-core/src/contract.ts`, `packages/mes-core/src/contract.test.ts`

**Steps:**
1. Add zod schemas and their inferred types (`z.infer`) — these are the wire contract both sides import:
   - `authCodeRequest = z.object({ email: z.string().email() })`; `authCodeResponse = z.object({ ok: z.literal(true), method: z.literal("password").optional() })`
   - `authVerifyRequest = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) })`
   - `authSessionResponse = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number(), mfaRequired: z.boolean() })`
   - `authMfaRequest = z.object({ accessToken: z.string(), refreshToken: z.string(), code: z.string().regex(/^\d{6}$/) })`
   - `authPasswordRequest = z.object({ email: z.string().email(), password: z.string().min(1) })`
   - `meResponse = z.object({ instance: z.object({ name: z.string(), supabaseUrl: z.string().url(), supabaseAnonKey: z.string(), mode: z.enum(["connected","airgapped"]), controlledEnvironment: z.boolean(), idleLockMs: z.number(), minAppVersion: z.string(), analytics: z.object({ posthogKey: z.string(), posthogHost: z.string() }).nullable() }), user: z.object({ id: z.string(), email: z.string(), name: z.string() }), companies: z.array(z.object({ id: z.string(), name: z.string() })), locations: z.array(z.object({ id: z.string(), name: z.string(), companyId: z.string() })), defaultLocationId: z.string().nullable(), workCenters: z.array(z.object({ id: z.string(), name: z.string(), locationId: z.string() })), consoleAvailable: z.boolean(), permissions: z.object({ production: z.object({ view: z.boolean(), create: z.boolean(), update: z.boolean() }), inventory: z.object({ view: z.boolean(), update: z.boolean() }), quality: z.object({ create: z.boolean() }), settings: z.object({ update: z.boolean() }) }) })`
   - `operationsQuery = z.object({ workCenterIds: z.array(z.string()), filter: z.array(z.string()).default([]) })` (the web's `filter=key:op:value` strings, unchanged encoding)
   - `OperationsScreen`: the TypeScript type of what `x+/operations.tsx`'s loader returns inside `data({...})` today (`peopleStation, peopleDate, columns, items, processes, workCenters, customers, availableTags`). Declare it as a `type`, not a zod schema (the web types are DB-derived); Task 15 makes `getOperationsScreen` return exactly it.
2. Tests: each schema parses a valid example and rejects one invalid field (`code: "12345"`, `mode: "cloud"`).

**Verify:**
```bash
pnpm --filter @carbon/mes-core test && pnpm exec turbo run typecheck --filter=@carbon/mes-core
# Expected: tests pass; typecheck successful
```

**Out of scope:** command bodies and the other screens (Tasks 21, 31).

## Task 11: `@carbon/auth` — `requireApiUser` and the API error helpers

**Depends on:** Task 10
**Files:**
- Create: `packages/auth/src/services/api-user.server.ts`, `packages/auth/src/services/api-user.server.test.ts`
- Modify: `packages/auth/package.json` — `exports` gains `"./api-user.server": "./src/services/api-user.server.ts"`; `packages/auth/src/services/users.ts` — add `getCompanyPermissionCacheKey(userId, companyId)` next to `getPermissionCacheKey`; `packages/auth/src/services/users.server.ts` — add `getUserClaimsForCompany`; every site that calls `redis.del(getPermissionCacheKey(userId))` (`grep -rn "getPermissionCacheKey" apps packages --include='*.ts' --include='*.tsx'`) also deletes the company-scoped key (known `companyId` → that one; deactivation flows → one per company from `getCompaniesForUser`; `updateCompanySession` needs no scoped deletion); `packages/auth/AGENTS.md` — Key Exports table.
- Copy from (precedent): `requirePermissions` in `packages/auth/src/services/auth.server.ts` (~L189) for the permission loop and the employee-role rule; `getUserClaims` in `users.server.ts` (L45) for the Redis read-through; `verifyDownloadToken` in `packages/auth/src/lib/download-token.server.ts` for jose usage; `oauthRatelimit` in `apps/erp/app/routes/api+/mcp+/_index.ts` for a per-user `Ratelimit`.

**Steps:**
1. `getUserClaimsForCompany(userId, companyId)`: identical to `getUserClaims` except the Redis key is `getCompanyPermissionCacheKey(userId, companyId)` = `permissions:${userId}:${companyId}` and the memo key is `claims:${userId}:${companyId}:scoped`. Same 3600 s TTL, same `get_claims` RPC on a miss.
2. `api-user.server.ts`:
   ```ts
   export class ApiError extends Error { constructor(public status: number, public code: ApiErrorCode, message: string, public fields?: Record<string,string[]>, public details?: unknown) }
   export function apiErrorResponse(err: ApiError): Response   // JSON ApiErrorBody, header "carbon-api": "1"
   export type ApiUser = { companyId: string; userId: string; sessionUserId: string; consoleMode: boolean; accessToken: string; claims: Awaited<ReturnType<typeof getUserClaimsForCompany>>; client: SupabaseClient<Database> };
   export type Permissions = Parameters<typeof requirePermissions>[1];   // same shape as the web: { view?, create?, update?, delete? }
   export type ApiUserDeps = { getUser?: typeof getAuthAccountByAccessToken; getClaims?: typeof getUserClaimsForCompany; hasTotp?: typeof userHasVerifiedTotpFactor; operator?: { verify: (token: string) => Promise<StoredConsolePinIn | null>; revalidate: (stored: StoredConsolePinIn) => Promise<boolean> } };
   export async function requireApiUser(request: Request, permissions: Permissions = {}, deps: ApiUserDeps = {}): Promise<ApiUser>
   ```
   Order inside `requireApiUser`: (a) `Authorization: Bearer <t>`; missing/malformed → `ApiError(401, "invalid_token")`; `t.startsWith("crbn_")` → `ApiError(401, "invalid_token", "API keys belong to the ERP API")`. (b) `deps.getUser(t)` → null → `ApiError(401, "token_expired")`. (c) `x-carbon-company` → missing → `ApiError(400, "company_required")`. (d) claims = `deps.getClaims(userId, companyId)`; `claims.role !== "employee"` → `ApiError(403, "forbidden", "Ask your supervisor for access")`. (e) each requested permission: `claims.permissions[module]?.[action]?.includes(companyId)` else 403 (exactly `requirePermissions`' loop, no `"0"` wildcard). (f) `decodeJwt(t).aal !== "aal2" && await deps.hasTotp(userId)` → `ApiError(401, "mfa_required")`. (g) operator header (Phase 2, Task 23): when `x-carbon-operator` is present and `deps.operator` is given, verify + revalidate → `userId = stored.userId`, `sessionUserId = user.id`, `consoleMode = true`; a bad or expired token → `ApiError(401, "operator_expired")`; a header without `deps.operator` → `ApiError(400, "validation_failed", "operator tokens are not accepted here")`. (h) `new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(300, "1 m"), prefix: "@carbon/mes-api:user" }).limit(userId)` → `ApiError(429, "rate_limited")` on failure. (i) return with `client: getCarbon(t)`.
3. Tests (vitest, deps injected, `@carbon/kv` mocked so `Ratelimit` succeeds): no header → 401 `invalid_token`; `crbn_x` → 401; unknown token → 401 `token_expired`; no company header → 400; role `customer` → 403; missing `view: "production"` → 403 with the module in the message; TOTP user with an `aal1` token → 401 `mfa_required`; happy path returns `companyId`, `userId` and `consoleMode: false`.

**Verify:**
```bash
pnpm --filter @carbon/auth test 2>&1 | tail -4 && pnpm --filter @carbon/auth typecheck
# Expected: api-user.server.test.ts passes (8 tests); typecheck clean
grep -rn "getCompanyPermissionCacheKey" apps packages --include='*.ts' --include='*.tsx' | wc -l
# Expected: at least 4 (definition, getUserClaimsForCompany, and every invalidation site)
```

**Out of scope:** operator token signing (Task 23), the rate-limit tuning (revisit after pilot).

## Task 12: Shared sign-in gates — `apps/mes/app/services/auth.server.ts`

**Depends on:** none (runs in parallel with Task 11)
**Files:**
- Create: `apps/mes/app/services/auth.server.ts`
- Modify: `apps/mes/app/routes/_public+/login.tsx` — the action (lines 109–243 today) calls the new function for everything after the bot check.
- Copy from (precedent): the action body itself; `logAuthEvent` calls stay where they are in the moved code.

**Steps:**
1. Export from `auth.server.ts`:
   ```ts
   export type SignInCodeResult =
     | { kind: "sent" } | { kind: "unknown_user" } | { kind: "sso_required" }
     | { kind: "locked"; retryAfterSeconds: number } | { kind: "bypass"; email: string } | { kind: "error"; message: string };
   export async function requestSignInCode(args: { email: string; origin: string; lockout: AccountLockout; channel: "web" | "mobile" }): Promise<SignInCodeResult>
   ```
   Body = the login action's code from `lockout.status(email)` through `sendMagicLink(email, origin)`, moved without edits, in this order: `lockout.status` → `getUserByEmail` → the `DEV_BYPASS_EMAIL` check returns `{ kind: "bypass", email }` (the route does the cookie work) → `lockout.recordFailure(email)` → `isSsoRequiredForEmail(getCarbonServiceRole(), email)` → `user.data?.active` → `sendMagicLink`. Each `logAuthEvent` gains `channel` in its fields.
2. `login.tsx` keeps, in place: the IP `Ratelimit`, `validator(magicLinkValidator)`, `verifyBotProtection`, then `const result = await requestSignInCode({ email, origin: getMESUrl(), lockout: new AccountLockout({ redis }), channel: "web" })` and maps each `kind` to exactly the response the action returns today (bypass → `signInWithBypassEmail` + `setAuthSession` + redirect; unknown_user and error → the same generic failure as today; sso_required → the same message).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes
# Expected: successful
git diff --stat -- apps/mes/app/routes/_public+/login.tsx
# Expected: the action shrank; no change to the loader or component
```
Manual (web): `/auth` skill still logs in with `DEV_BYPASS_EMAIL`; requesting a code for a seeded non-bypass user still lands an email in the dev mailbox (`crbn status` → Inbucket URL); an unknown email still shows the same generic message as before the change.

**Out of scope:** the API endpoints (Task 13), changing the order of the gates.

## Task 13: Public auth endpoints — `auth/code`, `auth/verify`, `auth/mfa`, `auth/password`

**Depends on:** Task 9, Task 10, Task 11, Task 12
**Files:**
- Create: `apps/mes/app/routes/api+/v1+/lib/route.server.ts`, `apps/mes/app/routes/api+/v1+/lib/version.server.ts`, `apps/mes/app/routes/api+/v1+/lib/ratelimit.server.ts`, `apps/mes/app/routes/api+/v1+/auth.code.ts`, `apps/mes/app/routes/api+/v1+/auth.verify.ts`, `apps/mes/app/routes/api+/v1+/auth.mfa.ts`, `apps/mes/app/routes/api+/v1+/auth.password.ts`, `apps/mes/app/routes/api+/v1+/auth.code.test.ts`, `apps/mes/app/routes/api+/v1+/auth.verify.test.ts`
- Copy from (precedent): `completeMfaChallenge` in `packages/auth/src/services/session.server.ts` (loop over `getTotpFactors`, `verifyTotpChallenge`); `signInWithEmail` in `packages/auth/src/services/auth.server.ts` (service-role `signInWithPassword`); `apps/erp/app/routes/api+/v1+/lib/authenticate.server.ts` (a `.server.ts` helper colocated under a route folder — `routes.ts` ignores `**/*.server.*`).

**Steps:**
1. `lib/version.server.ts`: `export const MIN_APP_VERSION = "1.0.0";` `export const API_VERSIONS = "1";`
2. `lib/ratelimit.server.ts`: `export const authIpRatelimit = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(RATE_LIMIT * 6, "1 h"), prefix: "@carbon/mes-api:auth" });` `export const signInLockout = () => new AccountLockout({ redis });` (default prefix, shared with web).
3. `lib/route.server.ts`:
   ```ts
   type Handler<B> = (ctx: { request: Request; params: Record<string,string|undefined>; body: B; user: ApiUser | null }) => Promise<Response | object>;
   export function apiRoute<B>(opts: { method: "GET" | "POST"; public?: boolean; permissions?: Permissions; body?: z.ZodType<B>; deps?: ApiUserDeps }, handler: Handler<B>)
   ```
   returning a React Router loader/action. Order: method mismatch → 405 `validation_failed`; `x-carbon-app-version` present and `compareAppVersion(v, MIN_APP_VERSION) < 0` → 426 `update_required` (absent passes, so curl works); JSON body parse + `opts.body.safeParse` → 400 `validation_failed` with `fields` from `error.flatten().fieldErrors`; `user = opts.public ? null : await requireApiUser(request, opts.permissions, opts.deps)`; `handler(...)`; an object result → `Response.json(result)`; every response (success or error) gets `carbon-api: 1`; `ApiError` → `apiErrorResponse`; `ZodError` → 400; anything else → `logger.error(...)` (`@carbon/logger`) and 500 `internal` with a fixed message. Export `json(data, init)` for handlers that set headers.
4. `auth.code.ts` (`apiRoute({ method: "POST", public: true, body: authCodeRequest })`): `authIpRatelimit.limit(ip)` (ip from `getClientIp(request)` as login.tsx does) → 429 `rate_limited`; `email` lowercased; if `APP_REVIEW_EMAILS.includes(email)` → `{ ok: true, method: "password" }` and send nothing; else `requestSignInCode({ email, origin: getMESUrl(), lockout: signInLockout(), channel: "mobile" })` → `sent`/`unknown_user`/`bypass` → `{ ok: true }`; `sso_required` → 403 `sso_required`; `locked` → 429 `locked` with `details: { retryAfterSeconds }`; `error` → `{ ok: true }` (never leak). Loader (GET) → 405.
5. `auth.verify.ts`: rate limit; lockout `status` → 429 `locked`; if `email === DEV_BYPASS_EMAIL` (set only by `crbn up` in dev) → `signInWithBypassEmail(email)` and return its tokens (parity with the web bypass); else `getCarbon().auth.verifyOtp({ email, token: code, type: "email" })`; error → `lockout.recordFailure(email)`, `logAuthEvent("login_failed", { actor: email, channel: "mobile" })`, 401 `invalid_code`; success → `lockout.reset(email)`, `logAuthEvent("login_success", …)`, `mfaRequired = await userHasVerifiedTotpFactor(user.id)`, return `authSessionResponse`.
6. `auth.mfa.ts`: body `authMfaRequest`; `getAuthAccountByAccessToken(accessToken)` → null → 401 `token_expired`; verified factors from `getTotpFactors(user.id)`; for each, `verifyTotpChallenge({ accessToken, refreshToken }, factor.id, code)`; first non-null → return its tokens with `mfaRequired: false`, `logAuthEvent("mfa_challenge_success")`; none → lockout.recordFailure + `mfa_challenge_failed` + 401 `invalid_code`.
7. `auth.password.ts`: rate limit; `APP_REVIEW_EMAILS.includes(email)` else 403 `forbidden`; lockout status/recordFailure as above; `getCarbonServiceRole().auth.signInWithPassword({ email, password })` → tokens; `mfaRequired` as above.
8. Tests: `vi.mock("~/services/auth.server")`, `vi.mock("@carbon/auth/auth.server")`, `vi.mock("@carbon/kv")`; assert status, body and the `carbon-api` header for: ok, review email → `method: "password"`, sso → 403, GET → 405, old `x-carbon-app-version` → 426, bad code → 401 `invalid_code`.

**Verify:**
```bash
pnpm --filter mes test 2>&1 | tail -4
# Expected: auth.code.test.ts and auth.verify.test.ts pass
curl -si -X POST http://localhost:3001/api/v1/auth/code -H 'content-type: application/json' -d '{"email":"nobody@example.com"}' | grep -iE "^HTTP|^carbon-api|ok"
# Expected: HTTP/1.1 200, carbon-api: 1, {"ok":true}
curl -si -X POST http://localhost:3001/api/v1/auth/code -H 'content-type: application/json' -H 'x-carbon-app-version: 0.0.1' -d '{"email":"a@b.co"}' | grep -E "^HTTP"
# Expected: HTTP/1.1 426
curl -si http://localhost:3001/api/v1/auth/code | grep -E "^HTTP"
# Expected: HTTP/1.1 405
```

**Out of scope:** `/me`, idempotency (POSTs here are not idempotent-keyed: they create no business rows), operator tokens.

## Task 14: `GET /api/v1/me`

**Depends on:** Task 13
**Files:**
- Create: `apps/mes/app/routes/api+/v1+/me.ts`, `apps/mes/app/routes/api+/v1+/me.test.ts`
- Copy from (precedent): `apps/mes/app/routes/x+/_layout.tsx` loader — `getCompanies(client, userId)` (L153), `getLocationsByCompany(client, companyId)` (L157), the `employeeJob` default-location read (L171–175); `getWorkCentersByLocation` in `apps/mes/app/services/operations.service.ts`; `isConsoleModeEnabledForCompany` from `@carbon/ee/console.server`.

**Steps:**
1. `apiRoute({ method: "GET" })`. Build `meResponse`:
   - `instance.name`: `CARBON_EDITION === "cloud" ? "Carbon Cloud" : new URL(getMESUrl()).hostname`; `supabaseUrl: SUPABASE_URL` (the public one — never `SUPABASE_INTERNAL_URL`); `supabaseAnonKey: SUPABASE_ANON_KEY`; `mode: CARBON_DEPLOYMENT_MODE`; `controlledEnvironment: CONTROLLED_ENVIRONMENT`; `idleLockMs: SESSION_IDLE_LOCK_MS`; `minAppVersion: MIN_APP_VERSION`; `analytics`: `{ posthogKey: POSTHOG_PROJECT_PUBLIC_KEY, posthogHost: POSTHOG_API_HOST }` only when `CARBON_EDITION === "cloud" && !CONTROLLED_ENVIRONMENT && CARBON_DEPLOYMENT_MODE === "connected"`, else `null`.
   - `user` from the token's user (`id`, `email`) and the `user` table row (`fullName` → `name`) via the service-role client.
   - `companies`, `locations` (for the header company), `defaultLocationId` (`employeeJob.locationId` for `userId` in `companyId`, else null), `workCenters` for every location of the company in one query (`.in("locationId", ids)`), `consoleAvailable: (await isConsoleModeEnabledForCompany(client, companyId)) === true`.
   - `permissions.<module>.<action>` = `claims.permissions[module]?.[action]?.includes(companyId) ?? false` for production view/create/update, inventory view/update, quality create, settings update.
2. Validate the object with `meResponse.parse` before returning (the server must never ship a shape the app's zod will reject).
3. Test: mocks for the reads; asserts `analytics === null` when `CARBON_EDITION` is `community`, and that `supabaseUrl` equals the mocked `SUPABASE_URL`.

**Verify:**
```bash
pnpm --filter mes test 2>&1 | tail -3 && pnpm exec turbo run typecheck --filter=mes
# Expected: me.test.ts passes; typecheck successful
# With a token from Task 13 (code or bypass flow) and a company id:
curl -s -H "authorization: Bearer $TOKEN" -H "x-carbon-company: $COMPANY" http://localhost:3001/api/v1/me | jq -c '{name: .instance.name, url: .instance.supabaseUrl, companies: (.companies|length), console: .consoleAvailable}'
# Expected: {"name":"localhost","url":"http://localhost:54321",...,"companies":1 or more,...}
```

**Out of scope:** per-location work-center filtering in the app (Task 20).

## Task 15: Extract the operations list screen and expose `GET /api/v1/operations`

**Depends on:** Task 11, Task 10
**Files:**
- Create: `apps/mes/app/services/screens.server.ts`, `apps/mes/app/routes/api+/v1+/operations._index.ts`, `apps/mes/app/routes/api+/v1+/operations._index.test.ts`
- Modify: `apps/mes/app/routes/x+/operations.tsx` — the loader (lines 135–424 today) becomes: cookie/context reads, `?saved=1` redirect, one call, `data(screen, { headers })`.
- Copy from (precedent): the loader body itself.

**Steps:**
1. In `screens.server.ts`:
   ```ts
   export type ScreenResult<T> = { ok: true; data: T } | { ok: false; failure: CommandFailure };   // CommandFailure as defined in this plan's Decisions
   export async function getOperationsScreen(client: SupabaseClient<Database>, args: { companyId: string; locationId: string; effectiveUserId: string; filters: ReturnType<typeof getFilters>; peopleOverride: ReturnType<typeof getPeopleOverride>; timeZone: string }): Promise<ScreenResult<OperationsScreen>>
   ```
   Move the loader body after its cookie/context reads into this function unchanged, including the file-local pure helpers `getBatchTotals` and `collapseBatches`. `client` is the service-role client the loader already uses. The function never reads `request`, cookies or `userContext`.
2. `x+/operations.tsx` loader: `requirePermissions`, `userContext` → `locationId`/`effectiveUserId`, `getFilters`/`setFilters`/`getPeopleOverride` (unchanged), the `?saved=1` redirect (unchanged), then `const screen = await getOperationsScreen(getCarbonServiceRole(), {...})` and return `data(screen.data, { headers })` exactly as before. Diff the returned keys against the pre-change loader: identical.
3. `operations._index.ts`: `apiRoute({ method: "GET" })`; `locationId` from `x-carbon-location` → missing → 400 `location_required`; `workCenterIds` from `?workCenterIds=a,b` (empty = all); `filter` from repeated `?filter=` params (same strings web's cookie holds); `peopleOverride: null`; `timeZone` via `getLocationTimeZone` as the web does; return `screen.data`.
4. Test: mocks `getOperationsScreen`; asserts 400 without the location header and that `workCenterIds=a,b` reaches the screen function as `["a","b"]`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes test 2>&1 | tail -3
# Expected: successful; operations._index.test.ts passes
# Parity, same seeded data (dataset satellite), location + work centers from /me:
curl -s -H "authorization: Bearer $TOKEN" -H "x-carbon-company: $COMPANY" -H "x-carbon-location: $LOC" "http://localhost:3001/api/v1/operations?workCenterIds=" | jq '.items | length'
# Expected: the same number of operation cards web MES shows at /x/operations for that location with all work centers selected
```
Web regression (`/test`): open `/x/operations`, change the work-center filter, save it (`?saved=1`), reload — the same cards and filters as before the change.

**Out of scope:** the operation detail screen (Task 31), the app's list UI (Task 20).

## Task 16: Magic-link email template — add the 6-digit code

**Depends on:** none
**Files:**
- Modify: `packages/database/supabase/templates/magic-link.html` and `apps/erp/public/templates/magic-link.html` (identical copies; GoTrue loads the second one through `GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: ${ERP_URL}/templates/magic-link.html` in `packages/dev/docker/docker-compose.dev.yml` L113 and `contrib/deploying/simple-docker-caddy/docker-compose.prod.yml` L302).
- Modify: `contrib/deploying/simple-docker-caddy/README.md` — one note: hosted Supabase projects must paste the same template into Dashboard → Authentication → Email Templates → Magic Link.

**Steps:**
1. Under the existing `<a href="{{ .SiteURL }}/magic-link?token={{ .TokenHash }}">Log In</a>` add: `<p>Or enter this code in the Carbon MES app: <strong style="font-size:24px;letter-spacing:4px">{{ .Token }}</strong></p>`. Keep the two files byte-identical.
2. `crbn reload auth` so GoTrue re-reads its template URL (it fetches the template from `ERP_URL`, so the ERP dev server must be running when a code is requested).

**Verify:**
```bash
diff packages/database/supabase/templates/magic-link.html apps/erp/public/templates/magic-link.html && echo IDENTICAL
# Expected: IDENTICAL
grep -c "{{ .Token }}" apps/erp/public/templates/magic-link.html
# Expected: 1
```
Manual: request a code (`POST /api/v1/auth/code` for a seeded user, or the web login form) → the dev mailbox shows the link AND a 6-digit code; the web magic link still signs in.

**Out of scope:** the hosted projects' dashboards (runbook note only; done at ship time in Task 50).

## Task 17: Web "Connect mobile app" QR page (MES + ERP Settings)

**Depends on:** none
**Files:**
- Create: `apps/mes/app/routes/x+/connect-mobile.tsx`, `apps/erp/app/routes/x+/settings+/connect-mobile.tsx`, `packages/react/src/QrCode.tsx` (only if no QR component exists yet — see step 1)
- Modify: `apps/mes/app/components/UserNav.tsx` — menu item "Connect mobile app" → `path.to.connectMobile`; `apps/mes/app/utils/path.ts` — `connectMobile: \`${x}/connect-mobile\``; the ERP Settings navigation entry list (find it with `grep -rn "api-keys" apps/erp/app/routes/x+/settings+/_layout.tsx apps/erp/app/modules/settings` and add "Connect mobile app" beside API Keys, same shape).
- Copy from (precedent): any existing QR rendering in the repo — run `grep -rln -E "from \"qrcode|qrcode.react|react-qr" apps packages --include='*.tsx' --include='*.ts' | head`; reuse that dependency. If there is none, STOP and ask before adding one (production dependency).

**Steps:**
1. Both pages: `requirePermissions(request, {})` (any signed-in employee — the address is not a secret); render a 256 px QR of `carbon-mes://link?server=${encodeURIComponent(getMESUrl())}`, the plain address underneath in `font-mono`, and two sentences: "Install Carbon MES from the App Store or Google Play, then scan this code" and "Or type the address on the app's Connect screen". Lingui for every string. Layout precedent: the ERP settings cards around API keys.
2. In dev `getMESUrl()` is `http://localhost:3001`; the Device test loop types the LAN address instead — say so in a `Callout` shown only when `IS_LOCAL_DEV`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: 2 successful
```
Browser (`/test`): open `/x/connect-mobile` on MES and Settings → Connect mobile app on ERP; decode the QR with the phone camera (or `zbarimg` on a screenshot) → `carbon-mes://link?server=http%3A%2F%2Flocalhost%3A3001`.

**Out of scope:** a signed pairing token in the QR (spec: optional later hardening).

## Task 18: App — instance store, Connect screen, Instances screen

**Depends on:** Task 7
**Files:**
- Create: `apps/mobile/src/lib/instances/types.ts`, `apps/mobile/src/lib/instances/store.ts`, `apps/mobile/src/lib/instances/resolve.ts`, `apps/mobile/src/lib/instances/resolve.test.ts`, `apps/mobile/src/lib/instances/InstanceProvider.tsx`
- Modify: `apps/mobile/src/app/(setup)/connect.tsx`, `apps/mobile/src/app/(setup)/instances.tsx`, `apps/mobile/src/app/_layout.tsx` (deep-link handling, provider), `apps/mobile/src/app/index.tsx` (recreate: redirect to `(setup)/connect` when no instance, else to `(auth)/sign-in` or `(app)` depending on session — Task 19 fills the session half)
- Copy from (precedent): the Instance linking section of the spec; `expo-camera` barcode scanning (`CameraView` with `barcodeScannerSettings={{ barcodeTypes: ["qr"] }}` and `onBarcodeScanned`).

**Steps:**
1. `pnpm --filter mobile exec expo install expo-secure-store expo-camera` (versions → `catalogs.mobile`). Add the camera permission strings to `app.json` (`ios.infoPlist.NSCameraUsageDescription` = "Scan QR codes and barcodes on the shop floor"; the `expo-camera` plugin entry with `cameraPermission`).
2. `types.ts`: `Instance = { id: string; serverUrl: string; scheme: "https" | "http"; linkedAt: string; details: MeInstance | null }` (`MeInstance` = `meResponse.shape.instance` type).
3. `resolve.ts` (pure): `resolveServerAddress(input)`: a `carbon-mes://link?server=…` URL → its `server` param; a full `http(s)://` URL → as given (origin only, no path); a bare host → `https://mes.${host}` (BYOC convention); `CARBON_CLOUD_URL = "https://mes.carbon.ms"`. `probeOrder(url)` → `["https", "http"]` candidates when the input had no scheme. Tests: `carbon.acme.com` → `https://mes.carbon.acme.com`; `http://192.168.1.100:3001/x/anything` → `http://192.168.1.100:3001`; the QR URL → the decoded server; `mes.carbon.ms` → `https://mes.mes.carbon.ms`? No — a host that already starts with `mes.` is used as `https://<host>`; add that rule and its test.
4. `store.ts`: SecureStore, JSON per instance under `instance:<id>` (SecureStore caps a value at 2 KB; one instance fits), an index under `instances:index`, the current id under `instances:current`. `addInstance`, `removeInstance` (also drops that instance's session, context and outbox keys — Task 19/43 register cleaners), `setCurrentInstance`, `listInstances`. `InstanceProvider` exposes `{ instances, current, switchTo, add, remove }`; switching resets the `QueryClient` (`queryClient.clear()`) so nothing from one instance is shown under another.
5. `connect.tsx`: three ways in — scanner (`CameraView` full-width, 300 pt tall), a text field + "Connect", a "Carbon Cloud" button. Nothing is fetched here: the address is validated with `resolveServerAddress` and saved; the sign-in screen does the first request. Over `http` the instance is flagged `scheme: "http"`.
6. `instances.tsx`: list (hostname + name when known + "Current"), switch, add, remove with confirmation (`AlertDialog`).
7. `_layout.tsx`: `Linking.useURL()`; a `carbon-mes://link` URL adds the instance and routes to sign-in. (Only testable in a development build — Expo Go owns `exp://`; the in-app scanner is the Expo Go path.)

**Verify:**
```bash
pnpm --filter mobile test && pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: resolve.test.ts passes (5 cases); successful; "Exported: .expo-export"
```
Device check: scan the Task 17 QR → the instance appears with hostname `localhost`; remove it; type `http://192.168.1.100:3001` → appears with an "insecure connection" tag; "Carbon Cloud" adds `mes.carbon.ms`.

**Out of scope:** any network call (Task 19).

## Task 19: App — API client, session storage, sign-in / verify / two-factor / password screens

**Depends on:** Task 13, Task 14, Task 18
**Files:**
- Create: `apps/mobile/src/lib/api/client.ts`, `apps/mobile/src/lib/api/errors.ts`, `apps/mobile/src/lib/api/errors.test.ts`, `apps/mobile/src/lib/auth/LargeSecureStore.ts`, `apps/mobile/src/lib/auth/supabase.ts`, `apps/mobile/src/lib/auth/session.ts`, `apps/mobile/src/lib/auth/AuthProvider.tsx`
- Modify: `apps/mobile/src/app/(auth)/sign-in.tsx`, `(auth)/verify.tsx`, `(auth)/two-factor.tsx`, `(auth)/password.tsx`, `apps/mobile/src/app/(app)/_layout.tsx` (guard: instance + session + `/me` loaded, else redirect), `apps/mobile/src/app/index.tsx`
- Copy from (precedent): Supabase's Expo guide `LargeSecureStore` (AES-256 key in SecureStore, ciphertext in AsyncStorage; `aes-js`, `react-native-get-random-values`, `@react-native-async-storage/async-storage`, `expo-secure-store`) and its `createClient` options `{ auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } }`; the 401 handling table in the spec's API section.

**Steps:**
1. Install: `pnpm --filter mobile exec expo install @react-native-async-storage/async-storage expo-constants expo-application` and `pnpm --filter mobile add @supabase/supabase-js@catalog: aes-js react-native-get-random-values` + `-D @types/aes-js` (record in `catalogs.mobile`).
2. `errors.ts` (pure): `ApiClientError { status, code, message, fields?, details? }`; `mapResponse(status, body, headers)` → `ApiClientError` or `"server_too_old"` when `status === 404` on `auth/code` or when the `carbon-api` header lists no `"1"`; `isRetrySameKey(err)` → true for network errors, timeouts, 503 `retry_later`, 409 `request_in_progress` (used by Task 43). Tests for each branch.
3. `client.ts`: `createApiClient({ instance, getSession, onTokenExpired })` → `request<T>(path, { method, body, headers, schema })`: base `${instance.serverUrl}/api/v1`; headers `authorization`, `x-carbon-company`, `x-carbon-location`, `x-carbon-app-version` (`Constants.expoConfig?.version`), `x-carbon-operator` when set (Task 44); JSON body; 15 s timeout (`AbortController`); on 401 `token_expired` → `supabase.auth.refreshSession()` once, retry once; parse with the given zod `schema` (`@carbon/mes-core/contract`); throws `ApiClientError`. Public requests (`auth/*`) skip the auth headers.
4. `session.ts`: tokens per instance in `LargeSecureStore` (key `session:<instanceId>`); `supabase.ts`: `createSupabaseForInstance(me.instance)` with the guide's options and the `AppState` listener (`startAutoRefresh` on active, `stopAutoRefresh` otherwise); the client is created only after `/me` answered.
5. `AuthProvider`: state machine `no_instance → signed_out → code_sent → mfa_required → ready`; `requestCode(email)`, `verifyCode(email, code)`, `verifyMfa(code)`, `signInWithPassword(email, password)` (only when `auth/code` answered `method: "password"`), `loadMe()`, `signOut()` (blocked while outbox rows are queued — Task 43 hooks in). `/me` is validated with `meResponse` and stored on the instance (`details`).
6. Screens: `sign-in.tsx` shows the hostname and the http warning (red text + icon) at the top, an email field (`keyboardType="email-address"`, `autoCapitalize="none"`), "Send code"; `verify.tsx` a 6-digit input (`inputMode="numeric"`, `maxLength={6}`, `autoComplete="one-time-code"`), "Resend code"; `two-factor.tsx` the same input for TOTP; `password.tsx` only when `method === "password"`. Errors from the table in the spec (`sso_required` → "SSO sign-in is coming in an update", `locked` → retry time, `server_too_old` → "This Carbon server needs an update", 426 → the update screen).
7. `(app)/_layout.tsx`: `useAuth().state !== "ready"` → `<Redirect href="/(auth)/sign-in" />`; no instance → `/(setup)/connect`.

**Verify:**
```bash
pnpm --filter mobile test && pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: errors.test.ts passes (6 cases); successful; "Exported: .expo-export"
```
Device check (Device test loop, iPhone + Android): link `http://<LAN-IP>:3001` → sign in with the bypass email (`DEV_BYPASS_EMAIL` from `.env.local`, any 6 digits) and with a real seeded user through the dev mailbox code → lands on the context screen; link `http://<LAN-IP>:3000` (ERP, no mobile API) → "This Carbon server needs an update".

**Out of scope:** the outbox (Task 43), operator tokens (Task 44).

## Task 20: App — context picker, Operations list, Phase 1 parity check

**Depends on:** Task 15, Task 19
**Files:**
- Create: `apps/mobile/src/features/operations/useOperationsQuery.ts`, `apps/mobile/src/features/operations/useRealtimeRefetch.ts`, `apps/mobile/src/features/operations/OperationCard.tsx`, `apps/mobile/src/lib/context/ContextProvider.tsx`
- Modify: `apps/mobile/src/app/(app)/context.tsx`, `apps/mobile/src/app/(app)/(tabs)/operations/index.tsx`, `packages/utils/package.json` (`exports` gains `"./format": "./src/format.ts"`, `"./date": "./src/date.ts"`, `"./datetime": "./src/datetime.ts"`, `"./status": "./src/status.ts"` — additive, next to `./status-colors`)
- Copy from (precedent): `apps/mes/app/components/OperationsList.tsx` (card fields: `itemReadableId`, `itemDescription`, `targetQuantity ?? operationQuantity`, `jobReadableId`, `operationStatus` via `OperationStatusIcon`, due date; lines 111–163); `apps/mes/app/hooks/useRealtime.tsx` (channel filter `companyId=eq.<id>`); `statusColor("jobOperation", status)` from `@carbon/utils/status-colors`.

**Steps:**
1. `ContextProvider`: company (from `/me`), location (default `defaultLocationId`), work centers (multi-select, default all of the location); persisted in SecureStore under `context:<instanceId>:<companyId>`; exposes `scope: { instanceId, companyId }`, `locationId`, `workCenterIds`. `context.tsx` is the picker screen (RNR `Select` for company and location, checkbox list for work centers, "Continue").
2. `useOperationsQuery`: `useQuery({ queryKey: keys.operations(scope, locationId, workCenterIds), queryFn: () => api.request("/operations?workCenterIds=…", { schema: operationsScreen }), refetchInterval: 30_000 })` + `useFocusEffect` refetch. `useRealtimeRefetch(table, filter, keys)`: `supabase.channel(…).on("postgres_changes", { event: "*", schema: "public", table, filter }, () => queryClient.invalidateQueries({ queryKey }))` for `jobOperation` and `productionEvent` with `companyId=eq.<companyId>`.
3. `OperationCard`: `Card` with item id (bold), description, big quantity (`text-3xl`, `formatQuantity` from `@carbon/utils/format` — "12 of 40" uses the quantity kind), job id, status icon + text coloured by `statusColor`, due (`formatDate` from `@carbon/utils/date` in the company time zone). 44 pt minimum tap height; whole card is the press target → `operations/[id]`.
4. `operations/index.tsx`: header "Operations · <location>", work-center chips, `FlatList` of cards (`numColumns` 1 on phones, 2 on tablets ≥ 768 pt width via `useWindowDimensions`), skeletons while loading, empty state "No operations at <work center>" only when the query settled empty, pull-to-refresh.
5. Import only `@carbon/utils/<subpath>` and `@carbon/utils/status-colors` in the app — never the barrel (it drags tiptap and dompurify into the bundle).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile --filter=@carbon/utils --filter=erp --filter=mes && pnpm --filter mobile run export:check 2>&1 | tail -1 && pnpm run lingui:check 2>&1 | tail -1
# Expected: 4 successful; "Exported: .expo-export"; lingui ok
grep -c "@carbon/utils\"" apps/mobile/src -r
# Expected: 0 (no barrel imports)
```
Device check (the Phase 1 "done when"): iPad landscape and Android phone, same location and work centers as web MES at `/x/operations` → same number of cards, same first card (item id, quantity, status); start a timer on web → the card's status changes on the devices within a few seconds (realtime) without a manual refresh. Attach screenshots (web + both devices) to the PR. Stop-point: open the `feat/mobile-spike` PR; raise the claims-cache decision (Task 11) in its description.

**Out of scope:** operation detail (Phase 3), filters beyond work centers.

---

# Phase 2 — MES API (branch `feat/mes-api`, 2–3 weeks)

Done when: every web route in the Commands and Screen-reads tables calls extracted code, every endpoint has a test, and a manual web pass of start, complete, scrap, issue, finish, picking and print shows no behaviour change.

Rules for this phase (they come from the spec's Risks and `.ai/lessons.md`):
- Move a route body **without edits**, one route per commit, then rerun that flow on web before adding its API route.
- Behaviour that must survive the move: the floor gate runs before the timer reopens in the scan-start command; the scan-complete command stays ungated; ending a batch-tagged event skips `post-production-event`; auto-print after a completion never blocks the operation; scrap stays one `issue` `jobOperationScrap` invoke; the picking-list policies (`incompletePickingListPolicy`) stay server-side.
- Every extracted function takes `companyId`, the effective `userId`, `sessionUserId` and, where the web read it from `userContext`, `locationId` as arguments. Nothing in `commands.server.ts` or `screens.server.ts` reads `request`, cookies or `userContext`.
- `edge functions` are called exactly as today (same names, same payloads, same client — service role where the web uses it).

## Task 21: Re-check the routes to move; JSON schemas in `@carbon/mes-core/models`

**Depends on:** Task 20 merged
**Files:**
- Create: `packages/mes-core/src/models.ts`, `packages/mes-core/src/models.test.ts`, `packages/mes-core/src/queries.ts`
- Modify: `packages/mes-core/package.json` (`exports` gains `./models`, `./queries`), `packages/mes-core/src/index.ts`, `apps/mes/app/services/models.ts` (re-export the JSON schemas with `@deprecated` JSDoc pointing web code at `@carbon/mes-core/models`; the existing zfd validators stay untouched)
- Copy from (precedent): `apps/mes/app/services/models.ts` — `productionEventValidator` (L172), `finishValidator` (L200), `issueTrackedEntityValidator` (L207, already plain `z`), `baseQuantityValidator` (L232), `scrapQuantityValidator` (L241), `issueValidator` (L146), `stepRecordValidator` (L116), `pickQuantityValidator` (L71); raw form fields read by `x+/quality-issue.new.tsx` (`getRequiredFormValue`/`getOptionalFormValue`), `x+/picking.$pickingListId.tracked.$lineId.tsx` (`trackedEntityId`, `fromStorageUnitId`, `quantity`, `unpick`), `x+/picking.$pickingListId.status.tsx` (`status`, `acknowledged`); `manualPrintValidator` from `@carbon/printing`.

**Steps:**
1. Re-check: run `git log --since=2026-10-02 --oneline -- apps/mes/app/routes/x+ apps/mes/app/services/models.ts` and read any changed file among the 27 routes in the inventory before moving it. If a route's action shape changed, update the task that moves it before starting it.
2. `models.ts` — JSON schemas (plain `z`, numbers are `z.number()`, booleans `z.boolean()`, every optional field `.optional()`):
   `startEventBody { jobOperationId, type: z.enum(["Setup","Labor","Machine"]), workCenterId?, trackedEntityId?, unitIndex?: number, exclusive?: boolean, viaScan?: boolean }`; `endEventBody {}`; `completeFromScanBody { trackedEntityId?, acknowledged?: boolean }`; `quantityBody { jobOperationId, quantity: positive number, trackedEntityId?, trackingType?: z.enum(["Serial","Batch",""]), notes?, setupProductionEventId?, laborProductionEventId?, machineProductionEventId? }`; `scrapBody = quantityBody.extend({ scrapReasonId })`; `reworkBody = quantityBody`; `finishBody { jobOperationId, setup/labor/machineProductionEventId? }`; `issueMaterialBody { itemId, jobOperationId, materialId?, jobOperationStepId?, quantity: number, adjustmentType: z.enum(["Set Quantity","Positive Adjmt.","Negative Adjmt."]), acknowledged?: boolean }`; `issueTrackedBody` = the fields of `issueTrackedEntityValidator`; `unconsumeBody = issueTrackedBody.extend({ acknowledged?: boolean })`; `stepRecordBody { index: number, jobOperationStepId, value?, numericValue?: number, booleanValue?: boolean, userValue? }`; `noteBody { note: z.string().min(1) }`; `qualityIssueBody { jobOperationId, trackedEntityId?, name, nonConformanceTypeId, priority, quantity?: number }` (the exact field set `quality-issue.new.tsx` reads — copy its list); `printBody` = the shape of `manualPrintValidator` (copied; a test imports `@carbon/printing` as a devDependency to assert `z.infer` parity); `pickQuantityBody { quantity: z.number().min(0), markShort?: boolean }`; `pickTrackedBody { trackedEntityId, fromStorageUnitId?, quantity: number, unpick?: boolean }`; `pickingListStatusBody { status: z.enum(pickingListStatus), acknowledged?: boolean }`; `clockOutBody { note? }`; `pinInBody { userId, pin: z.string().regex(/^\d{4,8}$/) }`.
3. `models.test.ts`: for each JSON schema that mirrors a web zfd validator, `expectTypeOf<z.output<typeof jsonSchema>>().toMatchTypeOf<z.output<typeof webValidator>>()` (import the web validator from `apps/mes/app/services/models.ts` via a relative path in the test only) — this pins that a command written for the JSON shape accepts what the web route parses. Plus one parse/reject case per schema.
4. `queries.ts` — lookups the app runs directly as the signed-in user, `(client, args) => client.from(...)…` and always `.eq("companyId", companyId)`: `getItemByReadableId(client, { companyId, readableId })`, `getTrackedEntityByReadableId`, `getWorkCentersByLocation(client, { companyId, locationId })`, `getScrapReasons`, `getQualityIssueTypes`, `getEmployeesForPinIn(client, { companyId })` (the `employees` view: id, name, avatarUrl, active), `getJobOperationNotes(client, { companyId, jobOperationId })`. Column lists copied from the MES routes/components that read the same tables today.

**Verify:**
```bash
pnpm --filter @carbon/mes-core test && pnpm exec turbo run typecheck --filter=@carbon/mes-core --filter=mes
# Expected: models.test.ts passes (type parity + parse cases); 2 successful
```

**Out of scope:** changing any web validator.

## Task 22: Idempotency keys and request plumbing for every POST

**Depends on:** Task 21
**Files:**
- Create: `apps/mes/app/routes/api+/v1+/lib/idempotency.server.ts`, `apps/mes/app/routes/api+/v1+/lib/idempotency.test.ts`
- Modify: `apps/mes/app/routes/api+/v1+/lib/route.server.ts` — `apiRoute` gains `idempotent: true` (default for every POST that is not `public`).
- Copy from (precedent): `AccountLockout.recordFailure` in `packages/kv/src/lockout/lockout.ts` (`redis.set(key, "1", "EX", n, "NX")`); the `withResilience` fail-soft contract in `packages/kv/src/resilient.ts` (a `null` can mean "exists" or "Redis down").

**Steps:**
1. `idempotency.server.ts`:
   ```ts
   export function fingerprint(method: string, path: string, body: string): string   // sha256 hex via node:crypto
   export function idempotencyKey(companyId: string, sessionUserId: string, key: string): string   // "@carbon/mes-api:idem:<companyId>:<sessionUserId>:<key>"
   export async function withIdempotency(redisClient, { companyId, sessionUserId, key, fp }, run: () => Promise<Response>): Promise<Response>
   ```
   Algorithm: `redisClient.status !== "ready"` → `ApiError(503, "retry_later")` before anything runs. `SET k {"state":"in_progress","fp"} EX 300 NX` → `"OK"` → run → store `{"state":"done","fp","status","headers":{"content-type"},"body"} EX 86400` (a 5xx is stored too — a retry must not re-run a command that may have partly applied) → return. `null` → `GET k`: `null` → 503 `retry_later` (Redis went away); `in_progress` → 409 `request_in_progress`; `done` with a different `fp` → 422 `idempotency_key_reused`; `done` with the same `fp` → replay stored status + body with header `idempotent-replayed: true`.
2. `apiRoute`: for `method: "POST"` and not `public`, require `idempotency-key` (1–128 chars) → missing → 400 `idempotency_key_required`; wrap the handler in `withIdempotency` using `user.companyId`, `user.sessionUserId`, the raw body text (read once, reused for zod).
3. Tests with an in-memory fake (`{ status: "ready", set, get }` over a `Map`): first call runs once; same key + same body → replay, run count stays 1; same key + different body → 422; `status: "connecting"` → 503 and run count 0; in-progress marker → 409; a stored 500 is replayed as 500.

**Verify:**
```bash
pnpm --filter mes test 2>&1 | tail -3
# Expected: idempotency.test.ts passes (6 tests)
```
Manual (after Task 24): two identical `POST /operations/:id/events` with the same `Idempotency-Key` → one `productionEvent` row, second response has `idempotent-replayed: true`.

**Out of scope:** per-endpoint tuning of the 24 h window.

## Task 23: Terminal and operator tokens; `/console/*` endpoints

**Depends on:** Task 22
**Files:**
- Create: `packages/auth/src/services/console-token.server.ts`, `packages/auth/src/services/console-token.server.test.ts`, `apps/mes/app/services/console.server.ts`, `apps/mes/app/routes/api+/v1+/console.terminal.ts`, `apps/mes/app/routes/api+/v1+/console.pin-in.ts`, `apps/mes/app/routes/api+/v1+/console.pin-out.ts`, tests for the three routes
- Modify: `packages/auth/src/services/console-pin.server.ts` — export `StoredConsolePinIn`, `consolePinMaxAgeMs`, and extract the DB re-validation out of `loadConsolePinIn` into an exported `revalidateConsolePinIn(stored: StoredConsolePinIn): Promise<boolean>` (active employee of the company + `companySettings.consoleEnabled`) that both the cookie path and the token path call; `packages/auth/package.json` exports (`./console-token.server`); `apps/mes/app/routes/x+/console.pin-in.tsx` — its action calls `pinInOperator` from `~/services/console.server` and then `setConsolePinIn` as today; `apps/mes/app/routes/api+/v1+/lib/route.server.ts` — pass `deps.operator` (verify + revalidate, with `isConsoleModeEnabledForCompany` from `@carbon/ee/console.server` for the entitlement check the web does in `userMiddleware`) into `requireApiUser`, and when `user.consoleMode` set the response header `x-carbon-operator` to a re-signed token with `pinnedAt: Date.now()`.
- Copy from (precedent): `packages/auth/src/lib/download-token.server.ts` (`SignJWT` HS256 over `SESSION_SECRET`, `jwtVerify`); `x+/console.pin-in.tsx` action steps 1–5 (terminal `Ratelimit.slidingWindow(30, "15 m")` prefix `@carbon/console-pin:terminal`, `AccountLockout` prefix `@carbon/console-pin` maxAttempts 5 window "15 m", `verifyEmployeePin(getDatabaseClient(), …)`, `logAuthEvent` events, refunds); `x+/console.toggle.tsx` (`requirePermissions(request, { update: "settings" })` + `isConsoleModeEnabledForCompany`).

**Steps:**
1. `console-token.server.ts`: `signTerminalToken({ companyId, sessionUserId })` → JWT `{ kind: "terminal", companyId, sessionUserId, iat }` with no `exp` (it only authorises PIN attempts, which are rate-limited and still need a valid PIN; console mode is re-checked on every use); `verifyTerminalToken(token)` → payload or null. `signOperatorToken(stored: StoredConsolePinIn)` → JWT `{ kind: "operator", ...stored }` with `exp = (stored.pinnedAt + consolePinMaxAgeMs()) / 1000`; `verifyOperatorToken(token)` → `StoredConsolePinIn` or null (signature, `kind`, `exp`). Tests: round-trip, tampered signature → null, expired → null, a terminal token is rejected by `verifyOperatorToken`.
2. `apps/mes/app/services/console.server.ts`: `pinInOperator({ companyId, sessionUserId, userId, pin, db }): Promise<{ ok: true; operator: ConsolePinIn } | { ok: false; status: 400 | 403 | 429; code: "rate_limited" | "locked" | "invalid_pin" | "forbidden"; message: string }>` — the web action's steps 2–5 moved verbatim (terminal rate limit, employee lookup + refund, lockout, `verifyEmployeePin`, resets/refunds, `logAuthEvent`). The web route keeps step 1 (`consoleMode && consoleEnabled` from `userContext`) and `setConsolePinIn`.
3. `console.terminal.ts` (`apiRoute({ method: "POST", permissions: { update: "settings" } })`): `isConsoleModeEnabledForCompany(client, companyId) !== true` → 403 `forbidden` "Console mode is not enabled for this company"; return `{ terminalToken }`. Not idempotency-keyed (no business row; opt out with `idempotent: false`).
4. `console.pin-in.ts`: Bearer user token + `x-carbon-terminal`; `verifyTerminalToken` → binding must equal `{ companyId: user.companyId, sessionUserId: user.userId }` else 403; `isConsoleModeEnabledForCompany` must be true; `pinInOperator(...)` → failure → its status/code; success → `{ operatorToken: signOperatorToken({ ...operator, companyId, sessionUserId }), operator: { userId, name, avatarUrl } }`. `console.pin-out.ts`: requires the operator header; returns `{ ok: true }` (the app drops the token; nothing is stored server-side).
5. `requireApiUser` operator path (Task 11 step g) is now live: `deps.operator.verify = verifyOperatorToken`, `deps.operator.revalidate = async (s) => (await revalidateConsolePinIn(s)) && (await isConsoleModeEnabledForCompany(getCarbonServiceRole(), s.companyId)) === true`; expiry → 401 `operator_expired`. Commands run as `userId = operator`; reads (`screens.server.ts`) keep running as the terminal user — same as web.

**Verify:**
```bash
pnpm --filter @carbon/auth test 2>&1 | tail -3 && pnpm --filter mes test 2>&1 | tail -3 && pnpm exec turbo run typecheck --filter=@carbon/auth --filter=mes
# Expected: console-token tests pass (4); the three route tests pass; typecheck successful
```
Manual (web): console mode toggle, pin-in with a right and a wrong PIN, five wrong PINs → locked message — identical to before. Stop-point: security review of this task before Tasks 24–31 expose commands.

**Out of scope:** the app's PIN screen (Task 44).

## Task 24: Commands — time events (`event.tsx`, `start.$operationId.tsx`, `end.$operationId.tsx`)

**Depends on:** Task 23
**Files:**
- Create: `apps/mes/app/services/commands.server.ts` (with `CommandResult`, `CommandFailure`, and the helper `failureToResponse(failure): Response` for the API — 400/403/404/409/409/409/409/500 by `kind`), `apps/mes/app/routes/api+/v1+/operations.$id.events.ts`, `apps/mes/app/routes/api+/v1+/events.$id.end.ts`, `apps/mes/app/routes/api+/v1+/operations.$id.end.ts`, one test per route
- Modify: `apps/mes/app/routes/x+/event.tsx`, `apps/mes/app/routes/x+/start.$operationId.tsx`, `apps/mes/app/routes/x+/end.$operationId.tsx`; the `WorkSource` union (`grep -rn "type WorkSource" packages apps --include='*.ts'`) gains `"mes_mobile"`.
- Copy from (precedent): the three route bodies (inventory rows 7, 8, 9).

**Steps:**
1. `startEvent(client, { companyId, userId, body: StartEventBody & { workCenterId? }, source })` and `endEvent(client, { companyId, userId, eventId, exclusive })` from `event.tsx`: the Start branch (eligibility via `getOperationEligibility(serviceRole, …)`, `startProductionEvent(client, …)`, `post-production-event` per ended event when `exclusive`) and the End branch (`endProductionEvent`, `post-production-event` unless `jobOperationBatchId` is set). The route parses `productionEventValidator`, calls the matching command, and maps `{ ok: false }` to its current `data({}, flash(error(...)))` / `validationError` responses.
2. `startOperationFromScan(serviceRole, { companyId, userId, operationId, type, trackedEntityId, acknowledged, source: "mes_mobile" })` from `start.$operationId.tsx`: the floor gate (`jobOperationBatch`/`job` status), `getWorkCenterWithBlockingStatus`, the `operationStart` rules, serial selection, `startProductionEvent(SR, …, "mes_qr")` → `source` argument. Failures become `{ kind: "redirect", redirectTo: path.to.operations | path.to.operation(id), message }`; the loader throws the same redirects as today from them. `completeOperationFromScan(serviceRole, { companyId, userId, operationId, trackedEntityId, acknowledged })` from `end.$operationId.tsx` likewise (`insertProductionQuantity(SR, …)`, `finishJobOperation`, `operationFinish` rules when `willBeFinished`).
3. API: `operations.$id.events.ts` → body `startEventBody`; `viaScan ? startOperationFromScan : startEvent`; `events.$id.end.ts` → `endEvent`; `operations.$id.end.ts` → `completeOperationFromScan`. Pass `source: "mes_mobile"`. A redirect-kind failure becomes 409 `conflict` carrying the message (the floor gate) or 403 `blocked` when the message came from a rule.
4. Tests: route → command argument mapping, failure → status mapping, idempotency header required.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes test 2>&1 | tail -3
# Expected: successful; the three route tests pass
```
Web (`/test`, closed loop per lesson): Start/Stop button on an operation (Setup, Labor, Machine), the start QR URL (`/x/start/:id`), the kanban end URL (`/x/end/:id`) — rows in `productionEvent` as before. API: `POST /operations/:id/events` with `{ type: "Labor", jobOperationId }` → a `productionEvent` row with `createdBy` = the operator; the same call for an operation on an unreleased job with `viaScan: true` → 409 with the web's floor-gate message.

**Out of scope:** the app's dock (Task 35).

## Task 25: Commands — quantities (`complete.tsx`, `scrap.tsx`, `rework.tsx`, `finish.tsx`)

**Depends on:** Task 23 (independent of Task 24)
**Files:**
- Modify: `apps/mes/app/services/commands.server.ts` (+ `reportQuantity`, `reportScrap`, `reportRework`, `finishOperation`), the four web routes
- Create: `apps/mes/app/routes/api+/v1+/operations.$id.quantities.ts`, `operations.$id.scrap.ts`, `operations.$id.rework.ts`, `operations.$id.finish.ts`, tests
- Copy from (precedent): inventory rows 10–13 (`complete.tsx` incl. `autoPrintFirstOperationLabel` L29–88, `scrap.tsx`, `rework.tsx`, `finish.tsx`).

**Steps:**
1. `reportQuantity(ctx, body: QuantityBody)` = `complete.tsx` after validation: serial/batch/untracked branches (`issue` invokes `jobOperationSerialComplete` / `jobOperationBatchComplete` / `jobOperation`), `insertProductionQuantity(client)` for untracked, `finishJobOperation(SR)` when finished, `autoPrintFirstOperationLabel` inside try/catch (never blocks). Returns `{ completed, finished, data }` so the route can keep its four distinct responses (`data({ completed: true })`, `redirect(path.to.operation(id))`, `data(insertProduction.data)`, `redirect(path.to.operations)`).
2. `reportScrap(ctx, body: ScrapBody)` = one `issue` `jobOperationScrap` invoke via `getCarbonServiceRole()` (`trackedEntityId` only for Serial); returns `{ scrapped: true, newTrackedEntityId }`. `reportRework` = `insertReworkQuantity(client)`. `finishOperation` = `finishJobOperation(SR, { ...body, userId, companyId })`.
3. API routes map: success → `{ ok: true, ...data }`; failures → `failureToResponse`.
4. Web routes: parse with their zfd validators, call the command, keep every response and flash exactly as today.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes test 2>&1 | tail -3
# Expected: successful; four route tests pass
```
Parity check (acceptance criterion): two seeded jobs on the same item; on job A via web MES and job B via the API: start labor, pause, report 10 good and 2 scrap, finish. Then:
```sql
select "type","quantity","jobOperationId" is not null as op from "productionQuantity" where "jobOperationId" in (:a, :b) order by 1,2;
select "entryType","documentType","quantity" from "itemLedger" where "documentId" in (:jobA, :jobB) order by 1,2,3;
```
Expected: identical multisets for A and B (backflushed materials and the cost posting included).

**Out of scope:** batch completion (`batch.$batchId.complete.tsx` stays web-only in v1).

## Task 26: Commands — materials (`issue.tsx`, `issue-tracked-entity.tsx`, `unconsume.tsx`)

**Depends on:** Task 23
**Files:**
- Modify: `commands.server.ts` (+ `issueMaterial`, `issueTrackedEntities`, `unconsumeTrackedEntities`), the three web routes
- Create: `operations.$id.materials.issue.ts`, `operations.$id.materials.issue-tracked.ts`, `operations.$id.materials.unconsume.ts`, tests
- Copy from (precedent): inventory rows 14–16 (`materialIssue` / `materialReceive` rules via `evaluateLinesForSurface` + `isBlocked` from `@carbon/ee/rules.server`; `issue` edge-function types `partToOperation`, `trackedEntitiesToOperation` / `trackedEntitiesToBatch`, `unconsumeTrackedEntities`).

**Steps:**
1. Each command returns `{ ok: true, data }` or a failure: rules → `{ kind: "blocked", message, details: { violations, ruleNames } }`; the 400/404 branches of the tracked routes → `validation`/`not_found`. The web routes keep `throw redirect(requestReferrer(request) ?? path.to.operations)` (`issue.tsx`) and the JSON `{ success, message, splitEntities, warning }` shapes (`issue-tracked-entity.tsx`, `unconsume.tsx`) exactly.
2. API: `issue` → body `issueMaterialBody`; `issue-tracked` → `issueTrackedBody`; `unconsume` → `unconsumeBody`; `blocked` → 409 with `details`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes test 2>&1 | tail -3
# Expected: successful; the three materials route tests pass
```
Manual: Web: issue an untracked part, a tracked entity and undo it from the Materials section (ledger rows as before); API: the same three calls produce the same `issue` invocations (compare `itemLedger` rows for two operations).

**Out of scope:** scrap of a BOM entity (`x+/entity+/…scrap.tsx` stays web-only in v1).

## Task 27: Commands — step records and notes

**Depends on:** Task 23
**Files:**
- Modify: `commands.server.ts` (+ `recordStep`, `deleteStepRecord`, `addOperationNote`), `x+/record.tsx`, `x+/record.$id.delete.tsx`
- Create: `operations.$id.step-records.ts`, `step-records.$id.delete.ts`, `operations.$id.notes.ts`, tests
- Copy from (precedent): inventory rows 17–18 (`insertAttributeRecord(SR)`, `backflushUntrackedMaterialsOnStepRecord(SR)` — failure logged, never blocks; `deleteAttributeRecord(SR, { id, companyId, userId })`); `apps/mes/app/components/JobOperation/components/Chat.tsx` L140–158 (the `jobOperationNote` row shape: `id: nanoid()`, `jobOperationId`, `createdBy`, `note`, `createdAt`, `companyId`) and its `notify()` call — read what `notify` posts and perform the same server-side.

**Steps:**
1. `recordStep(ctx, body: StepRecordBody)` and `deleteStepRecord(ctx, { id })` moved verbatim. `addOperationNote(client, { companyId, userId, jobOperationId, note })`: insert the `jobOperationNote` row as `Chat.tsx` does (service role; `createdBy` = the operator), then the same notification `Chat.tsx`'s `notify()` triggers. Web `Chat.tsx` is unchanged (it keeps inserting from the browser); the API path exists so a shared tablet attributes the note to the pinned operator.
2. API: `step-records` (POST, `stepRecordBody`), `step-records/:id/delete` (POST), `notes` (POST, `noteBody`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes test 2>&1 | tail -3
# Expected: successful; the three step-record/notes route tests pass
```
Manual: Web: record a Task step and delete the record — rows as before; API: `POST …/notes` → a `jobOperationNote` row visible in web MES's Chat tab.

**Out of scope:** notes GET (the app reads notes directly via `getJobOperationNotes` + realtime).

## Task 28: Commands — quality issue and print

**Depends on:** Task 23
**Files:**
- Modify: `commands.server.ts` (+ `raiseQualityIssue`, `printLabel`), `x+/quality-issue.new.tsx`, `x+/print.tsx`
- Create: `quality-issues.ts`, `print.ts`, tests
- Copy from (precedent): inventory rows 19–20 (`createQualityIssue(SR, {...})` from `~/services/quality.server`; `trigger("print-job", { sourceDocument, sourceDocumentId, companyId, userId, locationId, workCenterId, printerRouteId })` from `@carbon/jobs`).

**Steps:**
1. `raiseQualityIssue(ctx, body: QualityIssueBody)` = `createQualityIssue(getCarbonServiceRole(), { companyId, userId, ...body })`; the API route uses `permissions: { create: "quality" }` (the web's `requirePermissions(request, { create: "quality" })`). `printLabel(ctx, body: PrintBody & { locationId })` = the `trigger` call; `locationId` from `x-carbon-location`.
2. Web: `quality-issue.new.tsx` keeps its raw-FormData reading and its `success(...)` / redirect responses; `print.tsx` keeps `manualPrintValidator.safeParse` and `{ success, message }`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes test 2>&1 | tail -3
# Expected: successful; the two route tests pass
```
Manual: Web: raise a quality issue and print a label; API: `POST /quality-issues` → an issue row with `createdBy` = operator; `POST /print` → a `print-job` Inngest event with the same payload as web's Print button (compare in the Inngest dev UI, `crbn status` → Inngest URL).

**Out of scope:** printer configuration UI.

## Task 29: Commands — picking

**Depends on:** Task 23
**Files:**
- Modify: `commands.server.ts` (+ `pickQuantity`, `pickTrackedEntity`, `setPickingListStatus`), `x+/picking.$pickingListId.line.quantity.tsx`, `x+/picking.$pickingListId.tracked.$lineId.tsx` (action only), `x+/picking.$pickingListId.status.tsx`
- Create: `picking.$listId.lines.$lineId.quantity.ts`, `picking.$listId.lines.$lineId.tracked.ts`, `picking.$listId.status.ts`, tests
- Copy from (precedent): inventory rows 21–23 (`setPickingListLineQuantity(SR, …)`, `setPickingListLineTrackedEntity(SR, …)`, `getUnresolvedPickingListLines` + `updatePickingListStatus` + `trackWorkEvent`; results `{ success, data }`, `{ success: false, message }`, `{ success: false, blocked: true, unresolvedLines, message }`, `{ success: false, needsAcknowledgement: true, unresolvedLines }`).

**Steps:**
1. The three commands return the same four outcome shapes as `CommandResult`: `blocked` → `{ kind: "blocked", message, details: { unresolvedLines } }`; needs acknowledgement → `{ kind: "needs_acknowledgement", details: { unresolvedLines } }`. `userId` is the effective user (web: `userContext.effectiveUserId ?? userId`; API: the operator).
2. API: `quantity` (`pickQuantityBody`), `tracked` (`pickTrackedBody`), `status` (`pickingListStatusBody`); 409 for `blocked` / `needs_acknowledgement` with `details`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes test 2>&1 | tail -3
# Expected: successful; the three picking route tests pass
```
Manual: Web: pick a quantity, pick a tracked entity, complete a list; API acceptance: on a company with `incompletePickingListPolicy = error`, completing an incomplete list → 409 `blocked` with web's message.

**Out of scope:** reopening a list (ERP-only).

## Task 30: Commands — timecard

**Depends on:** Task 23
**Files:**
- Modify: `commands.server.ts` (+ `clockInCommand`, `clockOutCommand`, `endShift`), `apps/mes/app/routes/api+/timecard.ts`, `x+/end-shift.tsx`
- Create: `timecard.clock-in.ts`, `timecard.clock-out.ts`, `timecard.end-shift.ts`, tests
- Copy from (precedent): `api+/timecard.ts` (`clockIn(client, { employeeId, companyId, createdBy })`, `clockOut(client, { employeeId, companyId, updatedBy, note })`), inventory row 24 (`endProductionEvents(client, …)`, `companySettings.timeCardEnabled` → `timeCardEntry` clock-out, `clearConsolePinIn` when `consoleMode`).

**Steps:**
1. `endShift(ctx)` returns `{ endedConsole: boolean }`; the web route still returns the `clearConsolePinIn` cookie when `consoleMode`; the API route returns `{ ok: true, endedConsole }` and the app drops its operator token.
2. `api+/timecard.ts` (web) keeps its `intent` switch and calls the commands.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes test 2>&1 | tail -3
# Expected: successful; the three timecard route tests pass
```
Manual: Web: clock in/out from `TimeCardButton`, end shift from the user menu; API: the three calls produce the same `timeCardEntry` and `productionEvent` end rows as web for a second user.

**Out of scope:** editing/deleting time-card entries (`x+/timecard.tsx` action `updateEntry`/`deleteEntry` stay web-only in v1).

## Task 31: Screens — operation detail, rework targets, picking, tracked options, timecard

**Depends on:** Task 21
**Files:**
- Modify: `apps/mes/app/services/screens.server.ts` (+ `getOperationScreen`, `getReworkTargetsScreen`, `getPickingScreen`, `getPickingListScreen`, `getPickingLineTrackedOptions`, `getTimecardScreen`), `packages/mes-core/src/contract.ts` (a `type` per screen, derived the same way as `OperationsScreen`), the five web loaders (`x+/operation.$operationId.tsx` L48–328, `x+/rework-targets.$operationId.tsx`, `x+/picking._index.tsx` L26–35, `x+/picking.$pickingListId.tsx` L78–94, `x+/picking.$pickingListId.tracked.$lineId.tsx` L24–86, `x+/timecard.tsx` L100–133)
- Create: `operations.$id._index.ts`, `operations.$id.rework-targets.ts`, `picking._index.ts`, `picking.$listId._index.ts`, `picking.$listId.lines.$lineId.tracked-options.ts`, `timecard._index.ts`, tests

**Steps:**
1. `getOperationScreen(serviceRole, { companyId, userId, operationId, trackedEntityId?, scope? })` returns the loader's object. The loader's `throw redirect(...)` cases (not found, unreleased batch or job, operation type → assembly/inspection, serial auto-select) become `{ ok: false, failure: { kind: "redirect", redirectTo, message } }`; the web loader throws the same redirects from them. The deferred promises (`files`, `materials`, `procedure`, `workCenter`, `nonConformanceActions`, `batchWorkInstructions`) stay promises in the web path; the API awaits them (`Promise.all`) before responding. A serial-tracked operation without `trackedEntityId` → the API returns the object with `trackedEntityId` = the first incomplete entity (what the web redirect selects) instead of redirecting.
2. The other five functions wrap their loaders' service calls; `picking` uses the effective user; `getPickingLineTrackedOptions` is the tracked route's loader body (`entities, trackingType, quantityRequired, nearExpiryWarningDays, expiredEntityPolicy, defaultOrder`); `getTimecardScreen` takes `weekOffset`.
3. API responses: 404 `not_found` for the `Response("…not found", 404)` cases; `redirect` failures → 409 `conflict` with the message (floor gate) or 404.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mes && pnpm --filter mes test 2>&1 | tail -3
# Expected: successful; the six screen route tests pass
```
Manual: Web: open an operation (serial and untracked), rework targets, picking list and detail, a tracked line, timecard — identical pages; API: `GET /operations/:id` for an unreleased job → 409 with the web's message.

**Out of scope:** batch-scope data for the app (web-only in v1; the API returns `batch: null` content as the web does for a completed batch and the same object for an active one — the app ignores batch fields).

## Task 32: API route tests and the web regression pass

**Depends on:** Tasks 24–31
**Files:**
- Create: any missing `*.test.ts` beside the routes so every file under `api+/v1+/` (except `lib/`) has one; `.ai/runs/<date>-mes-api-web-regression.md`

**Steps:**
1. Each test mocks `@carbon/auth/api-user.server` (`requireApiUser` → a fixed `ApiUser`) and the command/screen module, then asserts: 200 shape, `carbon-api: 1`, 405 on the wrong method, 400 on a bad body (`fields` present), the failure mapping (409/403/404), and the `idempotency-key` requirement on POSTs.
2. Web regression with `/test` (`/auth` first), as closed loops with DB checks after every action: start → pause → complete 10 → scrap 2 → issue a part → finish; picking: pick quantity → pick tracked → complete; print a label; console pin-in/out; clock in → end shift. Record the run.

**Verify:**
```bash
pnpm --filter mes test 2>&1 | tail -5
# Expected: every api+/v1+ route has a passing test file (count the files: ls apps/mes/app/routes/api+/v1+/*.test.ts | wc -l equals the number of route files)
ls apps/mes/app/routes/api+/v1+/*.ts | grep -v -E "test|lib" | wc -l; ls apps/mes/app/routes/api+/v1+/*.test.ts | wc -l
# Expected: equal numbers
```

**Out of scope:** load testing.

## Task 33: Docs — `.claude/rules/mes-mobile-api.md`, AGENTS.md rows, spec changelog

**Depends on:** Task 32
**Files:**
- Create: `.claude/rules/mes-mobile-api.md` (frontmatter `paths: ["apps/mes/app/routes/api+/v1+/**", "apps/mes/app/services/commands.server.ts", "apps/mes/app/services/screens.server.ts", "packages/mes-core/**", "packages/auth/src/services/api-user.server.ts", "packages/auth/src/services/console-token.server.ts"]`): the request/response contract, `apiRoute` order, idempotency algorithm, token design, the `CommandResult` mapping table, "additive-only `/api/v1`", and the gotchas found in this phase.
- Modify: `AGENTS.md` (root) Task Router: `| MES API (mobile) — commands, screens, tokens, idempotency | .claude/rules/mes-mobile-api.md + packages/mes-core/AGENTS.md |`; `packages/mes-core/AGENTS.md` (models/queries sections); `packages/auth/AGENTS.md` Key Exports; `.ai/specs/2026-09-30-mes-mobile-app.md` Changelog entry "Phase 2 shipped; corrections …".

**Verify:**
```bash
grep -n "mes-mobile-api" AGENTS.md && test -f .claude/rules/mes-mobile-api.md && echo OK
# Expected: one Task Router line; OK
```
Stop-point: open the `feat/mes-api` PR.

**Out of scope:** docs site pages (Task 52).

---

# Phase 3 — Screens (branch `feat/mobile-screens`, 4–6 weeks; split into PRs per screen group if reviews get long)

Done when: a pilot operator runs a full job on a tablet — start, instructions with a photo, issue by scan, report good and scrap, finish, pick a list, clock out — without opening web MES, and every write matches web's rows.

Design rules for every task here (`.claude/skills/carbon-design/references/shop-floor-mes.md`): one dominant colour-coded action per state (Start emerald, Pause red); 44–48 pt targets, hero buttons bigger; no hover, no context menus; one dock (right column on tablets ≥ 1024 pt wide, bottom bar with safe-area padding on phones); secondary actions in a bottom sheet; toasts bottom-left; confirmations list what will be affected, Cancel left and action right, both large; operator words ("Instructions", not "Procedure"); operator actions never navigate away from the operation screen; numbers with context ("12 of 40"); status colours from `@carbon/utils/status-colors`; skeletons while loading, empty states only when truly empty; locked or unpermitted controls disabled in place with an explanation, never hidden.

## Task 34: Design primitives — tokens, `ActionDock`, `HeroButton`, `StatusBadge`, `OperationCard`

**Depends on:** Task 20 merged
**Files:**
- Create: `apps/mobile/src/components/ActionDock.tsx`, `apps/mobile/src/components/HeroButton.tsx`, `apps/mobile/src/components/StatusBadge.tsx`, `apps/mobile/src/components/BottomSheet.tsx`, `apps/mobile/src/components/ConfirmDialog.tsx`, `apps/mobile/src/components/BigNumber.tsx`, `apps/mobile/src/components/Screen.tsx` (safe-area page shell with a sticky header: title or "‹ Back")
- Modify: `apps/mobile/src/features/operations/OperationCard.tsx` (use `StatusBadge`), `apps/mobile/global.css` (hero colours if missing)
- Copy from (precedent): `apps/mes/app/components/JobOperation/components/Controls.tsx` (`Controls`, `StartStopButton`, `PlayButton`/`PauseButton` sizes 56 → 96 → 128 px, `IconButtonWithTooltip`, `FloatingActionMenu` sheet of big round icon buttons), `apps/mes/app/components/EndShift.tsx` (confirmation modal layout), `apps/mes/app/components/Icons.tsx` `OperationStatusIcon` (status → icon mapping).

**Steps:**
1. `HeroButton`: `Pressable` 96 pt (128 pt on tablets) round, emerald `bg-emerald-600` for Start, red `bg-red-600` for Pause/Stop, white lucide icon 40 pt, a 4 pt darker bottom border that collapses on press (`style={({ pressed }) => …translateY 4}`) — the web's `border-b-4 active:translate-y-1` press.
2. `ActionDock`: props `{ children }`; on width ≥ 1024 renders a right column (`w-[260px]`, matches `--controls-width`), otherwise a bottom bar with `useSafeAreaInsets().bottom` padding; buttons inside are `size="lg"` icon buttons with labels.
3. `BottomSheet`: `@gorhom/bottom-sheet` (pin; `catalogs.mobile`; `expo install react-native-reanimated react-native-gesture-handler` already present) — rows 56 pt, muted icons (`text-muted-foreground`), colour only on the one action whose meaning is the colour (Scrap red).
4. `ConfirmDialog`: RNR `AlertDialog`, Cancel left / action right, both `size="lg"`, an optional list of affected items.
5. `StatusBadge`: `statusColor("jobOperation" | "pickingList" | "pickingListLine" | "trackedEntity", status)` → background/foreground classes + the matching lucide icon from the `OperationStatusIcon` mapping, text `text-base`.
6. `BigNumber`: `formatQuantity(value)` in `text-4xl font-semibold` with a `text-base text-muted-foreground` suffix ("of 40").

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Device check: a dev-only gallery screen (`src/app/(app)/_gallery.tsx`, deleted at the end of Phase 3) shows each primitive in light and dark; the dock sits right on the iPad landscape and bottom on the phones; every target measures ≥ 44 pt (Expo dev menu → element inspector).

**Out of scope:** screen logic.

## Task 35: Operation detail — Details tab and the dock (start / pause, work type, times)

**Depends on:** Task 34
**Files:**
- Create: `apps/mobile/src/features/operations/useOperationQuery.ts`, `apps/mobile/src/features/operations/OperationHeader.tsx`, `apps/mobile/src/features/operations/DetailsTab.tsx`, `apps/mobile/src/features/operations/useTimer.ts`, `apps/mobile/src/features/operations/commands.ts` (`useStartEvent`, `useEndEvent` mutations through the API client; each POST gets a fresh `Idempotency-Key` from `expo-crypto` `randomUUID()`)
- Modify: `apps/mobile/src/app/(app)/(tabs)/operations/[id].tsx`
- Copy from (precedent): `apps/mes/app/components/JobOperation/JobOperation.tsx` header and job-info bar, the Details tab sections and their order; `Controls.tsx` `WorkTypeToggle` (Setup / Labor / Machine), `Times` (elapsed vs planned), `StartStopButton`; `apps/mes/app/utils/durations.ts` `makeDurations` (import from the API payload — the server already applies it).

**Steps:**
1. `useOperationQuery(id)`: `GET /operations/:id` with `keys.operation(scope, id)`, `refetchInterval: 30_000`, refetch on focus, after every command (`invalidateQueries`), and on realtime changes to `productionEvent` filtered `jobOperationId=eq.<id>` and `jobOperation` filtered `id=eq.<id>`.
2. Header: item id + description, job id, `BigNumber` complete-of-target, `StatusBadge`, due with icon; work center name; a "‹ Back" that returns to the list.
3. Tabs (RNR `Tabs`): Details · Instructions · Materials · Notes, in `JobOperation.tsx`'s order; this task fills Details (times, quantities, customer, due, notes count) and leaves the other three as placeholders for Tasks 37–39.
4. Dock: `WorkTypeToggle` (segmented, 48 pt), `HeroButton` Start/Pause bound to the open event of the selected type (`useTimer` derives elapsed from the payload's events — never `new Date()` arithmetic; use `now(getLocalTimeZone())` from `@internationalized/date` and `Duration` helpers from `@carbon/utils/datetime`), "Log Completed" (Task 36), and a "More actions" button opening the `BottomSheet` (Task 36 fills it).
5. Start → `POST /operations/:id/events` `{ type, jobOperationId, workCenterId }`; Pause → `POST /events/:eventId/end`; a 403/409 failure → toast with the server's message, stay on the screen; `useKeepAwake()` from `expo-keep-awake` on this screen (`expo install expo-keep-awake`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Manual: Pause → both stop; the elapsed time matches web to the second; rotating the iPad keeps the dock on the right.

**Out of scope:** batch-mode operations (the screen shows the web's "part of a batch" message from the API and disables the dock).

## Task 36: Report good / scrap / rework / finish / end

**Depends on:** Task 35
**Files:**
- Create: `apps/mobile/src/features/operations/QuantitySheet.tsx`, `ScrapSheet.tsx`, `ReworkSheet.tsx`, `FinishDialog.tsx`, `MoreActionsSheet.tsx`
- Modify: `apps/mobile/src/features/operations/commands.ts` (+ `useReportQuantity`, `useReportScrap`, `useReportRework`, `useFinishOperation`)
- Copy from (precedent): `apps/mes/app/components/JobOperation/components/QuantityModal.tsx`, `ScrapReason.tsx` (reason picker, loaded on open with a skeleton), `ReworkModal.tsx` (targets from `GET /operations/:id/rework-targets`), the `FloatingActionMenu` items in `Controls.tsx` (Scrap, Rework, Finish, Maintenance → disabled "Use web MES" in v1, Quality Issue → Task 39).

**Steps:**
1. Quantity: numeric keypad input (`inputMode="numeric"`, `INPUT_FORMAT`-style quantity formatting from `@carbon/utils/format`; no raw rounding), optional note, "Log N completed" → `POST /operations/:id/quantities`; for Serial operations the payload carries the selected `trackedEntityId` from the detail payload; the server's `completed`/`finished` flags drive a toast; the screen stays.
2. Scrap: reason list (`getScrapReasons` from `@carbon/mes-core/queries` via supabase as the user) BEFORE the tap-to-submit row (rule 7c), quantity, note → `POST …/scrap`; `newTrackedEntityId` in the response selects the replacement serial.
3. Rework: targets from `GET …/rework-targets`, quantity → `POST …/rework`. Finish: `ConfirmDialog` listing open timers that will be closed → `POST …/finish`; `409 conflict` (rules) → toast with the message.
4. Optional per-operation "End operation by scan" is not a button — it is the kanban/QR path handled by Task 42.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Manual: Finish → operation `Done` in web MES. Toasts appear bottom-left and the operator stays on the operation.

**Out of scope:** batch completion, BOM-entity scrap.

## Task 37: Materials tab — issue by scan, tracked entities, undo

**Depends on:** Task 36
**Files:**
- Create: `apps/mobile/src/features/operations/MaterialsTab.tsx`, `apps/mobile/src/features/operations/IssueSheet.tsx`, `apps/mobile/src/features/scan/useKeyboardWedge.ts`, `apps/mobile/src/features/scan/CameraScanner.tsx`, `apps/mobile/src/features/scan/parseScan.ts`, `apps/mobile/src/features/scan/parseScan.test.ts`
- Modify: `commands.ts` (+ `useIssueMaterial`, `useIssueTracked`, `useUnconsume`)
- Copy from (precedent): `apps/mes/app/components/JobOperation/components/IssueMaterialModal.tsx` (materials list, quantities issued vs required, adjustment types, tracked-entity picker), `apps/mes/app/components/AssemblyView.tsx` L611–620 and L1214–1216 (`useKeyboardWedge`: a scan is a burst of keystrokes ending in Enter; yield Enter to the wedge while the buffer is non-empty).

**Steps:**
1. `useKeyboardWedge({ onScan })`: a hidden `TextInput` with `autoFocus`, `showSoftInputOnFocus={false}`, `blurOnSubmit={false}`, `onSubmitEditing` → `onScan(text)` and clear; re-focus on screen focus so a Bluetooth/USB scanner in keyboard mode types into it. `CameraScanner`: `expo-camera` `CameraView` with `onBarcodeScanned` debounced to one scan per 1.5 s, formats `qr`, `code128`, `datamatrix`, `ean13`.
2. `parseScan(text)` (pure, tested): a Carbon URL (`/x/operation/:id`, `/x/start/:id`, `/x/end/:id`, `/x/picking/:id`) → `{ kind: "url", route, id }`; otherwise `{ kind: "code", value }` (a tracked-entity readable id, an item readable id, or a kanban barcode — resolved by lookups in order: `getTrackedEntityByReadableId`, `getItemByReadableId`, else unknown).
3. Materials tab: the API payload's `materials` (required, issued, remaining, tracking type); tap a row → `IssueSheet` (quantity + adjustment type for untracked; scan or pick an entity for tracked) → `POST …/materials/issue` / `…/issue-tracked`; long-press a consumed entity → "Undo issue" `ConfirmDialog` → `…/unconsume`. A `blocked` 409 shows the rule names from `details`. Scanning anywhere on the tab issues the matching material (web's scan-to-issue behaviour).

**Verify:**
```bash
pnpm --filter mobile test && pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: parseScan.test.ts passes (5 cases); successful; "Exported: .expo-export"
```
Manual: Device check: issue a tracked entity by scanning its barcode with the camera and, on the Android phone with a Bluetooth scanner paired in keyboard mode (or the iPad's on-screen keyboard typing the code + Enter), confirm both produce the same `issue` call as web (ledger rows).

**Out of scope:** Zebra DataWedge intents (later), BOM-entity scrap.

## Task 38: Instructions tab — steps, step records, photos

**Depends on:** Task 37
**Files:**
- Create: `apps/mobile/src/features/operations/InstructionsTab.tsx`, `StepRow.tsx`, `RecordSheet.tsx`, `apps/mobile/src/lib/files/upload.ts`, `apps/mobile/src/lib/files/jobFilePath.ts`, `apps/mobile/src/lib/files/jobFilePath.test.ts`
- Modify: `commands.ts` (+ `useRecordStep`, `useDeleteStepRecord`)
- Copy from (precedent): `apps/mes/app/components/JobOperation/components/Step.tsx` (`StepsListItem`, `RecordModal`, `DeleteStepRecordModal`; the upload at L515–520: path `${companyId}/job/${operationId}/${stepId}/${nanoid()}/${safeName}` into the private bucket, the filename sanitised — the `parseJobFilePath` contract in `apps/erp/app/utils/supabase.ts`).

**Steps:**
1. `jobFilePath({ companyId, operationId, stepId, fileName })` (pure, tested against two names with spaces/unicode; uses the same sanitiser the web uses — import it from `@carbon/utils/string` if that is where `Step.tsx` gets it, else copy the one-liner and pin it with a test).
2. `upload.ts`: `expo-image-picker` (`launchCameraAsync` / `launchImageLibraryAsync`, `quality: 0.7`, JPEG) → `supabase.storage.from("private").upload(path, blob, { contentType: "image/jpeg" })` as the signed-in user (RLS as web), then `POST …/step-records` with `value` = the path. `expo install expo-image-picker` + `NSPhotoLibraryUsageDescription` / `NSCameraUsageDescription` strings.
3. Instructions tab: steps in order with type-specific inputs (Task / Checkbox tick, Measurement / Value numeric or text, List select, Person select, Timestamp, File / Inspection → photo); each saved record shows who/when; delete via `ConfirmDialog`.

**Verify:**
```bash
pnpm --filter mobile test && pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: jobFilePath.test.ts passes (2 cases); successful; "Exported: .expo-export"
```
Manual: Device check: record a step with a photo on the iPhone → the file lands under `{companyId}/job/{operationId}/{stepId}/…` (Supabase Studio → Storage) and opens in web MES's Instructions tab; delete it from the device → gone on web.

**Out of scope:** batch record grids, procedure authoring.

## Task 39: Notes tab, quality issue, print labels

**Depends on:** Task 38
**Files:**
- Create: `apps/mobile/src/features/operations/NotesTab.tsx`, `QualityIssueSheet.tsx`, `PrintSheet.tsx`
- Modify: `commands.ts` (+ `useAddNote`, `useRaiseQualityIssue`, `usePrintLabel`), `MoreActionsSheet.tsx` (Quality Issue, Print)
- Copy from (precedent): `apps/mes/app/components/JobOperation/components/Chat.tsx` (message list, newest at the bottom, realtime on `jobOperationNote`), `QualityIssueModal.tsx` (name, type from `getQualityIssueTypes`, priority, quantity), the Print button in `JobOperation.tsx` and `x+/print.tsx`'s payload (`sourceDocument`, `sourceDocumentId`, `printerRouteId`).

**Steps:**
1. Notes: `getJobOperationNotes` via supabase + realtime filter `jobOperationId=eq.<id>`; send → `POST …/notes` (attributed to the operator on shared tablets).
2. Quality issue: when `/me`'s `permissions.quality.create` is false the row is disabled with "Ask your supervisor for access"; otherwise the sheet posts to `POST /quality-issues`.
3. Print: `POST /print` with the operation as `sourceDocument` and the location from context; printers/routes come from the operation payload as on web.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Manual: Device check: a note from the iPad appears in web's Chat tab with the right author; a quality issue appears in the ERP issues list; printing fires a `print-job` event with the web payload (Inngest dev UI).

**Out of scope:** maintenance dispatch (web-only in v1; the row says so).

## Task 40: Picking list and picking detail

**Depends on:** Task 34
**Files:**
- Create: `apps/mobile/src/features/picking/usePickingQueries.ts`, `PickingListCard.tsx`, `PickingLineRow.tsx`, `PickQuantitySheet.tsx`, `PickTrackedSheet.tsx`, `PickingStatusBar.tsx`, `commands.ts`
- Modify: `apps/mobile/src/app/(app)/(tabs)/picking/index.tsx`, `apps/mobile/src/app/(app)/(tabs)/picking/[listId].tsx`
- Copy from (precedent): `apps/mes/app/routes/x+/picking._index.tsx` and `picking.$pickingListId.tsx` components (line rows, availability, "short" marking), `apps/mes/app/components/ShortPickModal.tsx` ("How many were actually picked?"), `apps/mes/app/components/PickingListStatus.tsx`, `isPickingListLocked` from `apps/mes/app/services/models.ts` (copied into `@carbon/mes-core/models` as a pure function in Task 21 — add it there if missing).

**Steps:**
1. List: `GET /picking` → cards (list id, job, lines picked / total, status badge, due). Detail: `GET /picking/:listId` → lines with required / picked / available and a status bar whose actions (Start, Complete, Cancel) come from the web's status transitions; a locked list disables actions in place with "Completed lists are reopened from the ERP".
2. Quantity pick → `POST …/lines/:lineId/quantity` with `markShort` when short (the ShortPickModal question); tracked pick → `GET …/tracked-options` then `POST …/lines/:lineId/tracked` (scan or choose; FEFO/FIFO order from `defaultOrder`). Completing with unresolved lines → `409 needs_acknowledgement` → `ConfirmDialog` listing `unresolvedLines`, then retry with `acknowledged: true`; `409 blocked` → the message, no retry.
3. Realtime on `pickingListLine` filtered by `pickingListId` refetches.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Manual: Device check: pick a quantity, pick a tracked entity by scan, complete; on a company with `incompletePickingListPolicy = error` completing an incomplete list shows web's message. Picking rows and `pickingListLine` quantities match web's for the same actions.

**Out of scope:** picking recommendations panel (web-only in v1).

## Task 41: Timecard — clock in, clock out, end shift

**Depends on:** Task 34
**Files:**
- Create: `apps/mobile/src/features/timecard/useTimecardQuery.ts`, `TimecardSummary.tsx`, `EndShiftDialog.tsx`, `commands.ts`
- Modify: `apps/mobile/src/app/(app)/(tabs)/timecard.tsx`, `apps/mobile/src/app/(app)/(tabs)/_layout.tsx` (a clock status pill in the header, precedent `TimeCardButton.tsx`)
- Copy from (precedent): `apps/mes/app/components/TimeCardButton.tsx`, `TimeCardWarning.tsx` ("Forgot to Clock Out?" / "I'm Still Working"), `EndShift.tsx` (lists each open operation that will be ended).

**Steps:**
1. `GET /timecard?weekOffset=` → week entries and the open entry; big "Clock in" / "Clock out" hero (emerald / red), optional note on clock-out → `POST /timecard/clock-in|clock-out`.
2. End shift → `EndShiftDialog` listing the operator's running operations (from the operations query) → `POST /timecard/end-shift`; `endedConsole: true` → drop the operator token and return to the PIN screen (Task 44).
3. Week navigation (`weekOffset` ± 1); dates through `formatDate` in the company time zone.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Manual: Device check: clock in, clock out, end shift → `timeCardEntry` rows identical to web's for the same user and day.

**Out of scope:** editing or deleting entries.

## Task 42: Scan tab — camera and keyboard wedge, Carbon URLs navigate

**Depends on:** Task 37
**Files:**
- Modify: `apps/mobile/src/app/(app)/scan.tsx` (the modal), `apps/mobile/src/app/(app)/(tabs)/_layout.tsx` (a global `useKeyboardWedge` so a scanner works from any tab)
- Copy from (precedent): `parseScan` (Task 37); web behaviour "scanning a Carbon URL navigates" and the kanban wedge in `JobOperation.tsx` L732–745 (a kanban barcode completes the single operation via the end URL).

**Steps:**
1. The Scan modal shows the `CameraScanner` with a text fallback. Result routing: `/x/operation/:id` → `operations/[id]`; `/x/start/:id` → open the operation and call `POST /operations/:id/events` with `viaScan: true` and the context's default work type; `/x/end/:id` → `ConfirmDialog` "Complete this operation?" → `POST /operations/:id/end`; `/x/picking/:id` → `picking/[listId]`; a tracked-entity or item code → a sheet offering "Issue to the open operation" (when one is open) or "Show"; unknown → toast "Nothing matches <code>".
2. The global wedge is active on every tab except while a text field is focused (check `TextInput.State.currentlyFocusedInput()`).

**Verify:**
```bash
pnpm --filter mobile test && pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: parseScan.test.ts passes with the routing table cases; successful; "Exported: .expo-export"
```
Manual: `parseScan.test.ts` extended with the routing table; typecheck; Device check: scan the operation QR from a printed traveller (or web's QR) → the operation opens; scan the start URL → the timer starts on web too.

**Out of scope:** DataWedge intents.

## Task 43: Outbox — ordered per-operation queue, offline banner, needs-attention

**Depends on:** Task 35
**Files:**
- Create: `apps/mobile/src/lib/outbox/schema.ts`, `store.ts`, `policy.ts`, `policy.test.ts`, `sender.ts`, `OutboxProvider.tsx`, `apps/mobile/src/components/OfflineBanner.tsx`, `apps/mobile/src/app/(app)/outbox.tsx`
- Modify: `apps/mobile/src/lib/api/client.ts` (commands go through `enqueue` when offline or on a retry-same-key failure), every `features/*/commands.ts` (`useCommand` hook that writes to the outbox first and sends immediately when online), `apps/mobile/src/lib/auth/AuthProvider.tsx` (sign-out blocked while rows are queued → the outbox screen)
- Copy from (precedent): the Offline outbox section of the spec (columns, lanes, states, backoff 2 s → 60 s, 8-hour stale hold, `operator_expired` handling).

**Steps:**
1. `schema.ts`: `expo-sqlite` (`expo install expo-sqlite`), table `outbox(id TEXT PK, instanceId, companyId, sessionUserId, operatorUserId, operationId NULL, method, path, body TEXT, idempotencyKey, createdAt TEXT ISO, attempts INT, state TEXT, lastError TEXT NULL, nextAttemptAt TEXT NULL)`; `store.ts` CRUD scoped by `(instanceId, companyId)`.
2. `policy.ts` (pure, tested): `laneOf(row)` = `operationId ?? "general"`; `nextDelayMs(attempts)` = `min(2000 * 2**attempts, 60000)`; `classify(err)` → `"retry_same_key"` (network, timeout, 503 `retry_later`, 409 `request_in_progress`), `"operator_expired"` (401 `operator_expired`), `"needs_attention"` (any other 4xx, or a 5xx the server stored); `isStale(createdAtIso, nowIso)` → older than 8 h (compare with `parseAbsolute` from `@internationalized/date`; no `Date` arithmetic). Tests: each branch; 8 h boundary.
3. `sender.ts`: one lane at a time, in `createdAt` order; `queued → sending → done`; retry_same_key → `queued` with `nextAttemptAt`; needs_attention stops the lane and marks the row; stale rows are never auto-sent; on app start and on `NetInfo` reconnect (`@react-native-community/netinfo`, pinned) the sender runs. The row's `idempotencyKey` is reused on automatic retries; the operator's Retry creates a new key after the screen refetches; Discard deletes the row.
4. UI: `OfflineBanner` ("Offline · 3 actions waiting") under the header on every `(app)` screen; cached screens show "Updated <relative time>" from the query's `dataUpdatedAt`; `outbox.tsx` lists rows by state with Retry / Discard / Confirm (stale) actions; a needs-attention row shows the server message.

**Verify:**
```bash
pnpm --filter mobile test && pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: policy.test.ts passes (every branch + the 8 h boundary); successful; "Exported: .expo-export"
```
Manual: Device check (acceptance): Wi-Fi off on the iPad, report 5 good twice, Wi-Fi on → exactly two `productionQuantity` rows, in order; kill the app with rows queued and reopen → they send; a row older than 8 h (set the device clock forward in a dev build, or insert a backdated row through a dev-only button) waits for confirmation.

**Out of scope:** full offline reads, conflict resolution.

## Task 44: Shared terminal — terminal mode, PIN screen, operator header

**Depends on:** Task 35, Task 23
**Files:**
- Create: `apps/mobile/src/features/console/useTerminal.ts`, `OperatorPicker.tsx`, `PinPad.tsx`, `OperatorHeader.tsx`
- Modify: `apps/mobile/src/app/(app)/pin.tsx`, `apps/mobile/src/app/(app)/(tabs)/more.tsx` ("Use this tablet as a shared terminal" switch, disabled with "Ask your supervisor for access" unless `permissions.settings.update` and `consoleAvailable`), `apps/mobile/src/lib/api/client.ts` (`x-carbon-operator` header; read the refreshed token from every response; `401 operator_expired` → route to the PIN screen), `apps/mobile/src/app/(app)/_layout.tsx` (in terminal mode with no operator → PIN screen)
- Copy from (precedent): `apps/mes/app/components/PinInOverlay.tsx` (operator grid + PIN pad), `apps/mes/app/components/ConsolePill.tsx` (pinned operator + "Switch operator"), `x+/console.pin-in.tsx` error texts.

**Steps:**
1. Terminal token: `POST /console/terminal` → SecureStore `terminal:<instanceId>:<companyId>`; leaving shared-terminal mode discards both tokens.
2. PIN screen: operators from `getEmployeesForPinIn` (avatars, names, search), a 4–8 digit `PinPad` (big keys, 64 pt) → `POST /console/pin-in` with `x-carbon-terminal` → the operator token lives in memory only (`useTerminal` state), never in the query cache or SecureStore.
3. `OperatorHeader` on every tab: operator name + avatar + "Switch operator" (`POST /console/pin-out`, then the PIN screen); idle: after `idleLockMs` without a touch (a `PanResponder` on the root resets the timer) the operator token is dropped and the PIN screen shows; `endedConsole` from end-shift does the same.
4. Reads keep running as the terminal user (queries unchanged); commands carry the operator header.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Manual: Device check (company entitled to console mode): two operators pin in one after the other and each starts a timer → `productionEvent.createdBy` is each operator; five wrong PINs → the web's locked message; an hour idle (or a dev-only shortened `idleLockMs`) → the next command returns `operator_expired` and the PIN screen appears; a user without `settings_update` sees the switch disabled with the explanation.

**Out of scope:** operator-level permissions (spec Q14: parity with web; the terminal account's claims apply).

## Task 45: More screen — instances, language, theme, outbox, sign out; idle lock; analytics gating

**Depends on:** Task 43
**Files:**
- Create: `apps/mobile/src/features/settings/LanguagePicker.tsx`, `ThemePicker.tsx`, `apps/mobile/src/lib/analytics/posthog.ts`, `apps/mobile/src/components/LockScreen.tsx`, `apps/mobile/src/app/(app)/update-required.tsx`
- Modify: `apps/mobile/src/app/(app)/(tabs)/more.tsx`, `apps/mobile/src/i18n/index.tsx` (persisted locale per device under `locale`), `apps/mobile/src/app/_layout.tsx` (PostHog provider only when allowed; lock screen), `apps/mobile/src/lib/api/client.ts` (426 → `update-required`)
- Copy from (precedent): `apps/mes/app/components/SessionLockOverlay.tsx` and `apps/mes/app/hooks/useIdle.tsx` (idle lock in a controlled environment), PostHog's Expo install (`npx expo install posthog-react-native expo-file-system expo-application expo-device expo-localization`; `PostHogProvider apiKey options={{ host }}`; `disabled: true` turns it off).

**Steps:**
1. More: instance row (name, hostname, switch → `instances.tsx`), shared-terminal switch (Task 44), language (the 13 `MES_LOCALES` with native names), theme (System / Light / Dark via Uniwind's theme API, see docs.uniwind.dev → Theming; persisted under `theme`), outbox (count badge → `outbox.tsx`), "Connect mobile app" help text, version string, sign out (blocked with the outbox list while rows are queued).
2. Analytics: `PostHogProvider` mounted only when `/me` returned `analytics` (non-null) — so never before sign-in and never for air-gapped or controlled instances; `autocapture` on, session replay off (default). Nothing else in the app calls any host but the instance's own: the image CDN is not used (photos come from the instance's Supabase), and the store update check is Expo's own (disabled via `updates.checkAutomatically: "NEVER"` in `app.json`; Task 48 wires `expo-updates` checks only for connected instances).
3. Controlled environment: when `/me.instance.controlledEnvironment`, after `idleLockMs` without interaction show `LockScreen` (hostname, "Locked after inactivity", "Unlock" → sign-in again via code); the supabase session is kept but every screen is covered until re-authentication succeeds.
4. `update-required.tsx`: shown on any 426; store links; the instance stays linked. `server_too_old` is shown inline on the sign-in screen (Task 19) and here as a notice on the instance row.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Manual: Device check: switch instance between the LAN MES and a second instance (Carbon Cloud or a second local worktree) → operations, context and outbox swap completely; set the language to Spanish → the app re-renders in Spanish; with `CONTROLLED_ENVIRONMENT=true` on the dev server the lock screen appears after the idle window (shorten `SESSION_IDLE_LOCK_MS` is not an env var — use a dev-only override in the app); with a proxy on the Mac (`mitmproxy` or Proxyman as the device's HTTP proxy) no request leaves the device to any host but the instance's before sign-in and under `controlledEnvironment: true`.

**Out of scope:** passkeys for unlock, SSO.

## Task 46: Tablet split layout, keep-awake, phone polish

**Depends on:** Task 35, Task 40
**Files:**
- Create: `apps/mobile/src/app/(app)/(tabs)/operations/_layout.tsx` (two-pane on wide screens: the list 360 pt on the left, the detail on the right; a `Slot`/`Stack` on phones), `apps/mobile/src/hooks/useLayout.ts` (`isTablet = width >= 1024`, `isLandscape`)
- Modify: `operations/index.tsx`, `operations/[id].tsx`, the picking screens (same two-pane), `(app)/(tabs)/_layout.tsx` (tab bar becomes a left rail on tablets ≥ 1024 pt — the shared `NavRail` idea from web)
- Copy from (precedent): the spec's Tablet (landscape) and Phone (portrait) descriptions; web MES's `lg` pivot in `shop-floor-mes.md`.

**Steps:**
1. On the iPad (landscape, mounted) the operations list stays visible on the left with the selected card highlighted; the detail fills the rest; the dock is the right column. On phones the detail is a pushed screen with the dock at the bottom and safe-area padding.
2. `useKeepAwake()` on the operation detail, picking detail and PIN screens.
3. Phone polish: 16 pt side gutters, no horizontal scroll, large titles truncate with ellipsis, the quantity sheet keypad never covers its submit button (`KeyboardAvoidingView`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=mobile && pnpm --filter mobile run export:check 2>&1 | tail -1
# Expected: successful; "Exported: .expo-export"
```
Manual: Device check: iPad landscape shows list + detail + right dock; iPad portrait and both phones show a single pane with the bottom dock; the screen does not dim during a 3-minute running timer.

**Out of scope:** wall displays.

## Task 47: Lingui extraction and translations for the app's strings

**Depends on:** Tasks 34–46
**Files:**
- Modify: `packages/locale/locales/*/mes.po` (via extraction and translation)
- Delete: `apps/mobile/src/app/(app)/_gallery.tsx` (Task 34's dev gallery)

**Steps:**
1. `pnpm run lingui:extract`; review the new `msgid`s for operator words (no data-model words), then `/translate` (the house skill: Haiku subagents + `packages/locale/locales/glossary.json`), then `pnpm run lingui:clean`.
2. Every `accessibilityLabel` in `apps/mobile/src` goes through Lingui — `grep -rn 'accessibilityLabel="' apps/mobile/src` must return nothing.

**Verify:**
```bash
pnpm run lingui:check 2>&1 | tail -2 && grep -rn 'accessibilityLabel="' apps/mobile/src | wc -l
# Expected: ok; 0
grep -c 'msgstr ""' packages/locale/locales/es/mes.po
# Expected: 0 (no untranslated Spanish strings)
```
Stop-point: open the `feat/mobile-screens` PR(s). Then run `/self-review` on the branch.

**Out of scope:** adding a language.

---

# Phase 4 — Pilot and ship (branch `feat/mobile-ship`, 1–2 weeks)

Done when: one pilot customer runs a full shift on TestFlight / Play internal testing without falling back to web MES, and the store listings are submitted.

## Task 48: Store configuration — `app.json`, icons, `eas.json`, EAS Update channels

**Depends on:** Task 47 merged; the user's Expo account
**Files:**
- Create: `apps/mobile/eas.json`, `apps/mobile/assets/icon.png` (1024×1024), `apps/mobile/assets/adaptive-icon.png`, `apps/mobile/assets/splash-icon.png`, `apps/mobile/assets/favicon.png`
- Modify: `apps/mobile/app.json`
- Copy from (precedent): the Carbon mark in `apps/mes/public/carbon-mark-dark.svg` / `carbon-mark-light.svg` (export the PNGs from the SVG at the sizes above; dark mark on a `#09090B` field for the icon, splash on `--background`).

**Steps:**
1. `cd apps/mobile && npx eas-cli@latest init` (links the Expo project; writes `extra.eas.projectId`), then `npx eas-cli@latest update:configure` (adds `updates.url` and `runtimeVersion: { policy: "fingerprint" }`).
2. `app.json` additions: `"updates": { "url": "<from eas>", "checkAutomatically": "NEVER" }` (the app checks for updates only for connected instances — Task 45), `"icon"`, `"splash"`, `"android": { "adaptiveIcon": {...}, "package": "ms.carbon.mes", "permissions": ["CAMERA"] }`, `"ios": { "bundleIdentifier": "ms.carbon.mes", "supportsTablet": true, "infoPlist": { NSCameraUsageDescription, NSPhotoLibraryUsageDescription } }`, `"privacy": "public"`, `"description"`.
3. `eas.json`:
   ```json
   { "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
     "build": {
       "development": { "developmentClient": true, "distribution": "internal", "channel": "development" },
       "preview": { "distribution": "internal", "channel": "preview", "ios": { "simulator": false } },
       "production": { "channel": "production", "autoIncrement": true } },
     "submit": { "production": {} } }
   ```
   (If the installed `eas-cli` major differs, use its documented `cli.version` range; the three profile names and channels are the contract.)
4. `expo-updates`: `expo install expo-updates`; in the app, `Updates.checkForUpdateAsync()` runs only when the current instance is `connected` and not controlled (Task 45's gating), from the More screen's "Check for updates" row.

**Verify:**
```bash
pnpm --filter mobile exec expo-doctor && pnpm --filter mobile exec expo config --type public | grep -E '"scheme"|"bundleIdentifier"|"package"|"runtimeVersion"'
# Expected: no issues; scheme carbon-mes, ms.carbon.mes twice, runtimeVersion fingerprint policy
```

**Out of scope:** per-customer branded builds (supported from the repo, not distributed by Carbon).

## Task 49: Internal testing builds — TestFlight and Play internal testing

**Depends on:** Task 48; Apple Developer Program + Google Play Console accounts
**Files:**
- Modify: `apps/mobile/AGENTS.md` (a "Builds" section with the commands below), `.github/workflows/mobile-preview.yml` (optional: `eas build --profile preview --non-interactive --no-wait` on tags `mobile-v*`; requires `EXPO_TOKEN` secret — add only if the team wants CI builds)

**Steps:**
1. Development builds first (they replace Expo Go and enable the `carbon-mes://` scheme): register the user's devices with `npx eas-cli@latest device:create` (iPhone 13, iPad; the UDIDs come from the registration link EAS sends), then `npx eas-cli@latest build --profile development --platform ios` and `--platform android`; install from the EAS build page (Android APK directly; iOS over the registered-device link).
2. Verify the deep link: scan the web QR with the iPad's Camera app → Carbon MES opens on the Connect screen with the address filled in.
3. Preview builds: `npx eas-cli@latest build --profile preview --platform all`; `npx eas-cli@latest submit --platform ios --profile preview` (TestFlight) and upload the Android `.aab` to Play Console → Internal testing. Add the pilot operators as testers.
4. Zebra check: install the Android preview build on one Zebra Android 11+ device (pilot customer's or a rental); DataWedge in keystroke mode → scanning issues material in the Materials tab (Task 37's wedge).

**Verify:**
```bash
npx eas-cli@latest build:list --limit 4 --json | jq '.[] | {platform, status, buildProfile}'
# Expected: finished development + preview builds for ios and android
```
Device check: the development build on the iPhone opens from the QR deep link; the TestFlight build runs the full Phase 3 "done when" flow on the pilot's tablet.

**Out of scope:** Apple Enterprise distribution.

## Task 50: Store-review account path on Carbon Cloud

**Depends on:** Task 49
**Files:**
- Modify: Carbon Cloud's MES environment (Vercel project `mes` and `mes-us`): `APP_REVIEW_EMAILS` set to the reviewer address; a runbook note in `.claude/rules/mes-mobile-api.md` ("Store review account") with how the account is provisioned and rotated.
- Also: the hosted Supabase projects' Magic Link email template (Task 16's runbook note) — paste the template with `{{ .Token }}`.

**Steps:**
1. Create a demo company on Carbon Cloud (Settings → Demo Data, dataset `satellite`), invite the reviewer email as an employee with production permissions only, set a password for it (ERP account → password sign-in), and verify `POST /auth/code` answers `{ ok: true, method: "password" }` for it and `{ ok: true }` for any other address.
2. Write the App Store / Play Console reviewer notes: "Open the app → Connect → Carbon Cloud → sign in with <email>; the password field appears for this account only. Demo company: <name>. Try: Operations → start a timer → Log Completed."

**Verify:**
```bash
curl -s -X POST https://mes.carbon.ms/api/v1/auth/code -H 'content-type: application/json' -d '{"email":"<reviewer>"}'
# Expected: {"ok":true,"method":"password"}
curl -s -X POST https://mes.carbon.ms/api/v1/auth/code -H 'content-type: application/json' -d '{"email":"someone-else@example.com"}'
# Expected: {"ok":true}
```

**Out of scope:** any password path for non-review users.

## Task 51: Acceptance matrix on iPad, Android tablet and phones

**Depends on:** Task 50
**Files:**
- Create: `.ai/runs/<date>-mes-mobile-acceptance.md` — one row per spec acceptance criterion × device, PASS / FAIL with evidence (screenshot path or SQL output)

**Steps:** run every checkbox in the spec's Acceptance Criteria on the iPad, one Android tablet (the Zebra from Task 49), the iPhone 13 and the Android phone, in this order, each as a closed loop with a DB check:

| Spec criterion | Implemented by | Evidence |
|---|---|---|
| QR link → code sign-in → default location's operations match web; typed bare domain; Carbon Cloud button | Tasks 17–20 | screenshots web + device |
| Two instances with the same company id; switching swaps everything | Tasks 18, 45 | screenshots, outbox table dump |
| Server without the API refused; `426` → update screen | Tasks 13, 19, 45 | screenshots |
| No outbound requests before sign-in / under controlled or airgapped | Task 45 | proxy log |
| No `.well-known/carbon-mobile`, no `/api/v1/config`; `auth/code` same body for existing and unknown email | Tasks 13, 14 | curl transcripts |
| http warning shown, https not | Task 19 | screenshots |
| Review account password path; others refused; unset variable → off | Tasks 13, 50 | curl transcripts |
| TOTP user needs 2FA; `aal1` → `mfa_required` | Tasks 11, 13, 19 | curl + screenshot |
| SSO-required domain message; lockout after 5 attempts | Tasks 12, 13 | screenshots, `auth_events` log |
| Start, pause, 10 good, 2 scrap, finish — identical rows to web | Tasks 24, 25, 35, 36 | SQL from Task 25 |
| Floor gate blocks the same start with the same message | Tasks 24, 42 | screenshot |
| Tracked entity by wedge and by camera → same `issue` call | Tasks 26, 37 | ledger rows |
| Step photo lands under `{companyId}/job/…` and opens on web | Task 38 | Storage path + web screenshot |
| Print → `print-job` event with web's payload | Tasks 28, 39 | Inngest event JSON |
| Picking policy `error` refuses completion with web's message | Tasks 29, 40 | screenshot |
| Clock in/out/end shift rows identical | Tasks 30, 41 | `timeCardEntry` rows |
| Shared terminal: two operators attributed; 5 wrong PINs lock; 1 h idle → `operator_expired` | Tasks 23, 44 | rows + screenshots |
| No `settings_update` → cannot enable the terminal | Task 44 | screenshot |
| Wi-Fi off, 5 good twice, reconnect → two rows in order; kill + reopen resends | Task 43 | rows |
| Same `Idempotency-Key` replay → one row | Task 22 | curl + row count |
| Row older than 8 h waits for confirmation | Task 43 | screenshot |
| Company switch pauses the other company's rows | Tasks 43, 45 | outbox dump |
| Web routes unchanged (`pnpm test`, manual pass) | Task 32 | run record |
| `pnpm why react` 18.3.1 only for erp and mes | Task 2 | command output |
| Typecheck, biome, test, lingui all green | all | CI run link |

**Verify:**
```bash
grep -c "PASS" .ai/runs/*-mes-mobile-acceptance.md; grep -c "FAIL" .ai/runs/*-mes-mobile-acceptance.md
# Expected: every row PASS on every device; FAIL count 0 (any FAIL blocks Task 52 until fixed)
```

**Out of scope:** load or soak testing.

## Task 52: Docs and changelog — reference page, `/changelog-entry`, AGENTS.md refresh

**Depends on:** Task 51
**Files:**
- Create: `docs/content/docs/reference/mes-mobile-app.mdx` (install from the stores, Connect by QR or address, sign-in, shared tablets, offline behaviour, what stays on web MES), `docs/content/changelog/<date>-carbon-mes-mobile-app.mdx` (via the `/changelog-entry` skill; description 15–20 words; tags `["production", "mes"]`)
- Modify: `apps/mobile/AGENTS.md`, `packages/mes-core/AGENTS.md`, `.claude/rules/mes-mobile-api.md` (anything learned in Phases 3–4), `AGENTS.md` (root; Apps and Task Router rows final), `.ai/specs/2026-09-30-mes-mobile-app.md` (Changelog: shipped; move to `.ai/specs/implemented/` once the stores approve), `.ai/lessons.md` (every correction from this plan's "Spec corrections" that cost time, in the Context → Problem → Rule → Applies to format)
- Copy from (precedent): `docs/content/docs/reference/kanban.mdx` (page shape), `.claude/rules/changelog-authoring.md`.

**Steps:**
1. Write the reference page with a `Screenshot` per main screen (taken on the iPad), link it from the MES docs index, and run the docs link check from `changelog-authoring.md`.
2. `/changelog-entry` for the release.
3. Move this plan to `.ai/plans/implemented/` with every Progress box checked and a Deviations section listing what differed from the plan.

**Verify:**
```bash
pnpm --filter docs typecheck && test -f docs/content/docs/reference/mes-mobile-app.mdx && ls docs/content/changelog | grep -c "carbon-mes-mobile-app"
# Expected: typecheck ok; file exists; 1
```
Stop-point: open the `feat/mobile-ship` PR; after merge, submit the store listings.

**Out of scope:** SSO (v1.1), inspections, batches, maintenance, 3D, drawings, DataWedge intents, Bluetooth printers, kiosk lock, push notifications, full offline mode.
