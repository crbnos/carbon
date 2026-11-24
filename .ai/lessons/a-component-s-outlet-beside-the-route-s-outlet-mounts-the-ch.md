---
paths: []
triggers: ["<Outlet", "RecordOutlet"]
promoted: null
---
# A component's outlet beside the route's outlet mounts the child route twice

- **Context:** List tables and record cards (`ApiKeysTable`, `WebhooksTable`, `SupplierProcesses`) rendered their own `<Outlet />` for their New/Edit drawers. #1855 then gave every route under `/x` a `<RecordOutlet />`, and these routes kept both.
- **Problem:** Both outlets render the same child route, so New API Key opened two modals with the same `id="name"` input. Each Radix modal set `aria-hidden` on everything outside itself, so each hid the other: screen readers and `getByRole` found no Name field, checkbox or Save button, while a sighted user saw one dialog. The per-file `no-bare-outlet` scan reads routes only, so it did not see the component's outlet.
- **Rule:** One outlet per route. A component rendered by a route that has `RecordOutlet` has no outlet of its own; adding `RecordOutlet` to a route whose table still renders `Outlet` means removing the table's. `findNestedOutlets` (`no-bare-outlet`) flags the pair across files.
- **Applies to:** every component in `modules/*/ui/` or `components/` that renders `Outlet`, and every route that renders one.
