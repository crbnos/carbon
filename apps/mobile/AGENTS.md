# apps/mobile — Carbon MES (iOS and Android)

The native shop-floor app: an operator starts and pauses time, reports good /
scrap / rework, issues material by scan, follows work instructions with photos,
raises quality issues, prints labels, picks lists and clocks in and out. Expo
SDK 57, Expo Router, Uniwind, TanStack Query, supabase-js.

- Design record: `.ai/specs/2026-09-30-mes-mobile-app.md`
- Implementation plan: `.ai/plans/2026-10-02-mes-mobile-app.md`
- Wire contract: `packages/mes-core` (`@carbon/mes-core`)
- Server side: `apps/mes/app/routes/api+/v1+/` + `.claude/rules/mes-mobile-api.md`
- Shop-floor design language: `.claude/skills/carbon-design` → `shop-floor-mes.md`

## This app is NOT in the pnpm workspace

Read this before running any package command.

The web tree is pinned to React 18.3.1 by bare `react` / `react-dom` overrides in
the root `pnpm-workspace.yaml`; this app needs React 19.2 for React Native 0.86.
A pnpm override applies to the whole workspace with no per-package escape, and
both ways of scoping it were measured and both put two React majors in one tree
(the comments in `pnpm-workspace.yaml` have the numbers). So `apps/mobile` is
excluded from `packages:` and keeps its **own lockfile and node_modules**.

Consequences you must respect:

- **Always pass `--ignore-workspace`**, or pnpm picks up the repo root and the
  install fails on `minimumReleaseAge`. The root `mobile:*` scripts already do.
- `expo install` **does not work**: it shells out to `pnpm add` without that
  flag. Take the version from `node_modules/expo/bundledNativeModules.json`,
  write it into `package.json` by hand, then `pnpm --ignore-workspace install`.
- `@carbon/mes-core` is **not** a dependency — it is shared as SOURCE through a
  Metro alias and a tsconfig path. Metro compiles its TypeScript like the app's
  own. That is why it may only import zod and types.
- Turbo cannot see this app, so CI drives it through the root `mobile:*` scripts.
  A new script here needs a matching root script to be covered.

## Run it on a device

No Xcode or Android SDK is needed: Expo Go on a physical device is the loop.

1. `crbn up --no-portless --no-apps` (database, Supabase, Redis, Inngest).
2. Make Supabase reachable from the phone. In the repo root `.env`, with your
   own LAN address from `ipconfig getifaddr en0`:
   `SUPABASE_URL=http://192.168.1.100:54321 #force`
   The `#force` marker keeps `crbn up` from overwriting it (see
   `.claude/rules/environment-configuration.md`). Re-run `crbn up` once, and
   delete the line when you are done.
3. `pnpm --filter mes run dev:lan` — the MES server on `0.0.0.0:3001`. `crbn up`
   itself always binds loopback, which a phone cannot reach.
4. `pnpm run mobile:start` and scan the QR with the iOS Camera app or from
   inside Expo Go on Android. Different network: `mobile:start` then press `s`,
   or use `--tunnel`.
5. In the app, link the instance to `http://<LAN-IP>:3001` and sign in. Read the
   6-digit code from the dev mailbox (`crbn status` prints the Inbucket URL).

Expo Go cannot do the `carbon-mes://` deep link (it owns `exp://`) — use the
in-app scanner until there is a development build.

**When a device test writes rows, run it as a closed loop**: clear the rows,
reload, then check the database after EVERY action. `.ai/lessons.md`
("Browser-testing MES flows that write data") was written about exactly this and
applies to devices too.

## Builds and store submission

`app.json` is the store configuration and `eas.json` the build configuration.
Neither takes a license header.

Three build profiles, each pinned to the EAS Update channel of the same name —
`development`, `preview`, `production`. The channel names are the contract: an
update published to `preview` reaches preview builds and nothing else.
`cli.appVersionSource` is `remote`, so EAS owns the build number and
`production` increments it; never hand-write `ios.buildNumber` or
`android.versionCode` into `app.json`.

`runtimeVersion` is the `fingerprint` policy — it hashes the native project, so
an OTA update can never land on a binary whose native side has moved. Expo Go
ignores it and uses `sdkVersion`, so the device loop above is unaffected.
`updates.checkAutomatically` is `NEVER`: the app checks only for connected
instances, from the More screen, never for an air-gapped or controlled one.

**Four account values are deliberately absent.** They belong to the user's Expo,
Apple and Google accounts, so they are generated rather than written by hand:

1. `extra.eas.projectId` and `updates.url` in `app.json` — run
   `npx eas-cli@latest init` then `npx eas-cli@latest update:configure` in this
   directory. Both commands write the real values; a placeholder left in either
   key makes them skip, so the keys stay out of the file until then.
2. `submit.*.ios.{appleId,ascAppId,appleTeamId}` and
   `submit.*.android.serviceAccountKeyPath` in `eas.json` — these are
   `REPLACE_ME_*` placeholders. Replace them, or delete the key and let
   `eas submit` prompt.

The `development` profile also needs `expo-dev-client` as a dependency before it
builds anything useful — that is a native module, so it ends Expo Go
compatibility and is an **Ask First** item.

