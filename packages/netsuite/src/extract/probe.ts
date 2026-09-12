import type { NetSuiteClient } from "../client/client.ts";
import { NetSuiteError } from "../client/errors.ts";

/**
 * Two NetSuite accounts with the same version can expose different tables.
 *
 * Features change the schema (Multi-Location Inventory, Advanced BOM, Advanced
 * Bin/Numbered Inventory), releases rename it (2026.1 split the shared
 * `entityaddress` tables into per-record-type pairs), and the role's permissions
 * hide parts of it with no error at all. So the extractor asks the account what
 * it has before it asks for data — otherwise the customer gets a failed
 * migration whose message is a SQL error about a table they have never heard of.
 */

export type TableProbe = {
  /** The table name that resolved, or null when none of the candidates did. */
  resolved: string | null;
  /** Every candidate tried, in order, so the run report can explain the choice. */
  tried: string[];
};

/**
 * Does a table resolve for these credentials?
 *
 * `ROWNUM < 2` keeps it to one row on Oracle. A missing table and a table the
 * role cannot read both come back as errors here and both mean the same thing to
 * the caller: do not query it.
 */
export async function tableExists(
  client: NetSuiteClient,
  table: string
): Promise<boolean> {
  try {
    await client.suiteQL(`SELECT 1 AS probe FROM ${table} WHERE ROWNUM < 2`, {
      limit: 5
    });
    return true;
  } catch (error) {
    if (error instanceof NetSuiteError && error.kind === "invalid-request")
      return false;
    if (error instanceof NetSuiteError && error.kind === "auth") return false;
    if (error instanceof NetSuiteError && error.kind === "not-found")
      return false;
    throw error;
  }
}

/** The first candidate table that resolves. */
export async function probeTable(
  client: NetSuiteClient,
  candidates: string[]
): Promise<TableProbe> {
  for (const candidate of candidates) {
    if (await tableExists(client, candidate)) {
      return { resolved: candidate, tried: candidates };
    }
  }
  return { resolved: null, tried: candidates };
}

export type Subsidiary = {
  id: string;
  name: string;
  currencyCode: string | null;
  isElimination: boolean;
  isInactive: boolean;
};

export type AccountProbe = {
  /** True when the account runs OneWorld — `subsidiary` resolves as a table. */
  oneWorld: boolean;
  subsidiaries: Subsidiary[];
  /** Which address model this release exposes. */
  addressTables: { book: string; address: string; entityColumn: string } | null;
  /** Which inventory table to read on-hand from. */
  inventoryTable: "inventorybalance" | "inventoryitemlocations" | "item" | null;
  /** Which BOM component table this account exposes, when Advanced BOM is on. */
  bomComponentTable: string | null;
  /** True when the units-of-measure tables resolve. */
  unitsOfMeasureTable: string | null;
  /** Table names that were tried and rejected, for the run report. */
  notes: string[];
};

/**
 * Everything the extractor needs to know about an account's shape, in one pass.
 *
 * Deliberately tolerant: every branch below has a defined answer for "this
 * account does not have it", because an account without Multi-Location
 * Inventory, without Advanced BOM or without OneWorld is a completely ordinary
 * customer, not an error.
 */
export async function probeAccount(
  client: NetSuiteClient
): Promise<AccountProbe> {
  const notes: string[] = [];

  const oneWorld = await tableExists(client, "subsidiary");
  let subsidiaries: Subsidiary[] = [];

  if (oneWorld) {
    const rows = await client.suiteQLRows<Record<string, unknown>>(
      `SELECT s.id, s.name, BUILTIN.DF(s.currency) AS currency_code,
              s.iselimination, s.isinactive
       FROM subsidiary s
       ORDER BY s.id`
    );
    subsidiaries = rows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      currencyCode: row.currency_code ? String(row.currency_code) : null,
      isElimination: String(row.iselimination ?? "F").toUpperCase() === "T",
      isInactive: String(row.isinactive ?? "F").toUpperCase() === "T"
    }));
  }

  // 2026.1 split the shared address tables per record type. Both shapes are
  // probed because an account mid-upgrade can expose either.
  const modernBook = await tableExists(client, "customeraddressbook");
  const addressTables = modernBook
    ? {
        book: "customeraddressbook",
        address: "customeraddressbookentityaddress",
        entityColumn: "entity"
      }
    : (await tableExists(client, "entityaddressbook"))
      ? {
          book: "entityaddressbook",
          address: "entityaddress",
          entityColumn: "entity"
        }
      : null;

  if (!addressTables)
    notes.push(
      "No address table resolved — parties will arrive with no address."
    );

  const inventoryProbe = await probeTable(client, [
    "inventorybalance",
    "inventoryitemlocations"
  ]);
  const inventoryTable =
    inventoryProbe.resolved === "inventorybalance"
      ? ("inventorybalance" as const)
      : inventoryProbe.resolved === "inventoryitemlocations"
        ? ("inventoryitemlocations" as const)
        : ("item" as const);

  if (inventoryTable === "item") {
    notes.push(
      "Neither inventorybalance nor inventoryitemlocations resolved — on-hand was read from the item's own total, which is only correct without Multi-Location Inventory."
    );
  }

  const bomProbe = await probeTable(client, [
    "bomrevisioncomponentmember",
    "bomcomponent"
  ]);
  if (!bomProbe.resolved) {
    notes.push(
      "No BOM component table resolved — the Advanced BOM feature is probably off."
    );
  }

  const uomProbe = await probeTable(client, ["unitstypeuom", "unitsTypeUom"]);
  if (!uomProbe.resolved) {
    notes.push(
      "No units-of-measure table resolved — units were derived from the items themselves."
    );
  }

  return {
    oneWorld,
    subsidiaries,
    addressTables,
    inventoryTable,
    bomComponentTable: bomProbe.resolved,
    unitsOfMeasureTable: uomProbe.resolved,
    notes
  };
}

/**
 * The subsidiaries a migration could target: real, active, non-elimination.
 *
 * Elimination subsidiaries exist only to cancel intercompany balances during
 * consolidation, so their data is meaningless in a single-company target.
 */
export function migratableSubsidiaries(probe: AccountProbe): Subsidiary[] {
  return probe.subsidiaries.filter((s) => !s.isElimination && !s.isInactive);
}
