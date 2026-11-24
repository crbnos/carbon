---
paths: []
triggers: []
promoted: null
---
# A new key in an Inngest step's return breaks runs in flight at deploy

**Context:** The `notify` function's step `filter-recipients-by-preference` returned `{ emailRecipientIds, slackRecipientIds }`. Browser notifications added `pushRecipientIds` to the same step, under the same step id, and the code after it read `pushRecipientIds.length` (2026-10-08).

**Problem:** Inngest replays a completed step from its memoized output. A run that started before the deploy and resumes after it gets the OLD output, with no `pushRecipientIds`, so `.length` throws and the notification fails. Typecheck cannot see it: the type describes the new code, not the stored output. Self-review caught it before merge.

**Rule:** When a step's return grows a key, read that key with a default (`pushRecipientIds = []`) and comment why, or rename the step id so old runs re-execute it (only when the step is idempotent). Never assume a memoized step output has the current shape. (The `pushRecipientIds` key was removed again later, when push stopped having a per-topic switch; the example stays as the pattern.)

**Applies to:** every `step.run` in `packages/jobs/src/inngest/functions/**` whose return shape changes.
