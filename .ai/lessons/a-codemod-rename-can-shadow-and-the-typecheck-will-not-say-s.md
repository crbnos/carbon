---
paths: []
triggers: []
promoted: null
---
# A codemod rename can shadow, and the typecheck will not say so

**Context:** A codemod collected loop writes into new arrays, then renamed them to drop numeric suffixes.
**Problem:** Two new arrays took the name of the array their loop iterated, inside the same function. The inner `const` shadowed it, the loop walked the new empty array, and nothing was written. TypeScript accepts the shadow.
**Rule:** After a codemod declares or renames variables, scan each new name for an earlier use in the same function. Run the database tests that cover the touched writes before committing.
**Applies to:** Scripted refactors in service files.
