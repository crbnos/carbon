# New API Key and New Webhook dialogs mount twice

Settings → API Keys → New API Key opened two modals. `ApiKeysTable` rendered an `<Outlet />`. The route `x+/settings+/api-keys.tsx` rendered a `<RecordOutlet />` after the table. So the child route `api-keys.new` mounted in both outlets. The two modals had the same `id="name"` input, and each Radix modal set `aria-hidden` on the other. Assistive technology and `getByRole` found no Name field, permission checkbox or Save button. Both routes had a plain outlet before #1855, so the double mount is older than #1855.

Scope: remove each component outlet that sits beside a route outlet, and extend `no-bare-outlet` to find the pair. No schema change. No user-facing text changes.

- [x] Find the 16 components outside `routes/` that render `<Outlet>`, and the routes that render each one.
- [x] Confirm each double mount by its import, not by its name. There are 3: `ApiKeysTable` (`settings+/api-keys.tsx`), `WebhooksTable` (`settings+/webhooks.tsx`) and `SupplierProcesses` (`supplier+/$supplierId.processes.tsx`).
- [x] Keep `supplier+/$supplierId.parts.tsx` as it is. It renders the purchasing `SupplierParts`, which has no outlet. The items `SupplierParts` has the same name and does have one.
- [x] Remove the `<Outlet />` from `ApiKeysTable` and `WebhooksTable`. One route renders each of them, and that route already renders `<RecordOutlet />`.
- [x] Keep `SupplierProcesses` as it is. A separate change removes its outlet. Its route's finding goes in `baseline.json` until then.
- [x] Add `findNestedOutlets` to `no-bare-outlet.ts`. It flags a file that renders its own outlet and also a component that renders one, directly or through other components.
- [x] Make `findNestedOutlets` follow `~/` and relative imports: to a component's file, or by the file's name through a barrel above it. A default import through a folder's index matches by its local name.
- [x] Run `findNestedOutlets` from `collectFindings` under the `no-bare-outlet` id. Read `loadTypescriptFiles(root)` once for the 3 scans that use it.
- [x] Add unit tests for 6 cases: the API Keys route, the upgrade overlay that renders the table, one outlet in either place, a same-named component in another module, a default import through a folder's index, and type arguments and comments.
- [x] Prove red then green. On `main`, `findNestedOutlets` reports 5 findings on the 3 routes. Without the 2 outlet removals, the conformance gate (`run.test.ts`) fails with 4 findings. With them, it passes.
- [x] Update `.claude/rules/coding-conventions.md`, `packages/react/AGENTS.md`, `packages/checks/AGENTS.md` and `.ai/lessons.md`.

13 other components render an outlet: the receipt, shipment and warehouse transfer lines, customer and supplier contacts, locations and bank accounts, the 2 document lists, storage units and the items `SupplierParts`. Each one is the only outlet of its route, so they stay as they are.

The API Keys and Webhooks upgrade overlays render the table as a preview. Without the table's outlet, a gated company that opens `…/api-keys/new` directly no longer sees the form over the preview. The service functions still check the plan (`requireEntitlement` for API keys, `requireFeature` for webhooks).
