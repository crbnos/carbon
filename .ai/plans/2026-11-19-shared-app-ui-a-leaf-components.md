# Shared app UI, part A: leaf components into packages

**Goal:** move eight ERP-only components that have no `~/` imports into shared
packages, so any Carbon app can import them. Each move is a move: same markup,
same classes, same behavior. ERP call sites do not change.

Part A of four. B is the record workspace (`RecordHeader`, `Panels`), C the
navigation shell, D the data table. Each is its own PR.

## Components

| ERP file | New home | Package export | `~/` deps | Other deps to check |
|---|---|---|---|---|
| `components/Empty.tsx` | `packages/react/src/Empty.tsx` | `Empty` | none | Lingui `Trans` |
| `components/Hyperlink.tsx` | `packages/react/src/Hyperlink.tsx` | `Hyperlink` | none | Lingui `Trans`, `PrefetchLink` |
| `components/VersionMenu.tsx` | `packages/react/src/VersionMenu.tsx` | `VersionMenu` | none | Lingui `Trans`, `react-router` |
| `components/SettingsPage.tsx` | `packages/react/src/SettingsPage.tsx` | `SettingsPage`, `SettingsPageHeading` | none | — |
| `components/SettingsSectionHeader.tsx` | `packages/react/src/SettingsSectionHeader.tsx` | `SettingsSectionHeader` | none | — |
| `components/ReadOnlyField.tsx` | `packages/react/src/ReadOnlyField.tsx` | `ReadOnlyField`, `ReadOnlyFields` | none | `@carbon/content/glossary` (already a dep) |
| `components/Setup/SetupSteps.tsx` | `packages/react/src/SetupSteps.tsx` | `SetupSteps` | none | `react-router` `Link` |
| `components/Modals/ConfirmDelete/ConfirmDelete.tsx` | `packages/form/src/ConfirmDelete.tsx` | `@carbon/form/ConfirmDelete` → `ConfirmDelete` | none | `@carbon/query` `useAction` |

No file has a `~/` import, so nothing becomes a prop. The only edits inside each
file are its imports: `@carbon/react` becomes the relative sibling import inside
`packages/react`, and the default export becomes a named one (the package's
convention).

### Why ConfirmDelete goes to `@carbon/form`, not `@carbon/react`

It submits through `useAction` (`@carbon/query`), which toasts a failed
service call. `@carbon/query` depends on `@carbon/react`, so importing it from
`@carbon/react` makes a cycle. Replacing `useAction` with a plain `useFetcher`
would drop that toast — a behavior change. `@carbon/form` already depends on
`@carbon/react`, is in both Lingui catalogs, and is the package for components
that post a form. It takes `@carbon/query` as a peer, like `@carbon/react`.

It is a subpath (`@carbon/form/ConfirmDelete`), not a root export, so the
`@carbon/form` root loads nothing new: academy, starter, onboarding and account
import that root and do not use the modal.

## ERP call sites

Each ERP file stays, and only re-exports the package export, so no import site
changes (`no-duplicated-app-file` allows a re-export-only file):

```ts
export { Empty as default } from "@carbon/react";
```

`components/index.ts`, `components/Modals/index.ts`,
`components/Modals/ConfirmDelete/index.ts` and `components/Setup/index.ts`
already import from those files and do not change.

## Hyperlink and the conformance baseline

`Hyperlink.tsx` is in `packages/checks/src/conformance/baseline.json` as an
ERP + MES duplicate. Once the ERP file only re-exports, the check no longer
reports it, so the entry is removed.

The MES `Hyperlink` keeps its own file: it is a different component (an
underlined link, no "Open" button). Making MES use the ERP one would change how
MES looks. `EmployeeAvatar` stays in the baseline: it imports `~/stores` and
the app's `Avatar`, and the two copies differ (MES truncates the name).

## Docs

- `packages/react/AGENTS.md`: list the new components under Key Patterns.
- `.claude/skills/carbon-design` references that cite the old paths
  (`Hyperlink`, `ConfirmDelete`, `Empty`, `SettingsSectionHeader`).
- `.ai/lessons.md` "Applies to" line for `Hyperlink`.

Historical plans, specs and runs keep their paths.

## Tasks

- [x] Create the seven `packages/react/src` files; add them to `src/index.tsx`.
- [x] Create `packages/form/src/ConfirmDelete.tsx`, the `./ConfirmDelete`
      export and the `@carbon/query` peer dependency; `pnpm install`.
- [x] Make the eight ERP files re-export only.
- [x] Remove the `Hyperlink.tsx` baseline entry.
- [x] Update the docs above.
- [x] Lingui extract + clean (strings move from `apps/erp/app` to packages
      that both catalogs read).
- [x] Verify: typecheck `@carbon/react`, `@carbon/form`, `erp`, `mes`; Biome;
      `@carbon/react` and `@carbon/checks` tests; conformance.
- [x] Local ERP smoke check: Jeremy confirmed rendering and a successful real
      delete through `ConfirmDelete` at `e4d8762a6`.
- [ ] Complete and record the before/after browser matrix: record page, list,
      settings, setup wizard and delete modal at desktop and phone widths.
      The smoke check above does not establish coverage of this full matrix.

## Verification evidence

Implementation reviewed at `e4d8762a6` against base `4efbb4ac0`:

- All eight component bodies are unchanged apart from imports and export syntax.
  Existing ERP import paths preserve default and named exports; props, handlers,
  markup and classes are unchanged. Shared exports are additive.
- Local tests passed: `@carbon/checks` 436, `@carbon/react` 203, `@carbon/form` 45.
  All 10 retained ERP CSS artifacts compare byte-for-byte equal. CSS equality
  supports visual preservation; it does not verify browser interactions.
- Recorded scoped typechecks and four app production builds passed. GitHub
  Checks run `44664256047`, attempt 2, passed. Attempt 1 timed out in the
  unchanged `QuotePDF.test.ts`; that focused test also passed locally.
- Vercel academy, carbon, carbon-us, mes and mes-us checks were canceled by
  their ignored-build rules. They are not evidence of preview builds. The
  docs preview deployed.

For the remaining browser pass, use a sales-order line with no shipments to
exercise `Empty` in its Shipments section. Generic empty tables have their own
empty-state UI. Also check `ReadOnlyField(s)` on a read-only record and
`VersionMenu` on a versioned record. Record route, viewport, commit and result
for each check; leave unobserved steps unchecked.
