---
paths: ["apps/erp/app/routes/x+/inspection+/$id.reject.tsx", "apps/erp/app/routes/x+/issue+/new.tsx"]
triggers: ["nonConformanceItemTrackedEntity", { text: ".insert(", minCount: 3 }]
promoted: null
---
# An unchecked supabase-js insert turns a NOT NULL violation into silence

**Context:** Inspection rejects were supposed to seed `nonConformanceItemTrackedEntity` links on the NCR's default Scrap row so the MRB could split or reassign specific entities. Nothing ever appeared. Both writers — `x+/inspection+/$id.reject.tsx` and `x+/issue+/new.tsx`'s job-operation auto-link — built their rows without `nonConformanceId`, which is `NOT NULL` on that table (`20260421130000_nc-item-tracked-entity.sql`).

**Problem:** Every such insert returned a 23502, and nobody read it. The reject route did `await (serviceRole as any).from(...).insert(rows)` and discarded the result entirely, so the feature had never worked in production and no error surfaced anywhere. supabase-js does not throw — it resolves to `{ data, error }` — so an unchecked insert is indistinguishable from a successful one, and the `as any` cast additionally hid that the row type was missing a required column. A Kysely insert in the same place would have thrown.

**Rule:** Never discard a supabase-js write result — bind it and check `.error`, even for a fire-and-forget link write. Treat `as any` on a `.from(...).insert(...)` as a defect in review: the cast exists precisely because the row object does not satisfy the generated type, which is the compiler telling you a required column is missing. When a "seeded" side table is mysteriously empty, check the writer's error handling before suspecting the read.

**Applies to:** every `.from(...).insert(...)` / `.update(...)` whose result is not bound, especially in post-commit "also link X" tails; fixed for both writers in PR #1612 by moving them into a Kysely transaction under `lockIssueDispositions`.
