# @carbon/content

Carbon's written content: the docs site's MDX, the manufacturing glossary, and the helpers
that turn both into something apps and agents can read. The `docs/` app only renders it.

## Layout

- `mdx/docs/**`, `mdx/guides/**` — the docs pages (Fumadocs reads them via `docs/source.config.ts`).
- `src/glossary/` — term definitions for ERP/MES field help and docs `<Term>` popovers.
- `src/corpus.ts` — MDX → plain markdown (pure). `src/corpus.node.ts` — the fs reader.
- `src/agent-kb.ts` — every page, stripped, for the in-app agent (Vite `import.meta.glob`).
- `src/links.ts` — `DOCS_URL` and `docUrl()`.

## Exports

```typescript
import { terms, getEntry, lookupEntry, type TermId } from "@carbon/content/glossary";
import { docUrl, DOCS_URL } from "@carbon/content/links";
import { parsePage, stripComponents } from "@carbon/content/corpus";   // pure, any bundle
import { readCorpus } from "@carbon/content/corpus/node";              // Node only (docs llms.txt)
import { agentDocs } from "@carbon/content/agent-kb";                  // Vite builds only (ERP)
```

## Always

- **Glossary terms are Lingui `msg` descriptors** (`@lingui/core/macro`) for both `term` and
  `definition`, so extraction picks them up. One crisp sentence per definition; the full story
  lives behind `href`.
- **Use `TermId` for compile-time safety** — aliases resolve at runtime via `lookupEntry`, never
  in the `TermId` union.
- **Keep `corpus.ts` pure** — `agent-kb` imports it and is reachable from ERP client bundles.
- **Keep `links.test.ts` green** — it checks every glossary `href`, every hardcoded
  `docs.carbon.ms/docs|guides` URL under `apps/*/app` and `packages/*/src`, and every internal
  MDX link against real pages and heading anchors (github-slugger rules: "A — B" → `a--b`).

## Ask First

- Adding a glossary term (it must map to a real ERP concept) or changing a term's `href`.

## Never

- Use `getTermText()`/`getDefinitionText()` in ERP/MES UI — use `i18n._(entry.term)`.
- Import `./agent-kb` from a non-Vite runtime (the docs app, Node scripts) — use `./corpus/node`.
- Import `./agent-kb` from `@carbon/react` or other shared UI — it bundles every page.

## Validation Commands

```bash
pnpm --filter @carbon/content typecheck
pnpm --filter @carbon/content test
pnpm --filter @carbon/content lint
```
