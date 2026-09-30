# @carbon/content

Carbon's written content: the docs site's MDX, the manufacturing glossary, and the helpers
that turn both into something apps and agents can read. Nested in the docs app so the MDX stays
colocated with the site; the `docs/` Next app renders it, ERP/MES/packages import it.

## Layout

- `docs/**`, `guides/**` — the docs pages (Fumadocs reads them via `docs/source.config.ts`).
- `src/glossary/` — term definitions for ERP/MES field help and docs `<Term>` popovers.
- `src/corpus.ts` — MDX → plain markdown (pure; callers bring the raw text).
- `src/agent-kb.ts` — every page, stripped, for the in-app agent (Vite `import.meta.glob`).
- `src/links.ts` — `DOCS_URL` and `docUrl()`.
- `src/search.ts` — `stemInflection()`, the one stemmer for docs site search, MCP `search_tools`
  and the agent's `search_docs` (zbsearch's Porter, limited to plural/-ed/-ing/-e).

## Exports

```typescript
import { terms, getEntry, lookupEntry, type TermId } from "@carbon/content/glossary";
import { docUrl, DOCS_URL } from "@carbon/content/links";
import { stemInflection } from "@carbon/content/search";
import { parsePage, stripComponents } from "@carbon/content/corpus";   // pure, any bundle
import { agentDocs } from "@carbon/content/agent-kb";                  // Vite builds only (ERP)
```

## Always

- **Glossary terms are Lingui `msg` descriptors** (`@lingui/core/macro`) for both `term` and
  `definition`, so extraction picks them up. One crisp sentence per definition; the full story
  lives behind `href`.
- **Use `TermId` for compile-time safety** — aliases resolve at runtime via `lookupEntry`, never
  in the `TermId` union.
- **Stay isomorphic** — no fs/Node imports outside tests; `agent-kb` is reachable from ERP client bundles.
- **Keep `links.test.ts` green** — it checks every glossary `href`, every hardcoded
  `docs.carbon.ms/docs|guides` URL under `apps/*/app` and `packages/*/src`, and every internal
  MDX link against real pages and heading anchors (github-slugger rules: "A — B" → `a--b`).

## Ask First

- Adding a glossary term (it must map to a real ERP concept) or changing a term's `href`.

## Never

- Use `getTermText()`/`getDefinitionText()` in ERP/MES UI — use `i18n._(entry.term)`.
- Import `./agent-kb` from a non-Vite runtime (the docs app, Node scripts) — feed raw MDX into `./corpus` instead.
- Add `fs` or any Node-only import to runtime code — the package is isomorphic.
- Import `./agent-kb` from `@carbon/react` or other shared UI — it bundles every page.

## Validation Commands

```bash
pnpm --filter @carbon/content typecheck
pnpm --filter @carbon/content test
pnpm --filter @carbon/content lint
```
