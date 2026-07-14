# @carbon/glossary

Manufacturing glossary — canonical term definitions for ERP/MES field help and docs site popovers.

## Always

- **Terms are Lingui `msg` descriptors** — use `msg` from `@lingui/core/macro` for both `term` and `definition` fields so extraction picks them up for translation.
- **Definitions are one crisp sentence** — the full explanation lives behind the `href` link. Keep entries concise and grounded.
- **Use `TermId` type for compile-time safety** — `TermId = keyof typeof terms` catches typos at the call site (e.g. `useFieldHelp("typo")` is a type error).
- **Slugs are lowercase, hyphenated** — `termSlug()` normalizes text. Aliases resolve at runtime via `lookupEntry`; canonical IDs go in `terms` object keys.

## Ask First

- Adding a new glossary term (ensure it maps to a real concept in the ERP domain)
- Changing an existing term's `href` (anchors are grounded against real docs headings)

## Never

- Add aliases to the `TermId` type union — aliases resolve at runtime, not compile time
- Write multi-sentence definitions — link to docs for the full story
- Use `getTermText()`/`getDefinitionText()` in ERP/MES UI — use `i18n._(entry.term)` for locale-aware rendering

## Validation Commands

```bash
pnpm --filter @carbon/glossary typecheck
pnpm --filter @carbon/glossary test
pnpm --filter @carbon/glossary lint
```

## Key Exports

```typescript
import { terms, getEntry, lookupEntry, hasEntry, listEntries,
         glossaryEntries, getTermText, getDefinitionText, termSlug } from "@carbon/glossary";
import type { TermId, GlossaryEntry } from "@carbon/glossary";
```

- `terms` — the glossary object (`{ [slug]: { term, definition, href?, aliases? } }`)
- `getEntry(id: TermId)` — total lookup (compile-time safe)
- `lookupEntry(slug)` — partial lookup including aliases (returns `undefined` if not found)
- `getTermText` / `getDefinitionText` — source English extraction (for non-Lingui contexts like docs)

## Cross-References

- `@carbon/react` — `LabelWithHelp` component consumes glossary entries
- `@carbon/locale` — terms use `msg` descriptors; rendered via Lingui `i18n._()` in apps
- Docs site `<Term>` component — slugifies display text to find entries
