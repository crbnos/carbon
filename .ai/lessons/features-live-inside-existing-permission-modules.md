---
paths: []
triggers: []
promoted: null
---
# Features live inside existing permission modules

**Context:** Building a new feature that belongs to an existing domain (e.g., assembly instructions within production).

**Problem:** Creating a standalone module enum value / permission family (`Assembly` module with `assembly_*` permissions) for something that is really part of an existing domain. Assembly instructions belong to **production**, governed by `production_<view|create|update|delete>`.

**Rule:** Don't invent a new module/permission family for a feature that fits an existing domain. Add a sub-link in the existing sidebar group (like Procedures) and a full-screen editor in its own route tree (`x+/assembly+/$id`, `handle.module: "production"`, mirroring `x+/procedure+/`). Pattern: list route under `x+/<module>+/<plural>.tsx`, full-screen editor in a sibling `x+/<singular>+/` tree whose `_layout.tsx` declares the parent module. Module folder = permission module = nav module.

**Applies to:** New features under `apps/erp/app/routes/x+/`, `apps/erp/app/modules/`.
