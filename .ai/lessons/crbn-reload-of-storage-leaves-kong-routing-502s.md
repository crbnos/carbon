---
paths: ["packages/dev/src/commands/reload.ts"]
triggers: ["crbn reload", "/storage/v1/"]
promoted: null
---
# crbn reload of storage leaves Kong routing 502s

**Context:** Recreating the `storage` container (`crbn reload storage imgproxy`) after a compose edit.

**Problem:** Kong resolves upstreams via Docker DNS at proxy time but held the old container IP — every `/storage/v1/*` request returned 502 while the storage container itself was healthy and listening.

**Rule:** After `crbn reload` of any service Kong proxies (storage, auth, postgrest, edge-runtime), also run `crbn reload kong`. Verify with `curl $SUPABASE_URL/storage/v1/version` (expect 200), not with `docker ps`.

**Applies to:** `packages/dev` compose workflow, any per-service reload.
