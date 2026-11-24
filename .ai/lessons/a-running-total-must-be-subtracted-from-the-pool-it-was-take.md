---
paths: ["packages/database/src/picked-consumption.ts"]
triggers: ["SharedTakes", "recordSharedTakes", "splitTakeByBin", "getPickedBudgets", "unclaimedRemaining"]
promoted: null
---
# A running total must be subtracted from the pool it was taken from

**Context:** The operation-completion backflush (`issue`, `issueJobOperationMaterials`) allocates every material of the operation against its lineside budgets before inserting any ledger row. A review pointed out that two materials sharing a picked item could both be offered the same unclaimed lineside stock, and asked to track what earlier materials took and subtract it from the next budget.

**Problem:** The budget's `available` was the sum of two pools — the material's OWN pick (private) and the bin's UNCLAIMED stock (shared) — and the fix subtracted a per-item running total of whole takes from that sum. Material A consuming its own private pick therefore zeroed material B's private pick, and B fell back to the warehouse while its staged stock sat at the machine. The fix was written to the reviewer's wording ("subtract it from available"), it had no test with a non-empty running total, and the follow-up review comment landed after the fix was pushed and was never re-polled.

**Rule:** When a value is a sum of pools with different sharing scopes, never subtract a merged total from it. Keep the pools apart on the type, attribute each take to a pool, and subtract a take only from the pool it came from. Every fix that adds a cross-iteration accumulator gets a pure test with the accumulator non-empty before it is committed. After pushing review fixes, re-read the PR's open threads — the reviewer's follow-up is on the FIX commit, not the original diff.

**Applies to:** `lib/picked-consumption.ts` (`SharedTakes`, `recordSharedTakes`, `splitTakeByBin`), `generatePickingList`'s `unclaimedRemaining`, `getPickedBudgets` callers, and any loop that allocates from a shared balance before persisting.
