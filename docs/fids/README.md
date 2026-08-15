# Factory Industrial Design System (FIDS)

FIDS gives Factory OS a typed semantic UI layer for manufacturing objects, state, risk, exceptions and evidence. It sits on existing Carbon UI primitives and theme tokens.

FIDS is not a replacement component library, a new theme engine, an ERP/MES workflow, or a dashboard template. ERPNext remains the system of record; Carbon MES remains the execution system; Factory OS provides industrial experience, ontology, decision support and governance.

## Adding a semantic component

1. Work through Role → Object → Relationship → Process → State → Exception → Decision → Action → Evidence → UI.
2. Inventory the relevant shared primitive and real usages.
3. Record REUSE, WRAP, BUILD or DEFER in the matrix.
4. Define conservative typed semantics, visible unknown behavior and evidence boundaries.
5. Compose `@carbon/react` primitives; do not recreate buttons, cards, dialogs or tables.
6. Add focused tests, showcase cases and accessibility/responsive evidence.

The first five P0 components are exported by `@carbon/react`. The isolated QA surface is `contrib/building/examples/fids-showcase`; it is not linked into ERP or MES navigation.

## P0.5 contract architecture

```text
ERPNext / Carbon MES source values
          ↓
Pure source adapters (`@carbon/utils`)
          ↓
FactoryObject / FactoryException / EvidenceRecord
          ↓
FIDS components (`@carbon/react`)
          ↓
Factory OS experiences
```

Contracts preserve source references and raw states. They do not replace source models, contain React nodes, perform network calls, or infer unresolved business mappings. Add a new adapter only for a validated source shape and mark unknown values explicitly.

## P1 experience shell

FIDS v1 now sits inside a Factory OS experience shell that is additive to the
existing Carbon ERP frame. The shell establishes canonical navigation across
Overview, Orders, Production, Materials, Quality, Equipment, Exceptions,
Decisions, and Administration while preserving legacy ERP and MES deep links.

P1 deliberately stops at the shell boundary. Exceptions and Decisions are
honest placeholders, and the global object-context slot remains empty until the
validated Production Order 360 work begins in P2. See:

- `P1_Experience_Shell_Audit.md`
- `P1_Information_Architecture.md`
- `P1_Legacy_Routing_Matrix.md`
- `P1_Product_Identity.md`
- `P1_Role_Context.md`
- `P1_Global_Object_Context.md`
- `P1_Migration_Notes.md`

## P2 production-order domain gate

The P2 gate is a read-only source and relationship audit. It does not implement
Production Order 360. The gate reports whether an evidence-backed ERPNext →
Carbon MES chain exists before any P2 experience work begins:

- `P2_Production_Order_Source_Model_Audit.md`
- `P2_Production_Order_Identity_Mapping.md`
- `P2_Production_Order_Status_Mapping.md`
- `P2_Operation_Mapping.md`
- `P2_Production_Order_Profile.md`
- `P2_Adapter_Gap_Analysis.md`
- `P2_Domain_Confirmation_Backlog.md`
- `P2_UI_Readiness_Contract.md`
- `P2_Final_Acceptance_Report.md`

The current audit finds a confirmed external ERPNext Work Order schema and a
confirmed Carbon-internal Job → Job Operation chain, but no runtime
cross-system correlation key or ingestion path. The resulting gate is
`P2_BLOCKED`; no P2 UI or adapter implementation is authorized by this audit.
