---
paths: []
triggers: []
promoted: null
---
# Lingui's `msg` macro forces generated translatable strings into their own file

**Context:** The generated workflow catalog needs a human label per event, and
Carbon's convention outside React is `msg` from `@lingui/core/macro`.

**Problem:** `msg` is a **build-time babel macro**. A generated file containing
one can only ever be imported by Vite-built app code — importing it from plain
Node throws, which would break the phase-3 matcher in `packages/jobs`, every
`tsx` script, and any vitest run that touches the catalog.

**Rule:** Split the artifact: `events.generated.ts` carries the runtime data and
imports nothing from `@lingui/*`; `labels.generated.ts` carries only `msg``
descriptors keyed by id and is excluded from the package barrel. Tooling that
must read the labels reads the file as **text** (regex the keys) rather than
importing it — `scripts/check-workflow-catalog.ts` does exactly that. Never put a
`label` field on the runtime type; it would always be undefined.

**Applies to:** `packages/workflows/src/catalog/`, and any future generated file
that needs both translatable strings and a Node-side consumer.
