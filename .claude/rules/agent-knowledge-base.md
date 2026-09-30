---
description: Docs MDX, the glossary and the in-app agent's doc corpus all live in @carbon/content — nothing is generated or committed separately.
paths:
  - "apps/erp/app/modules/agent/**"
  - "docs/content/**"
  - "docs/source.config.ts"
  - "docs/app/llms*/**"
---

# Docs content → site, agent, apps

`@carbon/content` is a workspace package nested in the docs app at `docs/content`: the MDX
(`docs/content/docs`, `docs/content/guides`) stays colocated with the site that renders it, and
the package exposes it plus the glossary to the apps. It is its own package (not the docs app
renamed) so ERP's `^build` never runs the Next docs build.

| Consumer | Reads | How |
|---|---|---|
| Docs site | `content/docs`, `content/guides` | Fumadocs `dir` in `docs/source.config.ts` |
| `/llms.txt`, `/llms-full.txt` | same MDX | `parsePage` from `@carbon/content/corpus` over Fumadocs' `page.data.getText("raw")` (`docs/lib/corpus.ts`). Keep the MDX inside `docs/`: fumadocs-mdx ≥ 15.2.1 drops the leading `../` of a content dir outside the app, breaking `getText("raw")` (fuma-nama/fumadocs#3623) |
| Docs site search (`/api/search`) | same MDX | Fumadocs `createSearchAPI` — zbsearch since `fumadocs-core` 16.14, the same engine as MCP `search_tools`; its tokenizer stems with `stemInflection` (`@carbon/content/search`), and a `sortBy` weights each page's title row ×2 so a page about the term beats one-word fragments that merely mention it (zbsearch ignores term frequency, so those tie) |
| In-app agent (`search_docs`, `read_doc`) | same MDX | `agentDocs` from `@carbon/content/agent-kb` — `import.meta.glob(..., { eager: true })` bakes every page into the ERP server build |
| ERP/MES field help, docs `<Term>` | `src/glossary` | `@carbon/content/glossary` |
| Anything linking to the docs | `src/links.ts` | `DOCS_URL`, `docUrl()` |

There is no generator and no committed copy: a docs edit reaches the agent at the next ERP
build, and in dev immediately (Vite watches the glob). The ERP Docker image copies
`docs/content` into its build stage (`.dockerignore` re-includes it), and `deploy.yml` fires on
`docs/content/**`, so a glossary or docs change redeploys ERP/MES.

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
