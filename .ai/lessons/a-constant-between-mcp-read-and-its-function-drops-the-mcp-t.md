---
paths: ["apps/erp/app/modules/*/*.server.ts", "apps/erp/app/modules/*/*.service.ts", "apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json", "scripts/lib/service-fn-metadata.ts"]
triggers: ["@mcp", "_PAGING"]
promoted: null
---
# A constant between `/** @mcp read */` and its function drops the MCP tool

**Context:** Cursor paging (2026-10-13) gave each paged list service an exported `*_DEFAULT_SORTS` constant. The list registry and the loaders read it, so it sits next to the service function.

**Problem:** Twice during that work, the constant went between the doc block and the function. TypeScript attaches a doc comment to the declaration directly under it, so the `@mcp read` tag then belonged to the constant. The generator reads the doc block of exported functions only (`getJsDocs()` in `scripts/lib/service-ast.ts`); it skips a constant that is not a function. The function silently stopped being a tool and left `tool-manifest.digest.json`. Typecheck, tests and the build all passed.

**Rule:** Put a new constant ABOVE the doc block of a service function, never between the block and the function. After you edit a `*.service.ts` file, run `pnpm run generate:mcp`. Then diff the tool names in `tool-manifest.digest.json`. A tool name that disappears is a displaced tag until you prove otherwise.

**Applies to:** `apps/erp/app/modules/*/*.service.ts`, `apps/erp/app/routes/api+/mcp+/lib/tool-manifest.digest.json`.
