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
