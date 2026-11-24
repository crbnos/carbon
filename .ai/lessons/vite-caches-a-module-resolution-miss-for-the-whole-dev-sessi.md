---
paths: ["apps/erp/app/components/**", "apps/mes/app/components/**"]
triggers: []
promoted: null
---
# Vite caches a module-resolution MISS for the whole dev session

**Context:** Added a `BatchMergePrompt` component: edited the importing file first, created the new file a moment later.

**Problem:** The SSR module graph cached the failed resolution, so every request 500'd with `Failed to load url ./components/BatchMergePrompt … Does the file exist?` even though it did. `docker exec … grep` and `ls` both confirmed the file, which sends you hunting a phantom bug in the import path.

**Rule:** Create the new module BEFORE the code that imports it. If the overlay already says "Does the file exist?" and it does, `touch` the new file and its importer to force re-resolution — the file's presence alone will not invalidate the cached miss.

**Applies to:** any new file under `apps/{erp,mes}/app` added after its importer during a running `crbn up`; the sibling failure mode for edge functions is the cached compiled isolate (`crbn reload edge-runtime`).
