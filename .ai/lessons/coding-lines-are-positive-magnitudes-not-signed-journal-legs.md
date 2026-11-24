---
paths: []
triggers: ["buildChargeJournal", "buildLegacyChargeJournals", "codingLine"]
promoted: null
---
# Coding lines are positive magnitudes, not signed journal legs

**Context:** Card Charge, Credit, and Repayment documents translate positive coding allocations into debit or credit journal legs according to the transaction type.

**Problem:** Zero, negative, or non-finite line amounts could pass a header-sum check and invert or erase an individual accounting leg even though the overall entry still balanced.

**Rule:** Validate every document coding amount as finite and strictly positive before applying debit/credit semantics. A balanced journal is necessary but does not prove the document's line-level meaning is valid.

**Applies to:** Charge coding lines and other financial document builders that assign journal direction separately from stored line magnitude.
