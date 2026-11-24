---
paths: []
triggers: ["requireNoLines", "\"Cashback\""]
promoted: null
---
# Header-only financial documents must reject persisted detail

**Context:** Card `Payment` and `Cashback` journals are derived entirely from the header amount, card account, and offset account.

**Problem:** If either document nevertheless carried coding lines, the journal builder silently ignored those rows and posted a GL entry that did not represent all persisted document detail.

**Rule:** When a financial document type is header-only, assert that its detail collection is empty before posting. Never silently discard stored financial rows merely because the current journal shape does not consume them.

**Applies to:** Card payments and cashback today, and any future header-derived posting path that accepts a shared document shape containing optional lines.
