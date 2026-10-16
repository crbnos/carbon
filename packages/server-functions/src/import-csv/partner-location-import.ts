// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Customer and supplier locations (`customerLocation`, `supplierLocation`).
// Mirrors the New Location drawer on a customer's or supplier's Locations tab:
// `customerLocationValidator` / `supplierLocationValidator` (a name plus the
// shared address fragment) and `insertCustomerLocation` /
// `insertSupplierLocation`, which insert the address row and then the
// location row.
//
// Re-importing matches a location by partner and name, ignoring case and
// surrounding spaces, and updates that location's address as the edit drawer
// does (`updateCustomerLocation` / `updateSupplierLocation` replace the
// address fields, a blank one with NULL; with `keepSavedValues`, the MCP
// import, a blank one is left as it is). A column the file does not map is
// left as it is. The name is never changed, and the customer and supplier
// imports' own primary-location address handling is untouched.

import type { KyselyDatabase } from "@carbon/database/client";
import { getLogger } from "@carbon/logger";
import type { Kysely } from "kysely";
import { cell, type ImportRecord, type ImportSummary } from "./existing-item";
import { inTransaction } from "./transaction";

const logger = getLogger("server-functions", "import-csv");

export type PartnerLocationTable = "customerLocation" | "supplierLocation";

export const PARTNER_LOCATION_CONFIG: Record<
  PartnerLocationTable,
  { partnerField: "customerId" | "supplierId"; partnerLabel: string }
> = {
  customerLocation: { partnerField: "customerId", partnerLabel: "Customer" },
  supplierLocation: { partnerField: "supplierId", partnerLabel: "Supplier" }
};

// CSV field → address column. `state` is the field the customer and supplier
// imports already use for the State / Region column.
const ADDRESS_COLUMNS = {
  addressLine1: "addressLine1",
  addressLine2: "addressLine2",
  city: "city",
  state: "stateProvince",
  postalCode: "postalCode",
  countryCode: "countryCode",
  phone: "phone",
  fax: "fax"
} as const;

type AddressColumn = (typeof ADDRESS_COLUMNS)[keyof typeof ADDRESS_COLUMNS];
export type AddressValues = Partial<Record<AddressColumn, string | null>>;

/**
 * The address columns a row maps: its value, or NULL for a blank cell. A
 * field the file does not map is absent from the record (or, for the Country
 * enum, undefined) and is left out.
 */
export function addressValues(
  record: Partial<Record<string, string>>
): AddressValues {
  const values: AddressValues = {};
  for (const [field, column] of Object.entries(ADDRESS_COLUMNS) as Array<
    [keyof typeof ADDRESS_COLUMNS, AddressColumn]
  >) {
    const value = record[field];
    if (value === undefined) continue;
    values[column] = value.trim() || null;
  }
  return values;
}

/**
 * The key of a partner location: the partner and the location name, ignoring
 * case and outer spaces.
 */
export const partnerLocationKey = (partnerId: string, name: string) =>
  `${partnerId}::${name.trim().toLowerCase()}`;

export type ExistingLocation = { id: string; addressId: string };

export type PartnerLocationRowDecision =
  | {
      action: "insert";
      partnerId: string;
      name: string;
      address: AddressValues;
      key: string;
    }
  | { action: "update"; addressId: string; address: AddressValues; key: string }
  | { action: "skip"; reason: string; category: "error" | "skipped" };

/**
 * One row of the file: a new location, an address update of a location with the
 * same name, or a skip with its reason.
 */
export function classifyPartnerLocationRow(params: {
  table: PartnerLocationTable;
  record: ImportRecord;
  // The partner's existing locations by `partnerLocationKey`.
  existing: Map<string, ExistingLocation[]>;
  // Country codes that exist (the `country` table's alpha2 codes).
  countryCodes: Set<string>;
  // Locations written by an earlier row of the file.
  seenKeys: Set<string>;
}): PartnerLocationRowDecision {
  const { table, record, existing, countryCodes, seenKeys } = params;
  const { partnerField, partnerLabel } = PARTNER_LOCATION_CONFIG[table];
  const error = (reason: string): PartnerLocationRowDecision => ({
    action: "skip",
    reason,
    category: "error"
  });

  const partnerId = cell(record[partnerField]);
  if (!partnerId) return error(`Missing required ${partnerLabel}`);

  const name = cell(record.locationName);
  if (!name) return error("Missing required Location Name");

  const address = addressValues(record);
  if (address.countryCode && !countryCodes.has(address.countryCode)) {
    return error(`Country "${address.countryCode}" not found`);
  }

  const key = partnerLocationKey(partnerId, name);
  if (seenKeys.has(key)) {
    return error(
      `Duplicate location "${name}" for this ${partnerLabel.toLowerCase()} in file`
    );
  }

  const matches = existing.get(key) ?? [];
  if (matches.length > 1) {
    return error(
      `More than one location of this ${partnerLabel.toLowerCase()} is named "${name}"`
    );
  }
  if (matches.length === 1) {
    if (Object.keys(address).length === 0) {
      return {
        action: "skip",
        reason: `Location "${name}" already exists`,
        category: "skipped"
      };
    }
    return { action: "update", addressId: matches[0]!.addressId, address, key };
  }
  return { action: "insert", partnerId, name, address, key };
}

