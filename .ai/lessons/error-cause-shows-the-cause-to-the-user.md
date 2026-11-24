---
paths: ["apps/*/app/routes/_public+/**", "apps/*/app/routes/_auth+/**", "apps/*/app/routes/share+/**", "apps/*/app/routes/api+/login*"]
triggers: ["flashClientMiddleware"]
promoted: null
---
# `error(cause, …)` shows the cause to the user

**Context:** Error toasts gained a second line with the real reason. `error(cause, title)` in `@carbon/auth` now reads the cause with `describeCause` and the flash shows it (2026-10-29).

**Problem:** The change reached every app, but the sweep covered ERP and MES only. The Academy and Starter sign-in pages passed `user.error` from a `.single()` read. An unknown email then showed "No matching record was found." and an inactive account showed nothing, so an outsider could tell whether an account existed.

**Rule:** On a page an outsider can reach (sign-in, invite, verify, callback, MFA, SSO, a share link), log the real error with the module logger and pass `null` as the cause. Everywhere else, pass the real error object, never `params`, a result wrapper or a string that repeats the title.

**Applies to:** every `error(` call in `apps/*/app/routes/_public+`, `_auth+`, `share+` and `api+/login*`, and any new app that registers `flashClientMiddleware`.
