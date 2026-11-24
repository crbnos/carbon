---
paths: []
triggers: []
promoted: null
---
# Authenticate webhook challenges before acting on them

**Context:** Ramp webhook ownership challenges can trigger a provider callback and echo a challenge value from a tenant-addressed public endpoint.

**Problem:** Challenge extraction ran before HMAC verification and accepted an unsigned query parameter, allowing unauthenticated callers to invoke the callback path and receive an echo.

**Rule:** Verify the stored secret and signature over the raw body before handling any webhook delivery, including ownership challenges. Only authenticated bytes may supply challenge data; unsigned query parameters must never alter it.

**Applies to:** Ramp webhook verification and all provider handshakes sharing an endpoint with signed event deliveries.
