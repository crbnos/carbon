---
paths: []
triggers: []
promoted: null
---
# Bind authorization to the authenticated subject

**Context:** An edge-function request carried a `userId` in its JSON body and also carried an authenticated Supabase JWT.

**Problem:** The permission helper looked up claims for the body-supplied user without proving that user matched the JWT `sub`, so a caller could borrow another user's permissions by changing one request field.

**Rule:** For an `authenticated` JWT, require a non-empty `sub`, require it to match the requested actor id, and use that subject for permission lookup. Treat body actor ids as attribution inputs only for trusted service-role/API-key flows; they are never authentication evidence.

**Applies to:** `postingCaller` / `authorizePostingCaller` (`apps/erp/app/modules/shared/shared.service.ts`) and any endpoint that accepts a caller/actor id alongside a bearer token.
