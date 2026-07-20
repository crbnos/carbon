---
paths:
  - "packages/database/supabase/migrations/**"
  - "apps/erp/app/modules/sales/**"
  - "apps/erp/app/modules/purchasing/**"
---

# Customer & Supplier Database Schema

Customer and supplier data live in PostgreSQL (Supabase). The two families are **near-mirrors** of each other (`customer*` gated by `sales_*`, `supplier*` gated by `purchasing_*`), but with a few intentional asymmetries — see "Gotchas". When in doubt, the generated types at `packages/database/src/types.ts` are the source of truth; migrations are timestamped and the **newest one wins**.

## Core tables

### `customer` / `supplier` (main entities)
Key columns (both, unless noted):
- `id` TEXT PK (default `uuid_generate_v4()`)
- `readableId` TEXT NOT NULL — human-readable id (`CUS`/`SUP` prefix, size 6), per-company unique (`<entity>_readableId_companyId_unique`). Auto-filled by a BEFORE INSERT trigger via `get_next_sequence(...)` only when blank, so explicit values (CSV import) win.
- `name` TEXT NOT NULL — unique per company (`<entity>_name_unique`)
- `customerTypeId` / `supplierTypeId` TEXT → `customerType`/`supplierType`
- **Status differs by entity (asymmetric):**
  - `customer.customerStatusId` TEXT → **`customerStatus` table** (FK)
  - `supplier.supplierStatus` — **enum column** `supplierStatusType` = `'Active' | 'Inactive' | 'Pending' | 'Rejected'`. There is **no `supplierStatus` table** anymore (dropped in `20260309211117_supplier-status-enums.sql`).
- **Default contact pointer:** `customer.salesContactId` / `supplier.purchasingContactId` → `<entity>Contact.id` (ON DELETE RESTRICT). There is **NO `invoicingContactId`** — it was added then dropped (`20260304112615_purchasing-info.sql`).
- `defaultCc` TEXT[] — default CC email recipients
- `taxId`, `taxPercent` NUMERIC(10,5) (0..1), `currencyCode` → `currencyCode.code`
- `accountManagerId`, `assignee` → `user.id`
- `logo`, `website`, `tags` TEXT[], `customFields` JSONB
- `supplier` also has `embedding halfvec(384)` (semantic search)
- Legacy `phone`/`fax` columns still exist on the tables but are **superseded** — the views now derive phone/fax from the primary linked contact (see Views).
- `externalId` is **no longer a column** — external integration ids moved to the `externalIntegrationMapping` table (`20260130005853`); the views recompute it as a JSONB aggregate.
- Audit: `companyId` NOT NULL → `company.id`, `createdAt/By`, `updatedAt/By`.

### `customerType` / `supplierType`
`id` (default `uuid_generate_v4()`), `name` (unique per company), `protected` BOOLEAN, standard audit + `customFields`.

### `customerStatus` (table) — customer only
`id` (default `xid()`), `name` (unique per company), audit + `customFields`. Supplier's equivalent is the enum above, not a table.

## Relationship tables (customer ↔ contact ↔ location)

### `contact` (shared by both families)
`id` (default `xid()`), `firstName`, `lastName`, `fullName` (GENERATED `firstName || ' ' || lastName` STORED), `email` (**nullable** since `20251224160904`), `title`, `mobilePhone`, `homePhone`, `workPhone`, `fax`, `notes`, `isCustomer` BOOLEAN NOT NULL DEFAULT TRUE, `companyId`.
- `isCustomer` distinguishes a contact as customer-side (`true`) vs supplier-side (`false`); set at insert time.
- Contact has **no address fields** — `addressLine1/city/state/postalCode/countryCode/birthday` were dropped (`20240813152858`). Addresses live in the `address` table.
- Email is **not** uniquely constrained anymore (the partial unique index was dropped in `20260112120041`).

### `customerContact` / `supplierContact` (join: entity ↔ contact)
`id` (default `xid()`), `customerId`/`supplierId` → entity (ON DELETE CASCADE), `contactId` → `contact` (CASCADE), `customerLocationId`/`supplierLocationId` → location (nullable, SET NULL), `userId` → `user` (nullable), `tags`, `customFields`.
- Code creates a `contact` row first, then the join row (see `insertCustomerContact` in `apps/erp/app/modules/sales/sales.service.ts`, and the supplier equivalent in `purchasing.service.ts`).

