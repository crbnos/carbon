# Lessons

One file per lesson: a mistake an agent made, and the rule that prevents it.
`pnpm brief <file>` shows a lesson before an agent edits a file in its scope.

## Format

```markdown
---
paths: ["apps/erp/app/modules/*/ui/**/*Dashboard*"]
triggers: ["purchaseInvoice", "salesInvoice"]
promoted: null
---
# Count invoices by the status the list shows, from its view

**Context:** …
**Problem:** …
**Rule:** …
**Applies to:** …
```

| Field | Meaning |
|---|---|
| `paths:` | Globs of the files the lesson applies to. |
| `triggers:` | Code text that shows the lesson's topic: a string, or `{ text, minCount }`. Each has at least 4 characters. |
| `promoted:` | Always `null` in a committed file. |

`pnpm brief` selects a lesson when its `paths:` match the file, or when a
trigger occurs in the file or in the planned edit. Each lesson has at least
one path or one trigger.

## How a lesson is added and removed

1. `/learn` records a mistake. It chooses a check if the mistake shows in the
   code text, else a rule line, else a lesson file here.
2. When a check or a rule takes a lesson over, the same commit deletes the
   lesson file.
3. A human approves the deletion of a lesson that no stronger store took over.

`packages/checks/src/brief/scopes.test.ts` fails a lesson whose frontmatter
does not parse or that has no scope.
