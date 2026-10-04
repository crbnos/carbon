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

## The inspection screen is a pivot, not a port

Web MES renders an inspection as characteristics × units — a table — beside the
drawing. Neither crosses over, so `features/inspection/` deliberately does not
look like `apps/mes/app/components/Inspection/`:

- **The grid is pivoted.** The unit strip picks ONE unit and the page lists that
  unit's characteristics. Eight characteristics across five units is forty cells,
  and at the 48pt floor for a gloved thumb that table is wider than any screen in
  the building. It is also the order an inspector works in, with one part in hand.
  Columns are still addressed by INDEX, exactly as the web grid does it, because a
  non-serial lot pre-offers one spare column whose sample row does not exist until
  the first reading is written into it.
- **The drawing is an IMAGE plus a native overlay.** `react-pdf` and
  `react-konva` are DOM-only and every RN PDF renderer is a native module, so
  `GET /inspections/:id/drawing?page=N` rasterises the page server-side
  (`renderPdfPageAsPng`, `@carbon/files/pdf/node`) and `DrawingPane` draws the
  balloons on top with `react-native-svg`. That works because balloon
  coordinates are normalized 0–1, so the same numbers land correctly over a
  page rendered at any scale — and the geometry comes from
  `@carbon/utils/balloons`, which the web pane and the plan editor also use, so
  all three put a balloon in the same place. `expo-image` fetches the page
  itself and so cannot go through the API client; `useAuth().getAccessToken()`
  exists for that one url and nothing else. The costs are real and accepted: no
  text selection, and no vector zoom past the render scale (hence 3×). Pages
  shown are the ones carrying balloons — the wire has no page count, because
  that would cost a PDF download and parse on every screen load.
- **`Partial` is not offered.** It needs every unit inspected AND, on a serial
  lot, each unit routed individually to scrap or rework — an allocation table,
  which is the thing this screen exists to avoid. `DispositionSheet` says where
  to do it instead of offering a button the server would refuse.
- **Every rule lives in `logic.ts`**, which imports no React and no
  `react-native`, so the accept/reject gates are unit-tested against the same
  numbers the server's own disposition guards use. Put new rules there, not in a
  component.
- **Per-cell writes must not refetch.** A reading keeps its own result as a local
  patch; a refetch would re-seed the cells under the inspector's thumb and lose a
  half-typed value. Only the lot-level writes invalidate.

## The assembly screen is web's three columns, stacked

`features/assembly/` is web MES's assembly view (`apps/mes/app/components/AssemblyView.tsx`)
for one column. Web puts units and progress on the left, the step in the
middle, parts and tools on the right and the timers in its header; a phone
stacks them in the order an assembler uses them — which unit (`UnitPager`),
which step (`StepsBar` + `StepCard`), what goes in (`PartsList`), with the timer
and Complete in the dock. On a tablet the step and its parts sit side by side
again.

- **One read, no assembly-specific writes.** `GET /operations/:id/assembly`
  (`useAssemblyQuery`) carries everything; every write goes through the same
  `/operations/:id/...` commands the operation screen uses, so
  `useInvalidateOperation` invalidates the assembly key too. The unit is part
  of the query key — the payload's materials are attributed to one unit — and
  `keepPreviousData` holds the last unit on screen while the next loads, with
  every action disabled until it does.
- **Every rule is in `logic.ts`, ported from web and tested**: the unit axis,
  which unit to land on, a step's done/bad state, which parts and tools a step
  shows, a unit's share of a job-wide issued total, the scan gate, when a unit
  completes itself. It departs from web in ONE place, marked where it happens:
  an operation with no steps shows the real issued quantity, because web's
  backflush mirror waits for a first step that does not exist and reads 0 for
  ever.
- **Three things happen without a tap, as on web**: recording the step on
  screen moves to the next and the first one starts Labor (`exclusive`, ending
  Setup); recording the last stops Labor; on a multi-unit operation it also
  completes the unit and moves on. None can fire on an operation with no
  steps.
- **Reports carry the PARENT's tracking.** `ReportTarget` (operations
  `logic.ts`) is what the quantity, scrap, rework, finish and quality sheets
  take on both screens; its `trackingType` selects the server's serial or batch
  completion branch. Leaving it out is silent — the untracked branch runs, no
  serial completes, nothing prints.
- **Tracked parts are issued with the UNIT as parent and the scanned part as
  child** (`trackedIssueBody`, `operations/trackedIssue.ts`), stamped with the
  step and the 1-based unit. The shelf is read over PostgREST
  (`useAvailableEntities`) with web's own query: every revision of a material,
  FEFO then FIFO, expired stock hidden under `Block`.
