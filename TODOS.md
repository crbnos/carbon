# TODOS

## Map Onshape mass/material/vendor into real Carbon item fields

- **What:** Write the normalized engineering values (mass → item weight, material,
  vendor → supplierPart) into Carbon's own fields so costing and purchasing consume
  them, instead of display-only on the engineering page.
- **Why:** Post-v2 the data is visible but inert; making it master data is the real
  downstream payoff (costing accuracy, purchasing defaults).
- **Pros:** Onshape becomes the single source for engineering-owned fields; removes
  manual re-keying.
- **Cons:** Needs per-field conflict rules (Onshape value vs hand-edited Carbon
  value) — silently overwriting user edits is a trust-destroying failure class. The
  v2 review (D3, 2026-07-30) deliberately deferred this until the read-only view has
  proven the data in practice.
- **Context:** v2 ships `extractEngineeringFields` (stable keys in
  `externalIntegrationMapping.metadata.engineering`) + the `onshapeEngineeringData`
  view + the engineering page. The remaining work is field mapping with per-field
  opt-in and an explicit conflict policy (Onshape-wins / Carbon-wins / prompt).
  Start at the extraction fn and the view in
  `.ai/plans/2026-07-30-onshape-cad-sync-v2.md` (PR5).
- **Depends on / blocked by:** v2 PR5 shipped; the engineering data trusted by real
  usage; a conflict-policy decision with the maintainers.

## Webhook-driven engineering-data refresh (mass/material/vendor)

- **What:** On an Onshape release webhook, refresh the released item's
  mass/material/vendor automatically (today only release STATE is webhook-fresh;
  the other columns refresh on manual BOM sync).
- **Why:** Closes the last freshness gap vs the old Google Sheet tracker.
- **Pros:** Fully automatic engineering page; no manual BOM sync needed for
  current values.
- **Cons:** Requires new OnshapeClient endpoints (`massproperties` / part metadata —
  none exist today, verified 2026-07-30) and extra API calls per release against
  annual quota, for columns that rarely change after release. Also needs a
  which-BOM-context decision (a part's mass/material live per-part; vendor may be
  BOM-column-only).
- **Context:** See `.ai/plans/2026-07-30-onshape-cad-sync-v2.md` Non-goals + D15.
  The v1 design doc (`~/.gstack/projects/crbnos-carbon/leostock-feat-upload-onshape-
  assets-design-20260702-135547.md`) documents Onshape API probe findings and quota
  constraints.
- **Depends on / blocked by:** v2 shipped; evidence that stale mass/material
  actually bites users (watch for "why is mass old?" reports before building).
