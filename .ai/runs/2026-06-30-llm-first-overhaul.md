# LLM-First Overhaul — Run Plan

## Goal
Make Carbon LLM-first by design, implementing a comprehensive `.ai/` knowledge system inspired by Open Mercato's architecture.

## Issue
Self-assigned — architectural improvement

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Foundation
- [x] 1.1 Create `.ai/` directory structure
- [x] 1.2 Create `.ai/lessons.md` (prescriptive institutional memory)
- [x] 1.3 Upgrade root AGENTS.md with Task Router
- [x] 1.4 Create `.ai/specs/AGENTS.md` (spec lifecycle rules)
- [x] 1.5 Create `.ai/specs/template.md` (spec template)
- [x] 1.6 Create `.ai/docs/module-conventions.md`

### Phase 2: Package-Level AGENTS.md
- [x] 2.1 packages/database/AGENTS.md
- [x] 2.2 packages/react/AGENTS.md
- [x] 2.3 packages/form/AGENTS.md
- [x] 2.4 packages/lib/AGENTS.md
- [x] 2.5 packages/auth/AGENTS.md
- [x] 2.6 packages/jobs/AGENTS.md
- [x] 2.7 packages/notifications/AGENTS.md
- [x] 2.8 packages/documents/AGENTS.md
- [x] 2.9 packages/config/AGENTS.md
- [x] 2.10 packages/env/AGENTS.md
- [x] 2.11 packages/locale/AGENTS.md
- [x] 2.12 packages/utils/AGENTS.md
- [x] 2.13 packages/onboarding/AGENTS.md
- [x] 2.14 packages/checks/AGENTS.md
- [x] 2.15 packages/harness/AGENTS.md
- [x] 2.16 packages/dev/AGENTS.md
- [x] 2.17 packages/kv/AGENTS.md
- [x] 2.18 packages/tiptap/AGENTS.md
- [x] 2.19 packages/stripe/AGENTS.md
- [x] 2.20 packages/printing/AGENTS.md
- [x] 2.21 packages/glossary/AGENTS.md
- [x] 2.22 packages/ee/AGENTS.md

### Phase 3: Module-Level AGENTS.md
- [x] 3.1 apps/erp/app/modules/purchasing/AGENTS.md
- [x] 3.2 apps/erp/app/modules/inventory/AGENTS.md
- [x] 3.3 apps/erp/app/modules/production/AGENTS.md
- [x] 3.4 apps/erp/app/modules/items/AGENTS.md
- [x] 3.5 apps/erp/app/modules/quality/AGENTS.md
- [x] 3.6 apps/erp/app/modules/sales/AGENTS.md
- [x] 3.7 apps/erp/app/modules/accounting/AGENTS.md
- [x] 3.8 apps/erp/app/modules/people/AGENTS.md
- [x] 3.9 apps/erp/app/modules/resources/AGENTS.md

### Phase 4: Safety & Quality
- [x] 4.1 Create BACKWARD_COMPATIBILITY.md
- [x] 4.2 Create `.ai/ds-rules.md`

### Phase 5: QA & Domain
- [x] 5.1 Create `.ai/qa/AGENTS.md`
- [x] 5.2 Create `.ai/docs/manufacturing/erp-concepts.md`

### Phase 6: Final
- [ ] 6.1 Commit and push
- [ ] 6.2 Open PR
