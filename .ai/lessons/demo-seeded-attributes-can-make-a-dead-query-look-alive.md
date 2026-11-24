---
paths: []
triggers: []
promoted: null
---
# Demo-seeded attributes can make a dead query look alive

- **Context:** The supplier-return entity picker filtered `trackedEntity` on `attributes ->> Supplier`. Browser verification on the local DB showed results, so the query looked correct.
- **Problem:** No production code ever writes a `Supplier` attribute — the 49 local entities carrying it came from MCP demo seeding (Axiom/Northspoke programs). In production the picker would always be empty. Verification against hand-seeded data validated the seed, not the code.
- **Rule:** Before anchoring a query on a `trackedEntity.attributes` key, grep for the WRITER of that key in app + edge-function code (receipt tracking writes `Receipt`/`Receipt Line`/`Receipt Line Index`; shipment tracking writes `Shipment`/`Shipment Line`). If the only writers are tests or seeds, the key does not exist in production. Local rows proving a filter matches prove nothing about who writes the attribute.
- **Applies to:** any `attributes ->> X` filter on trackedEntity/trackedActivity; browser verification on a DB that has been demo-seeded.
