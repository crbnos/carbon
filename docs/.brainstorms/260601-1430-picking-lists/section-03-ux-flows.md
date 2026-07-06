# UX Flows: Picking Lists

## ERP — Production Manager / Manufacturing Engineer

### Picking Schedule (Primary View)

Location: Inventory module, new route.

An operation-centric schedule showing only operations with outstanding pick requirements, sorted by scheduled start time.

```
Picking Schedule                                    [Location: Main Plant ▾]
──────────────────────────────────────────────────────────────────────────
☐  10:00 AM  │ WO-001 > Op 10 — CNC Mill           3 parts │ ● Not started
☐  10:00 AM  │ WO-002 > Op 10 — CNC Mill           2 parts │ ● Not started
☐  11:30 AM  │ WO-001 > Op 20 — Assembly            4 parts │ ◐ Partial
☐   2:00 PM  │ WO-003 > Op 10 — Paint Booth         1 part  │ ● Not started
──────────────────────────────────────────────────────────────────────────
[Generate Picking List]
```

- Checkbox selection for multi-operation generation
- Click row to expand and see the kit (materials, quantities, sources)
- Status indicators: Not started, Partial (some materials already picked), Complete (disappears)
- Filter by: work center, date range, job

### Picking List Detail (After Generation)

```
Picking List PL-000001                              Status: Draft
Assignee: [Select kitter ▾]        Due: 2026-06-02  [Release] [Cancel]
──────────────────────────────────────────────────────────────────────────
Kit: WO-001 > Op 10 — CNC Mill
  Part A          5 EA    Warehouse > Rack 3 > Bin 12     Pending
  Part B         10 EA    Warehouse > Rack 1 > Bin 04     Pending
  Material C    2.5 KG    Warehouse > Raw Material        Pending
    └─ Batch #2024-001 (2.5 KG)

Kit: WO-001 > Op 20 — Assembly
  Part D          5 EA    Warehouse > Rack 2 > Bin 08     Pending
  Fasteners     100 EA    Warehouse > Rack 4 > Bin 01     Pending
──────────────────────────────────────────────────────────────────────────
```

### Picking List Index

Standard list view with columns: ID, Status, Assignee, Location, Due Date, Kits (count), Progress, Created.

### Storage Unit Detail (Enhancement)

Add Work Center field:
- Directly set → editable dropdown
- Inherited from parent → readonly, muted text: "CNC Mill Area — inherited from Warehouse > Line 1"
- Not set → empty, editable dropdown

## MES — Kitter

### Picking Dashboard

Kitter sees their assigned picking lists, ordered by due date.

```
My Picking Lists
──────────────────────────────────────────────────
PL-000001  │  Due: Today     │  ████████░░  80%
PL-000003  │  Due: Tomorrow  │  ░░░░░░░░░░   0%
──────────────────────────────────────────────────
```

### Picking Execution

Kit-by-kit execution. Each kit is a collapsible section.

```
PL-000001                                         2 of 3 kits complete
──────────────────────────────────────────────────────────────────────────
✓ Kit: WO-001 > Op 10 — CNC Mill                          COMPLETE
──────────────────────────────────────────────────────────────────────────
▼ Kit: WO-001 > Op 20 — Assembly
  Deliver to: Assembly Work Center

  ┌─────────────────────────────────────────────────────────────────┐
  │ Part D                                                         │
  │ 5 EA from Warehouse > Rack 2 > Bin 08                          │
  │                                                                │
  │ Qty: [5    ]                              [Confirm] [Short]    │
  └─────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────┐
  │ Fasteners                                                      │
  │ 100 EA from Warehouse > Rack 4 > Bin 01                        │
  │                                                                │
  │ Qty: [100  ]                              [Confirm] [Short]    │
  └─────────────────────────────────────────────────────────────────┘
──────────────────────────────────────────────────────────────────────────
▶ Kit: WO-003 > Op 10 — Paint Booth                        NOT STARTED
──────────────────────────────────────────────────────────────────────────
```

For tracked entities:
```
  ┌─────────────────────────────────────────────────────────────────┐
  │ Material C (batch tracked)                                     │
  │ 2.5 KG from Warehouse > Raw Material                           │
  │                                                                │
  │ Batch #2024-001    2.5 KG    [Confirm] [Substitute]            │
  │                                                                │
  │ [Scan barcode]                                                 │
  └─────────────────────────────────────────────────────────────────┘
```

- Lines within each kit sorted by source storage unit (efficient route)
- Quantity field defaults to quantityToPick, editable for partial/short picks
- "Short" marks the line as short-picked with the entered quantity
- "Substitute" allows selecting a different tracked entity (validates same item, same storage unit)
- Barcode scanning matches to proposed tracked entities or accepts valid substitutions
