---
paths: ["packages/jobs/src/workflows/integrations/allowlist.ts", "packages/ee/src/integrations/connections.ts"]
triggers: ["missingScopes", "requiredScopesFor"]
promoted: null
---
# Compare OAuth scopes the way the vendor REPORTS them, not the way you asked

**Context:** The Gmail allowlist row requested `["…/auth/gmail.send", "email"]`, the spelling
the Activepieces piece uses. Google's token response came back with
`openid …/auth/gmail.send …/auth/userinfo.email` — the alias canonicalised, an unrequested
`openid` added. `missingScopes(granted, required)` reported `email` missing and the account
showed "Reconnect needed" the second it connected. Google Calendar's piece has the same alias
and was never caught only because its first connections predate scope recording.

**Rule:** Every scope in an allowlist row (and anything else that feeds `requiredScopesFor`)
is spelled exactly as the vendor echoes it in the token response — for Google the full
`https://www.googleapis.com/auth/…` URL. When a piece's own list uses an alias, override
`oauth.scope` with the canonical form (same set of permissions). `oauth.test.ts` refuses
`email` / `profile` / `openid` on any row. When a "reconnect needed" appears on a freshly
connected account, diff `metadata.scopes` against `requiredScopesFor` before anything else.

**Applies to:** `packages/jobs/src/workflows/integrations/allowlist.ts` `oauth.scope`,
`packages/ee/src/integrations/connections.ts` `missingScopes`, any future vendor whose token
response normalises scope names (Microsoft returns short names for Graph scopes too).
