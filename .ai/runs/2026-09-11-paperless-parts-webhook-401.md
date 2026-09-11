# Bugfix run: Paperless Parts webhook 401 regression

- Date: 2026-09-11
- Mode: fully-autonomous
- Request: "a customer tried syncing their quotes from paperless parts to carbon, and got a 401 error. this has worked in the past (as recently as a day ago)"
- Phase plan: root-cause [run] · instrument [skip — deterministic reproduction] · fix [run] · test [skip — regression test covers the pure signature logic] · commit [skip — not explicitly requested]

## Decisions

- Production probe: an unsigned POST to the reported company endpoint returned 401, proving the integration row and vaulted credentials resolve before signature verification.
- Runtime instrumentation: skipped — escaped-Unicode payload deterministically reproduces the HMAC mismatch locally.
- Browser test: skipped — this is a pure server-side signature check covered by the route regression test.
- Commit: skipped — not explicitly requested.

## Phase log

- root-cause: HIGH confidence in a deterministic raw-body corruption defect; MEDIUM-HIGH confidence it caused this exact incident. Brief: `.context/paperless-parts-webhook-401-root-cause.md`.
- fix: verified the HMAC against `request.text()` before parsing, retained the historical normalized fallback, and added non-sensitive rejection-category logging.
- regression: RED on unchanged code (`expected { success: true }`, received HTTP 401); GREEN after fix (3/3 Paperless tests).
- verification: webhook suite 11/11 PASS; Biome 2 files PASS; ERP typecheck PASS after generating missing React Router route types.

## Outcome

- READY — fix and regression coverage are complete; no commit or deployment was requested.
