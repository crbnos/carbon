---
paths: ["packages/jobs/src/backups/schema.ts"]
triggers: ["reportBackupCompatibility", "getCompanyBackups"]
promoted: null
---
# A verdict computed against its own input is a tautology — diff across time, at read time

**Context:** PR #1477 stored a "can this backup still be restored?" verdict (`compatibility.json`) beside each backup, written once by the export job and never refreshed. Its badge, typed-confirm gate, and no-confirm-button state were the PR's headline UX. CI was green; ~500 lines of tests passed.

**Problem:** The export computed `reportBackupCompatibility(catalog, manifest)` where the manifest had just been PROJECTED from that same catalog, in the same process. `diff(x, project(x))` is empty by construction, so the stored status was `"ready"` for every backup forever, and every downstream state driven by findings was unreachable. Nothing failed: the function was correct, the tests exercised it with hand-built drifted inputs, and only the one production call site was degenerate.

**Rule:** A comparison is only meaningful when its two sides come from different points in time or different origins. When a check's input is derived from the thing it is checked against — at the same moment, by the same code — the check can only ever pass, and green tests won't catch it because tests construct the divergent inputs the call site never produces. Compute such verdicts at READ time (live schema vs stored artifact), and when reviewing, trace where each argument of a comparison actually comes from at the real call site.

**Applies to:** `packages/jobs/src/backups/schema.ts` (`reportBackupCompatibility`), `getCompanyBackups` in `apps/erp/app/modules/settings/settings.service.ts`, and any future "is X still valid?" precomputation (schema drift, config validation, cache-freshness verdicts).
