# Production Order Mapping MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a small, pure Factory OS ProductionOrder mapping contract that keeps ERPNext planning and Carbon MES execution separate, merges only explicit lineage, and proves safe unknown/unlinked/conflict/1-1-0 behavior.

**Architecture:** Extend the existing `@carbon/utils` FIDS contract layer; do not create a second ontology framework. ERPNext and Carbon projections remain source-specific, `FactoryProductionOrder` is an experience projection, and an explicit lineage record is required before merging. The registry, validation, fixtures and tests are all pure TypeScript with no I/O.

**Tech Stack:** TypeScript, Vitest, existing `FactoryObject`/`SourceReference`/`EvidenceRecord`, pnpm workspace.

## Global Constraints

- Do not implement Production Order 360, Exception Center, AI recommendation, governed actions, event bus, sync service, reconciliation engine, new DB/schema/service, ERP workflow, MES workflow, P1 shell or P2 UI.
- Keep `Factory ProductionOrder ID ≠ ERP Work Order.name ≠ Carbon Job.id`.
- Never fuzzy-match by name, item, date or quantity.
- Missing mapping → `unknown`; missing lineage → `unlinked`; conflicting authoritative values → `conflict`; missing aggregation semantics → undefined canonical metric.
- Never define `completedQuantity = job.quantityComplete` without proof; preserve the 1/1/0 regression.
- Use only `pnpm`; keep `@carbon/utils` pure and synchronous.

### Task 1: Freeze MVP contract and write failing tests

**Files:**
- Create: `packages/utils/src/production-order-mapping.test.ts`
- Modify: none before the failing test run

**Interfaces under test:**
- `projectErpNextWorkOrder`
- `projectCarbonMesJob`
- `mergeProductionOrderProjections`
- `validateProductionOrderMappings`
- `productionOrderGoldenPathFixtures`

- [ ] **Step 1: Write tests for ERP-only, MES-only, explicit merge, unlinked, conflict and distinct IDs.**
- [ ] **Step 2: Write tests for authority separation, unknown status, operation unresolved lineage and source immutability.**
- [ ] **Step 3: Write the mandatory aggregate=1 / operation=1 / job=0 fixture assertion: canonical completed quantity and progress remain undefined.**
- [ ] **Step 4: Run `pnpm --filter @carbon/utils exec vitest run src/production-order-mapping.test.ts`; expect failure because the contract is not implemented.**

### Task 2: Implement pure ProductionOrder projections and explicit lineage merge

**Files:**
- Create: `packages/utils/src/production-order-mapping.ts`
- Modify: `packages/utils/src/index.ts`

**Interfaces:**
- `ErpNextWorkOrderSource` → `ProductionOrderProjection` with planning authority.
- `CarbonMesJobSource` → `ProductionOrderProjection` with execution authority.
- `ProductionOrderLineage` with `status: "confirmed" | "unlinked" | "conflict" | "unknown"`.
- `mergeProductionOrderProjections(erp, mes, lineage?)` returns a discriminated result and merges only `confirmed` lineage whose source IDs match exactly.

- [ ] **Step 1: Add source/projection types that use existing `SourceReference` and `FactoryObjectRef` concepts.**
- [ ] **Step 2: Implement deterministic, source-distinct Factory IDs and preserve raw state/optional values.**
- [ ] **Step 3: Implement ERP projection without execution inference and MES projection without ERP inference.**
- [ ] **Step 4: Implement authority-aware merge; explicit conflict/unlinked results must retain both projections and never choose first/last/larger/newer.**
- [ ] **Step 5: Export the module from `packages/utils/src/index.ts`.**
- [ ] **Step 6: Run the focused tests and make them pass.**

### Task 3: Add mapping registry and validation

**Files:**
- Modify: `packages/utils/src/production-order-mapping.ts`
- Modify: `packages/utils/src/production-order-mapping.test.ts`

**Interfaces:**
- `ProductionOrderMappingDefinition` carries `source`, `target`, `authority`, `transform`, `confidence`, `status`.
- `productionOrderMappingRegistry` contains only identity, display name, item reference, planned/execution quantities, status, dates, due/required date, operations and source references.
- `validateProductionOrderMappings(entries)` reports `active`, `authorityDefined`, `transformDefined`, `confidenceKnown`, and `errors`.

- [ ] **Step 1: Add tests for active confirmed mappings, confirmation-required mappings and unknown source fields.**
- [ ] **Step 2: Implement registry and pure validation with no inferred defaults.**
- [ ] **Step 3: Run the focused tests and package typecheck.**

### Task 4: Add exactly three sanitized schema fixtures

**Files:**
- Create: `packages/utils/src/production-order-mapping.fixtures.ts`
- Modify: `packages/utils/src/production-order-mapping.test.ts`

**Interfaces:**
- Export `productionOrderGoldenPathFixtures` with exactly `normalLinked`, `partialCompletion`, `quantityRegression`.
- Each fixture is labeled `SCHEMA_VALIDATED_FIXTURE` and `NOT_PRODUCTION_RECORD`.

- [ ] **Step 1: Create synthetic, non-PII ERP Work Order / Carbon Job / JobOperation values with explicit source refs.**
- [ ] **Step 2: Make A use confirmed explicit lineage, B preserve distinct planned/execution metrics, and C encode 1/1/0 without canonical completion/progress.**
- [ ] **Step 3: Assert fixture count, labels, source refs and safety behavior.**

### Task 5: Write ontology documentation and QA report

**Files:**
- Create: `docs/ontology/Production_Order_Mapping_MVP_Audit.md`
- Create: `docs/ontology/Production_Order_Authority_Matrix.md`
- Create: `docs/ontology/Production_Order_Identity_Contract.md`
- Create: `docs/ontology/Production_Order_Mapping_Registry.md`
- Create: `docs/ontology/Production_Order_Operation_Lineage.md`
- Create: `docs/ontology/Production_Order_Quantity_Contract.md`
- Create: `docs/ontology/Production_Order_Golden_Path_Fixtures.md`
- Create: `docs/ontology/Production_Order_Mapping_MVP_QA.md`

- [ ] **Step 1: Record that no separate ontology module exists and the FIDS utility contract is the extension point.**
- [ ] **Step 2: Document authority, identity, registry, lineage, quantity and fixture semantics from code/tests only.**
- [ ] **Step 3: Document exact validation commands and whether the environment permits them.**

### Task 6: Verify, commit or report blocked

**Files:**
- Modify: `docs/ontology/Production_Order_Mapping_MVP_QA.md` with final command output.

- [ ] **Step 1: Run `pnpm exec biome check packages/utils/src/production-order-mapping.ts packages/utils/src/production-order-mapping.fixtures.ts packages/utils/src/production-order-mapping.test.ts`.**
- [ ] **Step 2: Run `pnpm --filter @carbon/utils typecheck`.**
- [ ] **Step 3: Run `pnpm --filter @carbon/utils test`.**
- [ ] **Step 4: Run `git diff --check` and inspect `git status --short`.**
- [ ] **Step 5: If focused tests, typecheck and lint pass, commit only this MVP with `feat(factory-os): add production order mapping MVP`; otherwise keep the exact failure evidence and use a `PARTIAL`/`P2_BLOCKED` result.**

## Self-review checklist

- [ ] No test uses a real production record, credential, customer PII or service secret.
- [ ] Exactly three fixtures exist.
- [ ] No unlinked or conflicting sources merge.
- [ ] No canonical progress is fabricated for 1/1/0.
- [ ] No production route, UI, DB schema, service or workflow changed.
- [ ] Final report follows the attachment's 18-section format and stops after the gate.