/** Every location of the named partners, with its address id, by partner. */
async function loadExistingLocations(
  db: Kysely<KyselyDatabase>,
  table: PartnerLocationTable,
  companyId: string,
  partnerIds: string[]
): Promise<Map<string, ExistingLocation[]>> {
  const map = new Map<string, ExistingLocation[]>();
  if (partnerIds.length === 0) return map;
  const rows =
    table === "customerLocation"
      ? await db
          .selectFrom("customerLocation")
          .select(["id", "addressId", "name", "customerId as partnerId"])
          .where("companyId", "=", companyId)
          .where("customerId", "in", partnerIds)
          .execute()
      : await db
          .selectFrom("supplierLocation")
          .select(["id", "addressId", "name", "supplierId as partnerId"])
          .where("companyId", "=", companyId)
          .where("supplierId", "in", partnerIds)
          .execute();
  for (const row of rows) {
    const key = partnerLocationKey(row.partnerId, row.name);
    const list = map.get(key);
    const location = { id: row.id, addressId: row.addressId };
    if (list) list.push(location);
    else map.set(key, [location]);
  }
  return map;
}

/**
 * Adds locations to customers or suppliers, or updates the address of a
 * location with the same name, in one transaction.
 */
export async function importPartnerLocations(
  db: Kysely<KyselyDatabase>,
  args: {
    table: PartnerLocationTable;
    rows: Array<[number, ImportRecord]>;
    companyId: string;
    summary: ImportSummary;
    /** An update leaves a blank cell's field as it is instead of clearing it. */
    keepSavedValues?: boolean;
  }
): Promise<void> {
  const { table, rows, companyId, summary, keepSavedValues = false } = args;
  const { partnerField } = PARTNER_LOCATION_CONFIG[table];

  const partnerIds = [
    ...new Set(rows.map(([, r]) => cell(r[partnerField])).filter(Boolean))
  ];
  const existing = await loadExistingLocations(
    db,
    table,
    companyId,
    partnerIds
  );

  // address.countryCode references country.alpha2; an unknown code is a row
  // error rather than a failed transaction.
  const codes = [
    ...new Set(rows.map(([, r]) => cell(r.countryCode)).filter(Boolean))
  ];
  const countries =
    codes.length > 0
      ? await db
          .selectFrom("country")
          .select(["alpha2"])
          .where("alpha2", "in", codes)
          .execute()
      : [];
  const countryCodes = new Set(countries.map((c) => c.alpha2));

  const seenKeys = new Set<string>();
  const writes: Array<
    Extract<PartnerLocationRowDecision, { action: "insert" | "update" }>
  > = [];
  for (const [row, record] of rows) {
    const decision = classifyPartnerLocationRow({
      table,
      record,
      existing,
      countryCodes,
      seenKeys
    });
    if (decision.action === "skip") {
      (decision.category === "error" ? summary.errors : summary.skipped).push({
        row,
        reason: decision.reason
      });
      continue;
    }
    seenKeys.add(decision.key);
    writes.push(decision);
  }

  logger.info({
    function: "import-partner-locations",
    table,
    totalRecords: rows.length,
    writes: writes.length
  });

  if (writes.length === 0) return;

  await inTransaction(db, async (trx) => {
    for (const write of writes) {
      if (write.action === "update") {
        const address = keepSavedValues
          ? Object.fromEntries(
              Object.entries(write.address).filter(
                ([, value]) => value !== null
              )
            )
          : write.address;
        if (Object.keys(address).length > 0) {
          await trx
            .updateTable("address")
            .set(address)
            .where("id", "=", write.addressId)
            .where("companyId", "=", companyId)
            .execute();
        }
        summary.updated += 1;
        continue;
      }

      // Address first, then the location that points at it — the order
      // insertCustomerLocation / insertSupplierLocation write them in.
      const address = await trx
        .insertInto("address")
        .values({ ...write.address, companyId })
        .returning(["id"])
        .executeTakeFirstOrThrow();
      if (table === "customerLocation") {
        await trx
          .insertInto("customerLocation")
          .values({
            customerId: write.partnerId,
            addressId: address.id,
            name: write.name,
            companyId
          })
          .execute();
      } else {
        await trx
          .insertInto("supplierLocation")
          .values({
            supplierId: write.partnerId,
            addressId: address.id,
            name: write.name,
            companyId
          })
          .execute();
      }
      summary.inserted += 1;
    }
  });
}
