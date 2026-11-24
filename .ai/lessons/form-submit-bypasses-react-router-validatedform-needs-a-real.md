---
paths: ["packages/form/src/components/InputOTP.tsx", "packages/form/src/ValidatedForm.tsx"]
triggers: [".submit()", "requestSubmit("]
promoted: null
---
# `form.submit()` bypasses React Router; `ValidatedForm` needs a real submitter

**Context:** `@carbon/form`'s `InputOTP` auto-submits when the last digit is typed, using `form.submit()`. On the `/mfa` and `/verify` screens the error `<Alert>` reading `fetcher.data` could therefore never render — wrong codes produced no feedback at all. Switching to a bare `form.requestSubmit()` then made the form do nothing whatsoever.

**Problem:** Two separate traps. `HTMLFormElement.submit()` does not fire the submit event, so React Router never intercepts it and `fetcher.data` stays permanently undefined — the request goes out as a raw document POST. But `requestSubmit()` with NO argument leaves `nativeEvent.submitter` null, and `ValidatedForm.handleSubmit` early-returns unless `submitter?.form === target` — so it silently does nothing.

**Rule:** Programmatic submits inside a `ValidatedForm` must pass a submitter: `form.requestSubmit(form.querySelector('button[type="submit"]'))`, which means the form needs a real submit button (good for accessibility anyway). Never use `form.submit()` in a React Router app. When a form renders errors from `fetcher.data`, verify the submit path actually reaches the fetcher — an unreachable error branch looks identical to "no errors happen".

**Applies to:** `packages/form/src/components/InputOTP.tsx`, `packages/form/src/ValidatedForm.tsx`, any auto-submitting form field.
