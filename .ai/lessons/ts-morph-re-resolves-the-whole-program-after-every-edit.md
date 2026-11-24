---
paths: []
triggers: ["ts-morph"]
promoted: null
---
# ts-morph re-resolves the whole program after every edit

**Context:** The barrel-removal codemod (2026-10-16) resolved each import's target, edited it, then resolved the next one.

**Problem:** Each edit invalidates the type checker, so the next symbol lookup rebuilt the program. The script took many minutes for what should take seconds.

**Rule:** In a ts-morph codemod, resolve everything first (symbols, targets, references) into plain data, then make all the edits, then save once.

**Applies to:** scratch codemods using ts-morph over the ERP project.
