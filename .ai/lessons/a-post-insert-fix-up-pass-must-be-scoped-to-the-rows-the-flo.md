---
paths: ["apps/erp/app/modules/production/production.service.ts"]
triggers: ["itemToJobMakeMethod", "buildConsumeFirstHops", "settleConsumeFirstLine"]
promoted: null
---
# A post-insert fix-up pass must be scoped to the rows the flow inserted, not to the parent entity

**Context:** `pullConsumeFirstPredecessors` in `get-method` ran after every jobMaterial insert and read `WHERE jobId = …`. Three of the four flows rebuild the whole job, so that read was equivalent — but `itemToJobMakeMethod` rebuilds ONE sub-method, and the pass rewrote lines on every other sub-method too, including rows that already had issued quantity in the successor's units.

**Problem:** A pass keyed on the parent id is correct for the flow it was written next to and silently over-broad for any flow that rebuilds a subset. Nothing fails: the rewritten row has plausible numbers and a plausible provenance column, and only the units disagree with what was already issued.

**Rule:** A fix-up pass that runs after inserts takes the inserted row ids (collect them at every insert site of every flow) and filters on them, plus a guard on any state that means "this row's units are already committed" (`quantityIssued > 0`). Never derive the candidate set from the parent entity when some caller rebuilds only part of it.

**Applies to:** `getMethod` (`apps/erp/app/modules/production/production.service.ts`) post-insert passes, any future "after all rows are in, patch some" step in the four job flows.
