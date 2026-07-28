# Agent knowledge base (auto-generated — do not edit)

Every file in this folder is generated from the docs site (`docs/content/**`) by
`scripts/generate-agent-kb.ts`. It is the read-only corpus the in-app agent searches
(`search_docs`) and reads (`read_doc`), bundled into the erp image so it ships with the app.

**Do not edit these files by hand — your changes will be overwritten.**

To update the content, edit the source docs under `docs/content/` and regenerate, then
commit the result **in the same commit** as the docs change (same model as filling `.po`
translations before committing):

```bash
pnpm run generate:agent-kb
```

The check-and-commit skill runs this automatically when `docs/content/**` or the generator
is in the change set. See `.ai/rules/agent-knowledge-base.md`.
