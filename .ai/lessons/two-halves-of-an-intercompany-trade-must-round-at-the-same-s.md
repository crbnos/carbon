---
paths: ["packages/database/src/sales-posting-amounts.ts"]
triggers: ["calculateSalesIntercompanyAmount", "generate_intercompany_matches", "intercompanyTransaction"]
promoted: null
---
# Two halves of an intercompany trade must round at the same scale

**Context:** `post-sales-invoice` and `post-purchase-invoice` each write an `intercompanyTransaction` row, and `generate_intercompany_matches` pairs them with `src."amount" = tgt."amount"` — exact NUMERIC equality, no tolerance.

**Problem:** The seller began rounding its half at the document currency's settlement precision (2dp) while the buyer kept internal `SCALE` (5dp). A trade of 3 x 100.005 stored 300.02 against 300.015, so the pair sat `Unmatched` forever and eliminations silently never ran — consolidated income kept the intragroup profit, with no error anywhere.

**Rule:** An amount used as a MATCHING KEY is not a settlement amount. Round both halves at internal `SCALE`. Before changing rounding anywhere, check whether the value is compared for equality by something else — a matcher, a tie-out, or a reconciliation — and change both sides together.

**Applies to:** `calculateSalesIntercompanyAmount`, `post-purchase-invoice`'s IC amount, `generate_intercompany_matches`.
