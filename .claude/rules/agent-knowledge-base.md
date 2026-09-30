---
description: Docs MDX, the glossary and the in-app agent's doc corpus all live in @carbon/content — nothing is generated or committed separately.
paths:
  - "apps/erp/app/modules/agent/**"
  - "packages/content/**"
  - "docs/source.config.ts"
  - "docs/app/llms*/**"
---

# Docs content → site, agent, apps

`packages/content` (`@carbon/content`) is the single home for Carbon's written content. The
`docs/` Next.js app is only the renderer.

| Consumer | Reads | How |
|---|---|---|
| Docs site | `mdx/docs`, `mdx/guides` | Fumadocs `dir: "../packages/content/mdx/…"` in `docs/source.config.ts`; `turbopack.root` is the repo root so Next compiles files outside `docs/` |
| `/llms.txt`, `/llms-full.txt` | same MDX | `parsePage` from `@carbon/content/corpus` over each page's file, read in `docs/lib/corpus.ts` (not `getText("raw")`: fumadocs-mdx ≥ 15.2.1 drops the leading `../` of a content dir outside the app — fuma-nama/fumadocs#3623) |
| Docs site search (`/api/search`) | same MDX | Fumadocs `createSearchAPI` — zbsearch since `fumadocs-core` 16.14, the same engine as MCP `search_tools`; its tokenizer stems with `stemInflection` (`@carbon/content/search`) |
| In-app agent (`search_docs`, `read_doc`) | same MDX | `agentDocs` from `@carbon/content/agent-kb` — `import.meta.glob(..., { eager: true })` bakes every page into the ERP server build |
| ERP/MES field help, docs `<Term>` | `src/glossary` | `@carbon/content/glossary` |
| Anything linking to the docs | `src/links.ts` | `DOCS_URL`, `docUrl()` |

There is no generator and no committed copy: a docs edit reaches the agent at the next ERP
build, and in dev immediately (Vite watches the glob). The ERP Docker image already copies
`packages/`, so the MDX ships with it.

All three machine-readable consumers strip MDX through the one `stripComponents` in
`src/corpus.ts`, so the agent, llms.txt and anything else can never disagree about a page.

## Never

- Never import `@carbon/content/agent-kb` outside a Vite build (the docs app, Node scripts) —
  `import.meta.glob` is Vite-only. Feed raw MDX from your own source into `./corpus`'s `parsePage`.
- Never add `fs` or any Node-only import to the package — it is isomorphic on purpose;
  `agent-kb` is re-exported from a barrel client code can reach.
- Never hardcode a docs page URL without keeping `links.test.ts` green; it fails on any link to
  a missing page or heading.

## How the agent uses it

`apps/erp/app/modules/agent/agent.kb.ts` answers `search_docs` with `createDocSearch` from
`@carbon/ee/mcp` (`packages/ee/src/mcp/doc-search.ts`) — the MCP `search_tools` engine
(zbsearch BM25 + prefix, `SEARCH_ALIASES` and `stemInflection` stems via `expandQueryTerm`, one-edit typo retry) over
title/keywords/headings/description/body. It stays in `packages/ee` on purpose: the licence
split is kept, so `@carbon/content` holds the corpus and ee holds the ranking. Pinned against
the real corpus by `agent.kb.test.ts`. `read_doc` returns a page by its public URL
(`https://docs.carbon.ms/<slug>`). The agent only ever sees URLs — slugs/file paths are never
surfaced to the user.
