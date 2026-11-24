---
paths: []
triggers: []
promoted: null
---
# Onshape individual release assets need the complete source identity

**Context:** Syncing a released part from a multi-part Part Studio to an existing Carbon item.

**Problem:** Omitting `partIds` and `configuration` exports the whole studio; `getElementThumbnail` also depicts the entire element. Refreshing raw data under the same model ID leaves successful optimized artifacts in place and allows old background jobs to overwrite repaired assets.

**Rule:** Resolve one exact released document/version/element/revision and propagate its part ID and configuration. Never fall back to a version-only match or unselected Part Studio export. Render the selected model's thumbnail after optimization. Give corrected individual-part sources deterministic immutable model generations, preserving item IDs and manufacturing records; repeat repairs reuse that generation. Repair existing items with explicit per-release events, not a company-wide backfill or new CAD releases.

**Applies to:** Onshape revision sync, backfill, model export and attachment helpers in `packages/jobs/src/inngest/functions/integrations/`.
