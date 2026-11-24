---
paths: ["packages/react/src/Button.tsx", "packages/form/src/ValidatedForm.tsx", "packages/auth/src/lib/supabase/client.ts", "packages/jobs/src/inngest/functions/notifications/send-*.ts"]
triggers: ["type=\"submit\"", "fetcher.submit", "storageReadFetch"]
promoted: null
---
# A submit button that stays live is a duplicate-write engine

**Context:** Finalizing quote Q000699 emailed the customer the same PDF three times within
one minute, same recipient list each time. The finalize action evaluates sales rules across
every line, renders a PDF, uploads it, writes a `document` row, flips the quote to `Sent`,
renders two email bodies and signs an attachment URL before it triggers the send — seconds
of wall time, during which `QuoteFinalizeModal`'s Finalize button was enabled and not even
spinning (`isDisabled={loading}`, where `loading` was the modal's own data-fetch flag).

**Problem:** Three layers of the same defect, and only the first is about a button.
(1) `fetcher.submit` aborts the previous BROWSER request; the server action it started runs
to completion regardless, because nothing in a route action reads `request.signal`. So N
clicks are N complete sets of side effects. The guard had existed as `onSubmit={onClose}`
(the modal unmounted before a second click was possible) and was dropped in `e59a9e26e2`
when closing moved to `useRuleViolations({ onSuccess: onClose })` — correct on its own, since
violations must be able to reopen the modal, but nothing replaced the guard.
(2) `@carbon/react`'s `Button` left `isLoading` out of the DOM `disabled` attribute while
`useShortcutKeys` already treated it as disabling — so a spinning button refused Enter but
still took a mouse click, and every call site guarding a submit with
`isLoading={fetcher.state !== "idle"}` was showing a spinner over a live button.
(3) `fetchWithRetry` replayed every method on a 5xx or a 25 s timeout. PostgREST commits
before it answers, so a retried insert is a duplicate row and a retried `.rpc()` re-runs a
transaction. The `quoteToQuote` incidents had already produced the rule — *"a retry wrapper
must never blindly retry a write with real side effects and no idempotency key"* — but the
fix carved out only `/functions/v1/`, leaving every PostgREST write still replaying.

**Rule:** A submit path needs a guard at each layer that can replay it. The button disables
while its own submission is in flight (`<Submit>`, or `isLoading` bound to the fetcher's
state); `ValidatedForm` drops a re-entrant submit so the form holds even when a button
forgets; a retry wrapper replays only idempotent methods; and a job retries only failures
that provably had no effect — for an SMTP send that means connect/greet/auth errors only,
never an ambiguous `ETIMEDOUT` that may have been delivered. When triaging "the operation
failed but extra copies appeared", check all four before assuming a browser double-submit.
`isDisabled` bound to any-old-boolean is not a guard: name the submit state.

**Applies to:** `packages/react/src/Button.tsx`, `packages/form/src/ValidatedForm.tsx`,
`packages/auth/src/lib/supabase/client.ts` (`fetchWithRetry`, `isReplayable` — both
since removed: database reads now use supabase-js's own retry, which never replays a
write, and only storage reads go through `storageReadFetch`),
`packages/jobs/src/inngest/functions/notifications/send-{email,slack}.ts`, and any
`<Button type="submit">` — enforced by `no-unguarded-submit` (`@carbon/checks`).
