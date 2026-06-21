---
description: Xero Contact data structure and how Carbon maps customer/supplier <-> Xero Contact
paths:
  - packages/ee/src/accounting/providers/xero/entities/contact.ts
  - packages/ee/src/accounting/providers/xero/models.ts
  - packages/ee/src/accounting/providers/xero/provider.ts
  - packages/ee/src/accounting/core/models.ts
---

# Xero Contact Structure & Carbon Mapping

How Carbon syncs a customer/supplier to a single Xero **Contact**. One Xero
Contact backs BOTH a Carbon `customer` and `vendor` (via `IsCustomer`/`IsSupplier`
flags), so `ContactSyncer` handles both entity types. See
`accounting-sync-handlers.md` for the broader sync engine.

## Real files (provider moved to a directory)

- `packages/ee/src/accounting/providers/xero/entities/contact.ts` — `ContactSyncer`
  (extends `BaseEntitySyncer<Accounting.Contact, Xero.Contact, "UpdatedDateUTC">`).
  Holds the bidirectional mapping (`mapToRemote` / `mapToLocal`) and the DB upsert.
- `packages/ee/src/accounting/providers/xero/models.ts` — `Xero.ContactSchema`
  (zod), `Xero.Contact` type, plus helpers `parseDotnetDate`, `transformXeroPhones`,
  `transformXeroContact`.
- `packages/ee/src/accounting/providers/xero/provider.ts` — `XeroProvider`: OAuth2
  client, `request()`, `listContacts()`.
- `packages/ee/src/accounting/core/models.ts` — Carbon-side `ContactSchema`
  (exposed as `Accounting.Contact` in `core/types.ts`).

(The old `providers/xero.ts` single file no longer exists; ignore any reference to
a `barbinbrad` home path.)

## Xero Contact shape (`Xero.ContactSchema`)

```ts
{
  ContactID: string (uuid)
  ContactStatus: "ACTIVE"          // z.literal — only ACTIVE is modeled
  Name: string                     // unique across active Xero contacts
  Website?: string                 // SUPPORTED via API (see gotcha below)
  FirstName?, LastName?: string
  EmailAddress?: string (email)
  TaxNumber?: string
  DefaultCurrency?: string
  IsCustomer: boolean
  IsSupplier: boolean
  Phones: Phone[]                  // typed by PhoneType, NOT positional
  Addresses: Address[]             // full array mapped both ways
  UpdatedDateUTC: string           // serialized .NET "/Date(...)/" — parse it
  ContactGroups, ContactPersons: unknown[]
  HasAttachments, HasValidationErrors: boolean
  // optional: ContactNumber, BankAccountDetails, AR/AP TaxType,
  //           BrandingTheme, BatchPayments, Balances
}
```

`Phone`: `{ PhoneType: "DDI" | "DEFAULT" | "FAX" | "MOBILE"; PhoneNumber?; PhoneAreaCode?; PhoneCountryCode? }`
(NOTE: no `WORK`/`HOME` — those do not exist.)

`Address`: `{ AddressType: "POBOX" | "STREET" | "DELIVERY"; AddressLine1..4?; City?; Region?; PostalCode?; Country?; AttentionTo? }`

`UpdatedDateUTC` is a serialized .NET date like `/Date(1234567890000+0000)/`;
`getRemoteUpdatedAt` runs it through `parseDotnetDate` (regex strips to epoch ms).

## Phone mapping is by TYPE, not array position

Carbon does NOT take `Phones[0]`. It maps by `PhoneType`:

| Xero `PhoneType` | Carbon field |
|---|---|
| `DEFAULT` | `workPhone` |
| `MOBILE`  | `mobilePhone` |
| `FAX`     | `fax` |
| `DDI`     | `homePhone` |

`mapToLocal` uses `phones.find(p => p.PhoneType === type)`. `mapToRemote` builds the
`Phones[]` array conditionally, pushing one entry per non-empty Carbon phone field.

## Carbon `Accounting.Contact` shape (target of `mapToLocal`)

From `core/models.ts` `ContactSchema`: `id, name, firstName, lastName, companyId,
email?, website (nullable url), taxId (nullable), currencyCode (default "USD"),
balance/creditLimit/paymentTerms (nullish), updatedAt, workPhone/mobilePhone/fax/
homePhone (nullable), isVendor, isCustomer, addresses[], raw`.
Carbon address item: `{ label, type, line1, line2, city, country, region, postalCode }`
(all nullish). There is **no `isActive` field** on the Carbon contact.

## DB <-> Contact (local fetch / upsert)

`ContactSyncer` reads/writes real Carbon tables (not a single contact table):
- **Fetch local** (`fetchCustomersByIds`/`fetchSuppliersByIds`): joins
  `customer`/`supplier` -> `*Tax` (`taxId`) -> `*Location` -> `address` ->
  `*Contact` junction -> `contact` (first linked contact's name/email/phones).
  `workPhone` falls back to `customer.phone` if the contact has none.
- **Upsert local** (`upsertLocal`): upserts the `customer`/`supplier` row +
  `*Tax` row, then upserts the linked `contact` person via the
  `customerContact`/`supplierContact` junction. `isVendor` is
  `data.isVendor && !data.isCustomer`. Phones are written back onto the `contact`.

## ID mapping (two rows per Xero contact)

External IDs live in `externalIntegrationMapping` via `createMappingService`, keyed
on `entityType` (`"customer"` / `"vendor"`). `getRemoteId`/`getLocalId` check BOTH
customer and vendor. A contact that is both customer and supplier gets two distinct
mapping rows (unique index includes `entityType`).

## Auth & request

`XeroProvider` (`provider.ts`): OAuth2 against `https://identity.xero.com/connect/token`,
base URL `https://api.xero.com/api.xro/2.0`. Every request sends
`Authorization: Bearer <token>` + `xero-tenant-id` header. On `401` it refreshes the
token once and retries. OAuth scopes (`packages/ee/src/xero/config.tsx`):
`offline_access`, `accounting.contacts`, `accounting.transactions`,
`accounting.settings`.

Contact endpoints used:
- `GET /Contacts/{id}`, `GET /Contacts?IDs=a,b,c` — fetch.
- `GET /Contacts?where=Name=="..."` — smart match by exact name before creating
  (Xero enforces unique active contact names; quotes are escaped).
- `POST /Contacts` `{ Contacts: [...] }` — create/update (also batch). Response
  `Contacts[i].ContactID` is the external ID stored back.
- `listContacts()` paginates (100/page; `hasMore` = page is full) and filters
  `where=IsCustomer==true OR IsSupplier==true` to skip address-book-only contacts.

## Gotchas / corrections vs. stale assumptions

- **Phones are typed, not positional** — never read `Phones[0]`.
- **`Website` IS supported** by the Xero API and is synced both ways. (Old doc
  claimed it was unsupported — false.)
- **Whole `Addresses` array** is mapped both directions, not just the first.
- `ContactStatus` is only ever `"ACTIVE"` in the model; Carbon does not derive an
  `isActive` boolean from it.
- `firstName`/`lastName` default to `""` (Xero company contacts often have neither);
  on local upsert, blank `firstName` falls back to the entity `Name`.
- Sync writes go through `withTriggersDisabled` to avoid the sync->trigger->sync loop.
