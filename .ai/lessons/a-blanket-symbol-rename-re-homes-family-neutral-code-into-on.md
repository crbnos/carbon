---
paths: []
triggers: []
promoted: null
---
# A blanket symbol rename re-homes family-neutral code into one family

**Context:** Renaming the "Item Rules" feature to "Sales Rules" was done with a repo-wide `ItemRule` → `SalesRule` string sweep. It also caught `ItemRuleFilter` / `toItemRuleFilter` in `packages/utils` — a shared item-scoping matcher where "Item" meant *the item being filtered*, not the feature. The result was `toSalesRuleFilter`, imported by the **storage** evaluator, with a docstring still reading "Normalize a raw `storageRule` row". Nothing failed: types, tests, and lint were all green, because a wrong name is not a type error.

**Problem:** A string-match rename cannot distinguish "the feature named X" from "the noun X used as a domain word". Shared code is exactly where the two collide, and the damage is invisible to every automated gate — it only shows up when the next reader trusts the name.

**Rule:** Before a blanket rename, list the symbols that will match and check each one's *consumers*, not just its definition: a symbol used by more than one feature is shared and must get a family-neutral name (`ItemFilter`, not `SalesRuleFilter`), not the new feature's name. After the sweep, grep the renamed symbols inside the OTHER feature's directories — a hit there is the tell. Docstrings and comments are part of the rename: a comment that contradicts its symbol's new name is proof the rename was mechanical.

**Applies to:** `packages/utils/src/rules.ts`, `packages/utils/src/rule-filters.ts`, `packages/ee/src/rules/**`, any repo-wide identifier rename.