Icons and splash are generated vector art, not photographs: the three-hexagon
Carbon mark from web MES (`apps/mes/public/icons/`) in `#00B0FF` on the `#09090B`
field. `icon.png` and `favicon.png` carry **no alpha channel** — App Store
Connect rejects an icon that does. The Android foreground sits inside the
66/108 adaptive-icon safe circle, which is why the mark is smaller there than on
iOS. Do not block the `maxSdkVersion="32"` storage permissions
`expo-image-picker` declares; the pilot Zebra devices run Android 11 and still
need them.

## Always

- Every user-facing string, including every `accessibilityLabel`, goes through
  Lingui: `useLingui()` / `<Trans>` from `@lingui/react/macro`. The catalog is
  the SHARED `mes` one, so a string already translated for web MES is already
  translated here. Never `import { t } from "@lingui/core/macro"`.
- Run `pnpm run catalogs` after a `.po` change. `src/i18n/generated/` is
  gitignored and rebuilt by `prestart` and `typecheck`.
- Key EVERY query key, cache entry, SecureStore key and outbox row by
  `(instanceId, companyId)` — `keys.ts` is the only place query keys are built.
  A company id is not unique across instances: staging restored from a
  production backup has the same ids.
- Import `@carbon/utils` only by subpath (`@carbon/utils/format`). The barrel
  pulls in tiptap, dompurify and cookie helpers.
- No JavaScript `Date` for parsing, formatting or arithmetic — use
  `@internationalized/date` and `@carbon/utils`. Quantities use the quantity
  kind; no `Math.round` on a value.
- Take every dependency version from `bundledNativeModules.json` when Expo
  manages it, and prefer a release at least 3 days old otherwise — the repo's
  `minimumReleaseAge` policy still applies in spirit here.
- Run `pnpm license:headers` from the repo root after adding a file. Tracked
  `metro.config.js`, `babel.config.js` and `*.d.ts` need the AGPL header too;
  `app.json` and `eas.json` do not.

## Ask First

- Adding a native module or a config plugin: it ends Expo Go compatibility, so
  every device check then needs a development build. On Android that costs
  nothing — build an APK and install it. On iOS an EAS development build needs
  the paid Apple Developer Program, or Xcode's free provisioning for a 7-day
  certificate. Note this is the cost of LOSING Expo Go; testing the app as it
  stands needs no developer account on either platform.
- Any change to a `/api/v1` request or response shape. The API is
  additive-only: the two most recent store releases must keep working and a
  self-hosted server can be months behind the app.
- Adding a production dependency.
- Changing the theme tokens in `global.css` — `src/theme.test.ts` pins them to
  the web's default theme in `packages/utils/src/themes.ts`.

## Never

- Never put the service-role key, or any server secret, in this app.
- Never call a web route action (`/x/...`). Everything goes through
  `/api/v1`, which runs the same extracted server code the web routes run.
- Never make an outbound request to any host but the linked instance's own
  before sign-in, or at all when `/me` reports `controlledEnvironment` or
  `mode: "airgapped"`.
- Never store the operator token (shared-tablet PIN session) anywhere but
  memory, and never in the query cache.
- Never add `react-dom` usage: this is React Native. `react-dom` is present
  only because `expo-router` needs it for `expo start --web`.

## Validation Commands

`pnpm --dir apps/mobile --ignore-workspace run doctor` reports **one expected
failure**, and it must stay failing: `expo-doctor` objects to
`resolver.disableHierarchicalLookup` and the narrowed `resolver.nodeModulesPaths`
in `metro.config.js`. Those two overrides are exactly what keeps this app off the
root `node_modules` and its React 18 — see "This app is NOT in the pnpm workspace"
above. Adopting doctor's "recommended values" reintroduces the dual-major crash.
Everything else doctor checks should pass; a SECOND failure is a real one.

```bash
pnpm run mobile:typecheck        # catalogs + tsc --noEmit
pnpm run mobile:test             # vitest, pure logic only
pnpm run mobile:lint             # biome
pnpm run mobile:build:check      # expo export for ios + android — proves it bundles
pnpm --dir apps/mobile --ignore-workspace exec expo-doctor
```

`mobile:build:check` is the closest thing to a build gate: it runs Metro and the
Uniwind CSS pipeline over every platform, so it catches a broken alias, a CSS
feature Uniwind cannot compile, and an unresolved import that `tsc` misses.

## Layout

```
src/
  app/                 Expo Router routes (file = route)
    (setup)/           connect, instances — before any session exists
    (auth)/            sign-in, verify, two-factor, password
    (app)/             guarded: session + company + location
      (tabs)/          Operations · Picking · Scan · Timecard · More
  components/          shared primitives (ActionDock, HeroButton, StatusBadge, …)
  features/<area>/     screen-specific components, queries and commands
  lib/
    api/               the /api/v1 client, error mapping
    auth/              session storage, supabase client, AuthProvider
    instances/         the linked-Carbon list and its storage
    outbox/            the offline queue (sqlite) and its policy
    query/             QueryClient + the only query-key factory
  i18n/                Lingui runtime, polyfills, generated catalogs
  types/               ambient declarations for untyped side-effect imports
```
