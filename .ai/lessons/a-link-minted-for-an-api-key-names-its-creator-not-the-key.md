---
paths: []
triggers: []
promoted: null
---
# A link minted for an API key names its creator, not the key

- **Context:** `generateDownloadToken` signs a `/download/<token>` link for a user; the route re-checks access as that user on every download. For an API key caller, `ctx.auditUserId` is the key's creator.
- **Problem:** A link without an expiry kept downloading after the key that asked for it was revoked: the creator still had access, and nothing in the token named the key. A link copied into an agent's log or transcript outlived the key.
- **Rule:** Any link or token minted for an API or MCP caller carries an expiry (`expiresInSeconds`, as `FILE_LINK_SECONDS` sets). Re-checking the named user's access is not enough when that user is not the caller.
- **Applies to:** `documents_getDocumentDownloadUrl` and any future operation that returns a shareable link, share token or signed URL to an API caller.
