# P1 Legacy Routing Matrix

| Route family | Classification | P1 treatment | Preservation evidence |
| --- | --- | --- | --- |
| `/x` | NATIVE_FACTORY_OS shell | Canonical Overview entry | Existing authenticated root route |
| `/x/sales/orders`, `/x/purchasing/orders` | LEGACY_ERP | Orders points to existing list; both remain direct links | Existing `path.to.salesOrders` / `path.to.purchaseOrders` |
| `/x/production/*`, `/x/job/*`, `/x/assembly/*` | LEGACY_ERP | Production points to existing routes; detail links remain unchanged | Existing flat routes and path helpers |
| `/x/inventory/*`, `/x/items/*`, `/x/part/*`, `/x/consumable/*` | LEGACY_ERP | Materials points to existing inventory list; detail routes remain unchanged | Existing inventory/item routes |
| `/x/quality/*` | LEGACY_ERP | Quality points to existing quality root | Existing quality route tree |
| `/x/resources/*`, `/x/maintenance/*` | LEGACY_ERP | Equipment points to existing resources root | Existing resources and maintenance routes |
| `/x/settings/*`, `/x/users/*` | ADMIN_ONLY | Administration points to company settings; existing permission filtering remains | Existing settings/users route trees |
| `/x/exceptions` | PLACEHOLDER | Honest P1 placeholder, no data or actions | New route with explicit “Not yet available in P1” copy |
| `/x/decisions` | PLACEHOLDER | Honest P1 placeholder, no data or actions | New route with explicit “Not yet available in P1” copy |
| MES `/x/operations` and other MES deep links | LEGACY_MES | Not rewritten; ERP shell does not intercept MES URLs | `path.to.external.mes` and MES app remain separate |

No route redirects, loader changes, database writes, or MES changes are part of
P1. Legacy module navigation remains visible through the existing Carbon rail.
