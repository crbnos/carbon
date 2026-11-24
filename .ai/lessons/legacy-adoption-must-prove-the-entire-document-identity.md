---
paths: []
triggers: []
promoted: null
---
# Legacy adoption must prove the entire document identity

**Context:** Ramp reimbursement retries may encounter an untracked purchase-invoice Draft created by the older non-transactional writer before its external mapping was saved.

**Problem:** A supplier/reference match alone could adopt a user document, a finalized invoice, an incomplete Draft, or a document already linked to another Ramp source; silently repairing it could overwrite ambiguous business data.

**Rule:** Legacy adoption is a narrow compatibility proof, not a fuzzy lookup. Require one unposted system Draft with the canonical external reference, matching dates/currency, intact supporting rows, exact financial/coding/provenance lines, and no conflicting mapping. Reject mismatches without mutation.

**Applies to:** Ramp reimbursement Draft adoption and any retry migration that links pre-idempotency records by business keys.
