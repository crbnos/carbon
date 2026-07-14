# Manufacturing ERP Concepts

A primer for AI agents working on Carbon. Understanding these domain concepts is essential for writing correct manufacturing software.

## What Carbon Is

Carbon is an open-core manufacturing ERP (Enterprise Resource Planning) system. It helps manufacturers manage the full lifecycle of making physical products — from purchasing raw materials, through production on the shop floor, to shipping finished goods.

## Core Domain Concepts

### Items / Parts

The master data. An **item** (also called a part) is anything the company buys, makes, or sells. Items have:
- **Type**: purchased (bought from suppliers), manufactured (made in-house), or both
- **Unit of Measure (UOM)**: how the item is counted (each, kg, meters, liters)
- **Conversion Factors**: how to convert between units (1 box = 12 each)
- **Revisions**: version control for engineering changes
- **Bill of Materials (BOM)**: recipe — what sub-items and quantities make up this item

### Bill of Materials (BOM)

A BOM is a tree structure. The top-level item is the finished product. Each level lists components (sub-items) with quantities. BOMs can be multi-level: a sub-assembly has its own BOM of raw materials.

```
Finished Product (1 ea)
├── Sub-Assembly A (2 ea)
│   ├── Raw Material X (0.5 kg)
│   └── Raw Material Y (3 ea)
└── Purchased Component B (4 ea)
```

### Purchasing

The buy side. Key entities:
- **Purchase Order (PO)**: a request to a supplier for items at agreed prices
- **Receipt**: physical arrival of goods against a PO (updates inventory)
- **Supplier**: a company you buy from
- **Conversion Factors**: suppliers may sell in different UOMs than internal use

### Inventory

Tracking what you have and where. Key concepts:
- **Location**: a physical place (warehouse, shelf, bin)
- **Lot**: a batch of the same item received or produced together (for traceability)
- **Serial Number**: individual unit tracking (for high-value items)
- **Adjustment**: correcting inventory counts (damage, shrinkage, counting errors)
- **Transfer**: moving inventory between locations
- **Reservation**: holding inventory for a specific order or job

### Production / Manufacturing

The make side. Key entities:
- **Job**: an instruction to manufacture a quantity of a product (industry term: "work order" — Carbon calls it a **job**)
- **Routing**: the sequence of operations to make a product
- **Operation**: a single step in a routing (e.g., "CNC machining", "assembly", "paint")
- **Work Cell**: a station or machine where operations happen
- **Scheduling**: when operations run, considering resource capacity and dependencies

### Sales

The sell side. Key entities:
- **Quote**: a price proposal to a customer (may become an order)
- **Sales Order**: a confirmed customer order
- **Shipment**: physical delivery of goods to the customer
- **Invoice**: the bill sent to the customer

### Quality

Ensuring products meet standards. Key entities:
- **Inspection**: checking items against specifications (on receipt, in-process, or final)
- **NCR (Non-Conformance Report)**: documenting when something doesn't meet spec
- **CAPA (Corrective and Preventive Action)**: fixing the root cause of quality issues
- **ECO (Engineering Change Order)**: formal process to change a product design

### Accounting

Financial record keeping. Key concepts:
- **Chart of Accounts**: the ledger structure (assets, liabilities, equity, revenue, expenses)
- **Journal Entry**: a double-entry record (debits = credits)
- **General Ledger (GL)**: the complete record of all financial transactions
- **Fiscal Period**: accounting time boundaries (months, quarters, years)

## How Modules Connect

```
Purchasing ──receipt──→ Inventory ──issue──→ Production ──complete──→ Inventory
    │                      │                     │                       │
    ↓                      ↓                     ↓                       ↓
Accounting            Lot Tracking          Quality              Sales/Shipment
                                          Inspection                    │
                                               │                        ↓
                                               ↓                   Invoicing
                                          NCR / CAPA                    │
                                                                        ↓
                                                                   Accounting
```

## Key Invariants

These business rules are ALWAYS true in manufacturing ERP:

1. **Inventory can't go negative** (without explicit override) — you can't ship what you don't have
2. **Double-entry accounting**: every journal entry must balance (total debits = total credits)
3. **Traceability**: lot/serial tracking must be continuous from receipt to shipment
4. **BOM integrity**: circular references in BOMs are forbidden
5. **Multi-tenancy**: every record belongs to exactly one company (`companyId`)
6. **UOM consistency**: quantity operations must account for unit conversions

## Carbon-Specific Terms

| Carbon Term | Industry Term | Meaning |
|-------------|--------------|---------|
| Item | Part / SKU | A thing you buy, make, or sell |
| Job | Work Order / Manufacturing Order | Instruction to make something |
| Receipt | Goods Receipt / GRN | Physical arrival of purchased items |
| Shipment | Dispatch / Delivery | Physical sending of items to customer |
| Issue | NCR / CAPA / ECO / RMA | Quality/change management documents |
