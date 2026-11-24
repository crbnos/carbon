---
paths: []
triggers: [{"text": ".returning(", "minCount": 2}, {"text": "RETURNING", "minCount": 2}]
promoted: null
---
# Never correlate bulk-insert results by RETURNING position

**Context:** Card posting and voiding bulk-insert journal lines, then create dimensions that must reference the exact source line they describe.

**Problem:** The code paired source rows with `INSERT ... RETURNING` rows by array index, but PostgreSQL does not guarantee that returned rows preserve input order. A reordered result could attach a cost center to the wrong GL account.

**Rule:** Allocate native ids up front in one query, include them in the bulk insert, and build dependent rows from those explicit ids. Positional correlation is safe only within application-owned arrays, never across an unordered database result.

**Applies to:** Journal lines and dimensions, and any bulk insert followed by dependent rows that need source-to-result identity.
