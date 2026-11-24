---
paths: ["scripts/one-off/**", "ci/src/one-off-scripts.ts"]
triggers: ["readdirSync"]
promoted: null
---
# `scripts/one-off/` is a registry, not a folder of leftovers

**Context:** A cleanup pass listed `scripts/one-off/recopy-private-buckets.ts` as dead because nothing referenced it by name.

**Problem:** `ci/src/one-off-scripts.ts` runs every `.ts` file in that folder once per database on deploy; the folder IS the reference. Deleting a file there changes what the next deploy does.

**Rule:** "No grep hits" does not mean dead. Before deleting a script, check whether its directory is enumerated (`readdirSync`, a glob in a workflow or `turbo.json`).

**Applies to:** `scripts/one-off/`, `ci/src/one-off-scripts.ts`, any repo cleanup.