- **An untracked issue is `Negative Adjmt.`** (`untrackedIssueBody`). The
  names are inventory's point of view: an issue takes stock OUT. `Positive
  Adjmt.` is the return.
- **The 3D model is shown, by Filament, in its own tab.** Not three.js:
  `expo-gl` is OpenGL ES, which Apple deprecated and which current
  react-three-fiber no longer works against, and every GLB the assembler
  produces is `EXT_meshopt_compression`, whose decoder is WebAssembly — which
  Hermes does not have. Filament renders through Metal on its own thread and
  decodes meshopt in C++. It is a native module, so **this app no longer runs
  in Expo Go**: `npx expo run:ios` (ios/ and android/ are gitignored).
  Reference images on steps are still not shown; the step says so.
- **Components are addressed by NAME, which the server arranges.** A step
  names parts by `componentNodeIds`, the assembler writes those into each
  glTF node's `extras`, and Filament can only find an entity by name. So
  `GET /operations/:id/assembly/model` rewrites node names to their nodeId
  (`renameGlbNodesToNodeIds`, `@carbon/files/cad`) — the authored CAD names
  repeat, 48 spokes share one in the demo bicycle. Repeated ids get a `#1`
  suffix; the separator lives in `@carbon/mes-core`, which both sides import.
- **A step names ASSEMBLY nodes, and that bites twice.** Such a node carries
  no geometry — its descendants do. Scene membership is per entity, so hiding
  one hides nothing visible and the subtree must be hidden from the graph;
  transforms ARE inherited, so animating one moves its children. The fallback
  motion synthesis scans leaves only, so the ids are expanded to leaves before
  it is called.
- **The motion decision is web's code, not a copy.** `@carbon/viewer`'s
  `fallback`, `graph` and `types` are pure, so Metro, tsc and vitest alias
  `@carbon/viewer/*` and the app calls `synthesizeFallbackMotion` itself. The
  alias is deep-path only — the barrel and `motion.ts` pull in three.js. Only
  the per-frame offset is written here, and `direction` is the way a part
  travels to SEAT, so the offset is negative.
- **Ghosting needs TWO instances and a BLEND material.** Filament sets
  opacity per asset or per INSTANCE, never per entity, so the model is loaded
  with `instanceCount: 2`: a solid copy and a ghost copy at 0.3, each showing
  a disjoint set of parts (every ghost entity starts out of the scene, or
  everything draws twice). Instancing shares the geometry. It also needs the
  material to declare `alphaMode: BLEND` — gltfio compiles an opaque shader
  otherwise and DISCARDS alpha silently, which is why the model endpoint
  marks materials blendable. Only parts a LATER step fits are ghosted; one
  moved aside for access this step simply goes.
- **The camera is per step, and only the camera remounts.** A planner-baked
  view is applied as the orbit manipulator's home — it is fixed at
  construction and has no setter, so a changed view keys a small `CameraRig`
  and nothing else. Keying the whole scene also remounts `ModelRenderer`,
  which re-adds the asset and resets its materials. The Filament hooks mount
  only once the model is LOADED, or the manipulator is built from a
  placeholder frame (radius 1 at the origin) and the model renders off in a
  corner.
- **Scene membership is re-asserted on the next frame.** `ModelRenderer` adds
  the asset through its own effect, and on a tab switched away from and back
  — the model already in memory — that can land after ours and undo it: every
  part returns, opaque. A first visit looks perfect, so this only shows up on
  the second. Cleanups are also skipped on unmount via an `alive` ref: there
  is nothing to restore, and the asset is already released, so touching it
  throws "Pointer FilamentAssetWrapper has already been manually released".
- **Filament's `Mat4` methods PRE-multiply.** `m.translate(v)` is `T(v) · m`,
  not `m · T(v)` — verified on device, and the docblock ("multiplying the
  provided matrix with this matrix") is ambiguous enough to read either way.
  So a chain reads in the OPPOSITE order to the matrices it builds: to rotate
  about a point, call `.translate(-origin)` FIRST. Written the intuitive way
  round it pivots about `-origin` and still animates, just wrongly — proven
  by applying the composed matrix to the pivot, which a correct one leaves
  exactly where it was and the inverted one moved 280 units.
- **No step in the demo data animates, and web does not animate it either.**
  Every authored motion is `none`, and the fallback refuses to fabricate a
  path through a mate. Motion appears with planner-baked instructions.

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
- Never put a `className` on a component that is not React Native's own.
  Uniwind patches core components only; a third-party one ignores the prop in
  silence, which is how every screen in this app once rendered into a
  zero-height box with no error. Use `withUniwind()`, or the core equivalent —
  `View` + `useSafeAreaInsets()` rather than `SafeAreaView`.
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
      inspection/      an inspection operation — outside the tabs on purpose
      assembly/        an assembly operation — outside the tabs, like inspection
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
