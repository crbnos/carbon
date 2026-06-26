# Extending the Implementation Hub

The hub grows on **two axes**. Keep them separate in your head:

1. **Template** (code, all customers) — the blueprint in `src/content/*`. Edit a
   registry, every company gets it.
2. **Per-customer** (DB, runtime) — overrides a company's Carbon staff layer on
   top: exclusions, fill-in field values, custom rows, tier. These live in
   Postgres and resolve in the store, never in code.

## Architecture in one breath

```
content/*   → the template (pure data: pages, steps, rows, copy, registries)
logic/*     → pure functions over template + saved state (visibility, keys, overlay)
server.ts   → Supabase reads/writes (loader + /state action call these)
ui/state/*  → the zustand store: a SERVER-DRIVEN mirror of loader data + a
              dispatch that round-trips every write to the /state action
ui/primitives/* → composable building blocks (Section, StatusToggle, …)
ui/*View.tsx    → presentational; read the store via hooks, never take data props
```

The store is **not** a client cache. The React Router loader is the source of
truth; the store mirrors it and re-hydrates on every revalidation. Writes go
`useHubActions()` → `dispatch` → `/state` action → Supabase → realtime
revalidate → loader → store. No optimistic local state.

## Recipe: add a custom-row surface (per-customer)

A list Carbon staff can extend per company (like "Data Migration → Added for
this customer").

1. **`content/collections.ts`** — add an entry: `addLabel`, `emptyText`,
   `newPayload()`, and `flag` if rows toggle a single boolean.
2. **server `/state` action** — already accepts any `collection` string; nothing
   to change unless the write needs special gating.
3. **In your view** — render it:
   ```tsx
   <CustomRowSection collection="yourKey">
     {(row) => <YourRow row={row} />}
   </CustomRowSection>
   ```
   `CustomRowSection` reads rows + canEdit from the store and wires Add to
   `newPayload()` for you. Your row body reads `useCanEdit()` / `useCheckMap()` /
   `useHubActions()` and persists per-row status with a `flagKey`/`checkKey`.

## Recipe: add an editable fill-in field (per-customer)

1. Pick a stable `fieldKey` (e.g. `"plan.goLiveTarget"`). Add its default to the
   relevant `content/*` template.
2. Render `<EditableField fieldKey=… value={fieldMap.get(key)} defaultValue=…
   onSave={…} />` (or `<EditableInput>` for a bare input).
3. Persist with `useHubActions().setField(key, value)`. The server already gates
   `setField` to internal staff; widen there if a customer-owned field is added.

## Recipe: deep-link a row to an ERP screen

The package can't import the ERP's `path.to`, so screen links are injected. The
Setup Map links each row to where you configure that thing:

1. Each setup row already has a stable `key`. Map it to a screen in
   `apps/erp/app/routes/x+/get-started+/_layout.tsx` → `SETUP_SCREEN_PATHS`
   (`"<row-key>": path.to.<screen>`). Keys with no entry render as plain text.
2. The layout passes `resolveScreenUrl` into `<HubProvider>`; any view reads it
   via `useResolveScreenUrl()` and renders a link when it returns a URL. Reuse
   this same hook to deep-link rows on any other surface.

## Recipe: add a page (template)

1. **`content/registry.ts`** — add a `PageDef` (slug, group, order, nav label,
   tiers/moduleTags for visibility). The sidebar (`useImplementationSubmodules`)
   builds itself from this — no nav edit.
2. **`content/copy.ts`** — add `PAGE_COPY[slug]` (`title`, `lead`).
3. **`ui/YourView.tsx`** — build it from primitives + store hooks; export from
   `ui/index.ts`.
4. **`apps/erp/app/routes/x+/get-started+/<slug>.tsx`** — a one-liner route:
   `export default () => <YourView />` (the layout's `<HubProvider>` feeds it).
   Carbon-only pages add a server `isInternal` redirect in their loader.

## Recipe: add a nested product step (template)

Add a `NestedProductStep` to the relevant `SPINE` step in `content/spine.ts`. If
it auto-detects from real Carbon data, add a `DetectSignal` to `types.ts` and a
probe in `server.ts:detectImplementationSignals`. Gate status overlay
(`logic/overlay.ts`) handles the rest.

## Conventions

- **Keys are forever.** Build them with the helpers in `logic/keys.ts`
  (`gateKey`, `flagKey`, `checkKey`, …); never hand-format a key string.
- **Colours/labels** for owners + statuses live in `ui/primitives/tokens.ts`.
  Don't re-declare them in a view.
- **Copy** customers read belongs in `content/copy.ts`, not in JSX.
- **`canEdit` is UX only.** The `/state` server action is the real authority on
  who may write — never trust the client flag for a security decision.
- **Visibility** (tier / module-exclusion) goes through `logic/visibility.ts`
  (`isPageVisible`, `filterByModule`). Don't re-implement the filter inline.

## Migration status

Fully on the store + primitives + copy: Data Migration, Setup Map, Requirements.
Token maps centralized in: Roles, Board. The remaining views (Scope, Value,
Plan, Go-Live, Training, Team, Controls, OnboardingHub) still take props from
their routes — migrate them with the recipes above as they're next touched.
```