### `customerLocation` / `supplierLocation` (join: entity ↔ address)
`id` (default `xid()`), `customerId`/`supplierId` (CASCADE), `addressId` → `address` (CASCADE), `name` TEXT NOT NULL (`20240813213122`), `tags`, `supplierLocation.externalId` JSONB, `customFields`.
- Unique per `(addressId, <entity>Id)` (`20250913172116`).
- Code inserts an `address` row first, then the location (`name`, `addressId`, ...).

### `address`
`id` (default `xid()`), `addressLine1/2`, `city`, `state`, `postalCode`, `countryCode` INTEGER → `country.id`, `phone`, `fax`, `companyId`.

### `customerPayment` / `supplierPayment` (1:1, PK = entityId)
`invoice<Entity>Id` (can differ for billing), `invoice<Entity>LocationId`, `invoice<Entity>ContactId`, `paymentTermId`, `currencyCode`, audit. (These invoice-contact pointers are separate from and unrelated to the dropped `invoicingContactId`.)

### `customerShipping` / `supplierShipping` (1:1, PK = entityId)
`shipping<Entity>Id`, `shipping<Entity>LocationId`, `shipping<Entity>ContactId`, `shippingTermId`, `shippingMethodId`, audit.

### `customerAccount` / `supplierAccount` (external portal users)
Composite PK `(id, companyId)`; `id` → `user.id`, `<entity>Id` → entity.

## Views: `customers` / `suppliers`
`SECURITY_INVOKER=true`. Expose entity columns plus: `type` (from type table), `status` (customer: `customerStatus.name`; supplier: the enum value directly), `orderCount` (sales/purchase orders), supplier-only `partCount` (`supplierPart`), `phone`/`fax` derived from the primary linked contact's `workPhone`/`fax`, and a recomputed `externalId` JSONB from `externalIntegrationMapping`.

## RLS
RLS is gated by company employee permissions (newest standardized policies in `20250201181148_rls-refactor.sql` for customer/contact, `20260228000000_rls-refactor-3.sql` for supplier):
- `customer`, `customerContact`, `customerLocation`: `sales_view/create/update/delete`. Customer-side SELECT also OR-in external-portal access via `get_customer_ids_with_customer_permission(...)`.
- `supplier`, `supplierContact`, `supplierLocation`: `purchasing_view/create/update/delete` (employee-only).
- `contact`: union of `sales_*` and `purchasing_*` (a contact can be either side).
- `customerPayment`/`customerShipping`/`supplierPayment`/`supplierShipping`: payment gated by the family's primary perm, shipping by `purchasing_*` (note `customerShipping` historically used `purchasing_*`).
- Child tables derive `companyId` from the parent via `get_company_id_from_foreign_key("<entity>Id", '<entity>')`.

## Triggers / side effects
- Inserting a `customer`/`supplier` auto-creates its `*Payment` + `*Shipping` rows and an org `group` + `membership`. These are now **event-system interceptors** (`sync_create_*_entries`, `attach_event_trigger('customer'/'supplier', ...)` in `20260410031801`), not the legacy `create_*_entries` triggers.
- Changes to a linked `contact`/`address` bump the parent entity's `updatedAt` (`sync_contact_to_parent` / `sync_address_to_parent`, `20260210171712`).

## Gotchas
- **No `invoicingContactId`** on `customer`/`supplier` — only `salesContactId`/`purchasingContactId`. Don't reintroduce it.
- **Status is asymmetric:** customer = FK table, supplier = inline enum. Don't assume a `supplierStatus` table exists.
- **`contact.email` is nullable and not unique.** Don't assume NOT NULL or a unique constraint.
- **`externalId` is not a column** — query `externalIntegrationMapping` (or the view's computed field).
- Some migration filenames are misleading: `20251114222648_supplier_id.sql` is about non-conformance, and `20250125121403_add-customer-and-supplier-custom-fields.sql` touches `attributeDataType`, not customer/supplier.
- The legacy `phone`/`fax` columns on `customer`/`supplier` persist but are not the display source; the views use the primary contact's phone/fax.
