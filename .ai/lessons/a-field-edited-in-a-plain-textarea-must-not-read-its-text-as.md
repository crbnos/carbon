---
paths: ["apps/erp/app/modules/shared/shared.models.ts"]
triggers: ["optionalTiptapDoc", "optionalPlainTextDoc", "toTiptapDoc", "TiptapText("]
promoted: null
---
# A field edited in a plain textarea must not read its text as Markdown

**Context:** MCP rich-text inputs (notes, work instructions) are read as Markdown through `toTiptapDoc` / `TiptapText`. Contract notes share that input, but the app edits them in a plain `TextArea` (`ContractDetailsForm`, `ContractProperties`) and shows the saved document with `TiptapText(doc).toString()`.

**Problem:** `TiptapText(doc).toString()` drops what Markdown turned into structure. "1. Ship" became an ordered list and read back as "Ship"; "a*b*c" read back as "abc". The textarea showed the stripped text at once, and the next save stored it.

**Rule:** A rich-text field whose UI is a plain textarea read back with `TiptapText(doc).toString()` stores text as typed: `optionalPlainTextDoc` / `TiptapText(text, { format: "text" })`, not `optionalTiptapDoc` / the Markdown default. Markdown is for fields a rich editor shows, where the formatting survives.

**Applies to:** `apps/erp/app/modules/shared/shared.models.ts` (`toTiptapDoc`, `optionalTiptapDoc`, `optionalPlainTextDoc`), contract notes (`customerContractValidator`, `setContractTerm`), any new textarea over a `json` column.
