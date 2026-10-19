# Record switch sweep

Last tested: 2026-10-06 (38 of 38 pages the same as a fresh load; on main before the fix, 6 differed)
Script: `.ai/scripts/record-switch-sweep.py`

## What it proves
A page shown for record B after a client navigation from record A must be identical to a
fresh load of B. React Router keeps a route mounted when only its params change, so anything
seeded once from the record (a form's default values, an editor's content, a `useState` copy)
stays A's unless the page remounts. `RecordOutlet` (`@carbon/react`) remounts it; this sweep is
the proof, page by page.

## Prerequisites
- The local stack is up and a demo dataset is applied (two records of each kind are needed;
  a kind with fewer is reported as SKIP).
- `agent-browser` is signed in as `test@carbon.ms` (the auth skill).
- Do not edit source files while it runs. A rebuild under it makes pages time out and the
  run takes minutes per page instead of ~18 s.

## Steps
```bash
python3 .ai/scripts/record-switch-sweep.py              # all pages, ~15 min
python3 .ai/scripts/record-switch-sweep.py receipt part # only these
```

## Reading the result
- `same`: the page after the switch equals a fresh load.
- `DIFF`: the two lines under it are what only the switched page had and what only the fresh
  load had. `supplierId=<A>` against `supplierId=<B>` is a form still holding the previous
  record. A difference only in `heading=` with the same field count is usually content that
  had not finished loading; rerun that page alone (raise `SWEEP_WAIT`).
- To see the bug this guards, make `RecordOutlet` pass `key={undefined}` and rerun: part,
  maintenance, supplier-tax, customer-payments, receipt and shipment differ.

## Add a page
Append a row to `PAGES` in the script: name, path with `ID`, table, optional SQL filter. Add
every new record page and every tab that has a form.

## Known findings
- Receipt and shipment differed even with `RecordOutlet`: their forms have a fixed `id`, and a
  new `ValidatedForm` read the previous instance's stored values on its first render. Fixed in
  `@carbon/form` (`ownsState`).
- The shipment page logs a hydration warning on a full load (present on main).
