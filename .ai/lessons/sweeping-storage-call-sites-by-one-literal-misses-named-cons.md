---
paths: []
triggers: []
promoted: null
---
# Sweeping storage call sites by one literal misses named-constant buckets

**Context:** The company-private-bucket migration swept every `storage.from("private")` call in the repo to per-company buckets. The literal grep found ~160 call sites and missed six more: `RAW_DURABLE_BUCKET = "private"` (assembler-client), `STORAGE_BUCKET = "private"` (company-backup/export), `BUCKET = "private"` (onshape-attach), `DOCUMENTS_BUCKET = "private"` (download.$token), `archiveBucket: "private"` (audit.config), and the `["private", "temp-staging"]` probe arrays in both apps' model.artifacts/model.download routes.

**Problem:** Each miss was a real defect, not noise — new CAD raws kept landing in the legacy bucket, backups silently skipped assets uploaded to company buckets, restores wrote assets back into the legacy bucket, and token downloads / audit-archive reads would 404 on new files once the legacy fallback is removed.

**Rule:** When migrating a string-keyed resource (a bucket, a queue, a topic), grep for the VALUE in every syntactic position — `= "x"`, `: "x"`, `"x",`, `("x"`, and type unions — not just the one call pattern you are rewriting. Constants exist precisely to hide the literal from the call site.

**Applies to:** any repo-wide sweep keyed on a string literal; storage buckets (`private`, `temp-staging`, `company-templates`), PGMQ queue names, Inngest event names.
