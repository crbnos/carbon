---
paths: []
triggers: []
promoted: null
---
# One OAuth state mechanism: the cookie helper, consumed by value for a shared callback

**Context:** The workflow pieces (Slack, Gmail, Google Calendar) signed their own OAuth state with an HMAC helper in `settings.service.ts`, beside the cookie-bound state that every other integration uses (`@carbon/auth/oauth-state.server`).

**Problem:** Two mechanisms meant two sets of binding, expiry and single-use rules to keep correct, and a review had to check both. The pieces share one callback route, so that route cannot know which integration's entry to consume before it reads the state.

**Rule:** Issue every OAuth state with `issueOAuthState`. Carry extra facts (`mode`, `name`, `connectionId`) as `OAuthStateExtras`, never in the query string. Pass the request, so the other integrations' pending entries survive the Set-Cookie. A callback that serves several integrations calls `consumeOAuthStateByValue`; it finds the entry that holds the value and takes the integration id from that entry. Do not add a second signer.

**Applies to:** `api+/integrations.connections.$piece.connect.ts`, `api+/integrations.connections.callback.ts`, `api+/integrations.$id.connect.ts`, and any new OAuth connect or callback route.
