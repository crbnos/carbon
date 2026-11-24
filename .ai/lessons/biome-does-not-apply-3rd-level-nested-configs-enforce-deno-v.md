---
paths: ["biome.jsonc", "packages/biome.jsonc"]
triggers: ["noConsole"]
promoted: null
---
# Biome does not apply 3rd-level nested configs — enforce Deno via an override

**Context:** Bringing Supabase edge functions (`packages/database/supabase/functions/**`, Deno) into Biome's lint surface for the new `noConsole` rule. These files sit outside the linted globs (`apps/*/app/**`, `packages/*/src/**`) and were never Biome-formatted.

**Problem:** A dedicated nested `functions/biome.jsonc` (root:false, formatter off, noConsole only) is silently ignored. Biome applies the depth-1 nested config (`packages/biome.jsonc`) for the whole `packages/` subtree; a depth-2 nested config under it never governs — the `format` diagnostic keeps appearing and `formatter.enabled:false` has no effect. Letting `packages/biome.jsonc` (which `extends "//"`) govern the Deno files directly produces ~270 CI-failing errors (Deno globals → `noUndeclaredVariables`, `useImportType`, `organizeImports`, formatting) on never-linted code.

**Rule:** Do not rely on 3-level Biome config nesting. Add the target path to the depth-1 config's `files.includes`, then scope an `overrides` entry there (glob relative to that config) that turns off `formatter`/`assist` and the Node-oriented error rules (`correctness.noUndeclaredVariables`, `noUnusedVariables`, `style.useImportType`) while inheriting the one rule you want (`noConsole` as a warning). Verify with `pnpm exec biome check --reporter=summary <dir>` expecting 0 errors. See `packages/biome.jsonc`.

**Applies to:** `biome.jsonc` / `packages/biome.jsonc` rule scoping; any attempt to lint Deno edge functions or other non-`src/` trees.
