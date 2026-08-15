# P1 Information Architecture

The IA follows Role → Object → Relationship → Process → State → Exception →
Decision → Action → Evidence → UI. P1 implements the shell and navigation frame;
it does not implement Object 360, Exception Center, or Decision workspace.

| Canonical area | P1 destination | Source / ownership | P1 state | Later dependency |
| --- | --- | --- | --- | --- |
| Overview | `/x` | Existing ERP home | Available | P2 summary and Production Order 360 entry |
| Orders | `/x/sales/orders` | ERP order routes; purchasing remains deep-linkable | Available | P2 order context |
| Production | `/x/production` | ERP production routes; MES remains separate | Available | P2 execution context |
| Materials | `/x/inventory/quantities` | ERP inventory and item routes | Available | P2 material relationships |
| Quality | `/x/quality` | ERP quality routes | Available | P3 exception evidence |
| Equipment | `/x/resources` | ERP resources and maintenance routes | Available | P3/P4 operational signals |
| Exceptions | `/x/exceptions` | Factory OS placeholder | Not yet available in P1 | P3 Exception Center |
| Decisions | `/x/decisions` | Factory OS placeholder | Not yet available in P1 | P4 Decision / AI workspace |
| Administration | `/x/settings/company` | Existing ERP settings and users | Available | Governance controls |

The canonical bar is additive. The existing Carbon module rail remains available
for accounting, purchasing, invoicing, people, documents, workflows, and other
legacy ERP areas that do not yet have a Factory OS information-architecture home.

Primary role behavior is source-backed: employees see feature entries allowed by
their existing permissions, while supplier/customer users see only permitted
destinations. P1 does not assign Executive, Planner/Manager, or Operator roles.
Future Factory OS ownership means the semantic shell owns the entry point and
context contract; the underlying record remains in ERPNext/Carbon ERP or Carbon
MES until a later phase explicitly migrates that experience.
