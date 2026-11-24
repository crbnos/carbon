---
paths: ["packages/ee/src/ramp/entities/*.ts"]
triggers: ["RampApiError", "externalIntegrationMapping"]
promoted: null
---
# Provider errors are not confirmation of the desired remote state

**Context:** Carbon retracts a pushed Ramp bill after its local invoice settles, then marks the external mapping archived so the action does not repeat.

**Problem:** The archive helper swallowed every provider error—including authentication, rate-limit, server, and not-found failures—and permanently marked the mapping archived even though no response proved the bill was gone.

**Rule:** Persist completion metadata only after a successful provider response or a specifically documented idempotent response contract. Error text, status guesses, and hoped-for remote state are not confirmation; propagate unknown failures so the workflow remains retryable.

**Applies to:** Ramp bill archival and every external integration that records a local completion flag after a remote mutation.
