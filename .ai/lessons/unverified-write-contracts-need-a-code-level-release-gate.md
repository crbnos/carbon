---
paths: ["packages/ee/src/ramp/entities/bill.ts"]
triggers: ["createDraftBill"]
promoted: null
---
# Unverified write contracts need a code-level release gate

**Context:** Ramp invoice export had complete-looking draft-bill and submit code, while its monetary units, coding fields, PDF shape, and returned bill identity had not been proven against the provider.

**Problem:** A customer setting could enable a financial write path whose payload contract was still explicitly speculative, allowing production data to exercise guesses.

**Rule:** Gate an unverified external write at its lowest shared entry point before any local or remote side effect. Do not expose a customer or environment bypass; enable it only in code after contract tests pin the real request and response shapes.

**Applies to:** Ramp draft-bill export and any external financial mutation implemented ahead of live contract verification.
