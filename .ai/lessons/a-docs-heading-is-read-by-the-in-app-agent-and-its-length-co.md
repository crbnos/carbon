---
paths: ["docs/content/docs/**", "apps/erp/app/modules/agent/agent.kb.ts", "apps/erp/app/modules/agent/agent.kb.test.ts"]
triggers: ["READ_BUDGET", "read_doc"]
promoted: null
---
# A docs heading is read by the in-app agent, and its length counts against a budget

**Context:** Adding a billing cycle to rental agreements lengthened two troubleshooting headings in `docs/content/docs/reference/rental-agreements.mdx`, each quoting every variant of an error message.

**Problem:** The in-app agent's `read_doc` returns a long page as its intro plus a link per section, and `agent.kb.test.ts` caps every page and section read at `READ_BUDGET` (16,000 characters). Each heading appears twice in that list, as text and inside its anchor URL. About 1,400 characters of heading growth pushed the page over the cap and failed the ERP test suite, far from the docs package.

**Rule:** Keep a troubleshooting heading to one message. Use `…` for the part that varies and list the variants in the body. After you edit a long reference page, run `apps/erp/app/modules/agent/agent.kb.test.ts` as well as the docs checks.

**Applies to:** `docs/content/docs/**`, `apps/erp/app/modules/agent/agent.kb.ts`.
