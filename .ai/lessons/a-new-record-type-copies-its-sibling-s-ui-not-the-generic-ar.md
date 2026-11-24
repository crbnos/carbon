---
paths: []
triggers: []
promoted: null
---
# A new record type copies its sibling's UI, not the generic archetype

**Context:** The lessee lease (2026-10-11) shipped a Card form on `new.tsx` that redirected to a 3-pane workspace, with Draft terms edited in the properties panel. Its siblings — the rental agreement and the AR contract — are set up in a full-page wizard (`~/components/Setup`). The user called it a big mistake, and the UI was rewritten.

**Problem:** The plan named the sibling for the server side (post-lease mirrors the rental functions) but not for the UI, and the design skill's "where create opens" rule sent a record with a workspace to a Card form. The setup wizard was documented nowhere, so the subagent that built the UI followed the generic rule faithfully.

**Rule:** Before designing a record type, name its closest sibling — the record users would call "the same kind of thing" (rental agreement ↔ lease ↔ contract; sales order ↔ purchase order; RMA ↔ supplier return) — and copy its routes and components file for file: `new`, `$id`, `$id._index`, the setup or detail routes, the module's `ui/` components. The spec and plan state the sibling and the files copied. A deviation from it is a design decision and is asked about first. When the sibling's pattern is missing from `carbon-design`, add it there in the same change (Archetype J was added for this one).

**Applies to:** `/spec-writing`, `/plan`, `carbon-design`, and any subagent prompt that builds UI.
