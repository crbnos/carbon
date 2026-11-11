// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { TableName } from "@carbon/database/audit.config";
import type { Catalog, TableInfo } from "./catalog";

/**
 * Every per-table decision the backup engine makes: which tables never travel,
 * which a restore keeps, which are per-user identity, which ids are readable
 * part numbers, which columns hold storage paths. Free of runtime `@carbon/*`
 * imports: the drift check runs under bare `tsx`.
 */

/**
 * Tables whose contents must never travel in a backup — credentials,
 * integration tokens and webhook targets stay with the source company.
 * (`apiKeyRateLimit` dangles without its stripped `apiKey` and is an UNLOGGED
 * operational counter, never user data. `tableChange` is the same kind of
 * table: an UNLOGGED log of which rows changed, whose transaction ids mean
 * nothing in another database. `employeePin` holds console PIN
 * hashes — a 4-digit PIN's bcrypt hash is brute-forced offline in minutes, so
 * it is a credential; being secret also keeps an in-place restore from wiping
 * every operator's PIN. `ssoConnection` / `ssoDomain` are the company's login
 * identity — `providerId` and a verified `domain` are unique across ALL
 * companies, so a copy collides with the source company or hands its domain to
 * another. `oauthCode` is a live auth code, and dangles without `oauthClient`.
 * `pushSubscription` holds a browser's push endpoint and its encryption keys:
 * a device credential that means nothing in another company, and being secret
 * keeps an in-place restore from bringing back signed-out browsers or wiping
 * the current ones. `integrationConnection`'s token lives in the vault, which
 * a backup never carries, under a name built from the company and the row id
 * (`get_connection_secret`); a restored row would read as an Active account
 * with no token behind it, so every step using it would fail.)
 */
export const SECRET_TABLES = [
  "apiKey",
  "apiKeyRateLimit",
  "tableChange",
  "companyIntegration",
  "integrationConnection",
  "employeePin",
  "webhook",
  "oauthClient",
  "oauthCode",
  "oauthToken",
  "ssoConnection",
  "ssoDomain",
  "pushSubscription"
];

/**
 * Company-singleton config tables: one row per company, keyed by `id` (the
 * row's `id` IS the company id via an `id -> company` FK), no `companyId`
 * column. `companyPlan` is deliberately absent — billing identity never travels.
 */
export const COMPANY_SINGLETON_TABLES = [
  "companySettings",
  "terms",
  "companyAccountsPayableBillingAddress",
  "companyAccountsReceivableBillingAddress"
] as const satisfies readonly TableName[];

/** The company shell itself — created by onboarding, never imported. */
export const STRUCTURAL_TABLES = ["company"];

/**
 * MRP planning output, regenerated wholesale every run. Restoring stale
 * projections is bloat, and `demandForecastSource`'s discriminator CHECK breaks
 * under the FK-nulling dangling-ref policy on a remapped restore.
 * (`demandForecast` stays: it has a user-forecast write path and no such CHECK.)
 */
export const TRANSIENT_TABLES = [
  "demandForecastSource",
  "demandActual",
  "supplyForecast",
  "supplyActual"
] as const satisfies readonly TableName[];

/**
 * Excluded from the catalog entirely — never exported, wiped, or loaded. An
 * older backup still carrying one is not schema drift; its rows are ignored.
 */
export const CATALOG_EXCLUDED_TABLES = new Set<string>([
  ...STRUCTURAL_TABLES,
  ...TRANSIENT_TABLES
]);

/**
 * Item-child tables — one per `itemType` enum member — whose `id` is a
 * human-authored part number (`ADCS-001`), not an identifier. Rows match it by
 * VALUE against `item."readableId"` with no FK expressing the link, so
 * `buildIdMaps` must leave it alone: minting a fresh id orphans every row from
 * its item and the list views render empty against a full table.
 *
 * Keeping these ids is safe only because they carry no global `UNIQUE (id)` —
 * that is what separates them from the composite-PK tables the id-remap exists
 * for (`balloon`, `inspectionDocument`, …), whose preserved ids WOULD collide
 * with the source company's live rows. The two sets must stay disjoint, and an
 * explicit list is required: the schema shape alone also matches ~65 tables
 * (`workflow`, `kanban`, …) that do need remapping. Both invariants are pinned
 * in `remap.test.ts`.
 */
export const READABLE_ID_TABLES = new Set([
  "part",
  "material",
  "consumable",
  "service",
  "tool",
  "fixture"
]);

/**
 * The target company's own access and identity rows, which a restore and an
 * import leave as they are: wiping them mid-restore would lock the user out of
 * the company being restored, and a copy's memberships, invites and integration
 * state belong to the source company's users. The backup still carries them.
 */
const KEPT_TABLES = new Set<string>([
  "userToCompany",
  "employee",
  "employeeType",
  "employeeTypePermission",
  "invite",
  "externalIntegrationMapping"
]);

const SECRET = new Set<string>(SECRET_TABLES);

export function isSecretTable(name: string): boolean {
  return SECRET.has(name);
}

/** Never written by a load: secrets don't travel, kept tables stay as they are. */
export function isLeftAlone(name: string): boolean {
  return SECRET.has(name) || KEPT_TABLES.has(name);
}

/**
 * A table whose primary key is keyed by a `user`/`employee` FK (e.g. `employeeJob`,
 * `customerAccount`, `supplierAccount`, `userToCompany`) is per-source-user
 * identity. A foreign restore / reseed collapses every user FK onto the single
 * importing user, so all such rows would collide on whatever uniqueness constraint
 * the user column participates in — a composite PK like `(id, companyId)`, OR a
 * unique index like `trainingCompletion(trainingAssignmentId, employeeId, period)`.
 * They can never be meaningfully copied to another company, so neither a foreign
 * restore nor an import loads them: the source's rows belong to the source's users.
 * Keys off every unique column (not just the PK) so a table that keys its user via
 * a unique index is covered automatically rather than silently colliding on load.
 */
export function isUserScopedIdentityTable(table: TableInfo): boolean {
  const uniqueCols = new Set(
    table.uniqueColumns.length > 0 ? table.uniqueColumns : table.pkColumns
  );
  return table.foreignKeys.some(
    (fk) =>
      // The tenant half of a composite FK (`(employeeId, companyId) ->
      // employee`) keys nothing to a user; counting it marked `payment` and
      // `reimbursement` as identity, and a foreign restore dropped them.
      fk.column !== "companyId" &&
      fk.column !== "companyGroupId" &&
      uniqueCols.has(fk.column) &&
      USER_REF_TABLES.has(fk.refTable)
  );
}

/**
 * A foreign load collapses every user FK onto the importing user, so rows
 * that differed only by user collide on a partial unique index holding one
 * (`productionEvent`: one OPEN event per operator and operation;
 * `serviceJobTime`: one open clock per employee; `trainingCompletion`: one
 * completion per assignment, employee and period). Such a table still loads —
 * dropping it lost every closed labor, machine and service record — and the
 * insert keeps the first of the colliding rows, as a user-keyed PK does.
 */
export function collidesOnCollapse(table: TableInfo): boolean {
  const partial = new Set(table.partialUniqueColumns ?? []);
  return table.foreignKeys.some(
    (fk) =>
      fk.column !== "companyId" &&
      partial.has(fk.column) &&
      USER_REF_TABLES.has(fk.refTable)
  );
}

/**
 * Group-scoped tables whose rows each belong to the companies named in these
 * columns, not to the whole group: an intercompany transaction is the source's
 * and the target's. A company's backup, wipe and load cover only its own.
 */
export const GROUP_ROWS_BY_COMPANY: Partial<Record<string, readonly string[]>> =
  {
    intercompanyTransaction: ["sourceCompanyId", "targetCompanyId"]
  };

/**
 * FK edges that cross into another company's books by design: an intercompany
 * transaction names the counterparty's journal line, and an elimination line
 * may eliminate a transaction between two siblings. Never a closure gap or a
 * load violation.
 */
export const CROSS_TENANT_EDGES = new Set([
  "intercompanyTransaction.sourceJournalLineId",
  "intercompanyTransaction.targetJournalLineId",
  "intercompanyTransaction.eliminationJournalId",
  "intercompanyEliminationLine.intercompanyTransactionId"
]);

export function isCrossTenantEdge(table: string, column: string): boolean {
  return CROSS_TENANT_EDGES.has(`${table}.${column}`);
}

/**
 * Loaded only from the company's own backup. These rows pair the company with
 * another company of its group; another company's backup brings a counterparty
 * that isn't in the target's group, and journal lines it doesn't carry.
 */
export const OWN_LOAD_ONLY_TABLES = new Set([
  "intercompanyTransaction",
  "intercompanyEliminationLine"
]);

/**
 * The tables an in-place restore wipes, in catalog (topological) order: the
 * companyId-scoped ones minus the kept and secret tables (`isLeftAlone`), plus
 * the companyGroupId-scoped ones (chart of accounts, currencies) only with
 * `includeGroup`, since those are shared across the group. The full set is
 * wiped, so a table empty in the backup ends up empty; only the subset with
 * rows in the backup is reloaded.
 */
export function selectWipeableTables(
  catalog: Catalog,
  opts: { includeGroup?: boolean } = {}
): TableInfo[] {
  return catalog.tables.filter(
    (t) =>
      !isLeftAlone(t.name) &&
      // Identity tables (per-user rows) are wiped like any other. An own restore
      // and a revert reload them from the backup, whose users are this
      // company's; a foreign restore can't (its users collapse onto one) and
      // leaves them empty. Kept, they missed the backup's state, and a revert
      // after a foreign restore never brought them back.
      (t.scopeColumn === "companyId" ||
        (opts.includeGroup === true && t.scopeColumn === "companyGroupId"))
  );
}

/**
 * Guard the in-place restore invariant: a KEPT table (access/secret tables that
 * survive a wipe) must not hold a NOT-NULL foreign key into a WIPED table. If it
 * did, wiping the referenced table would dangle the kept row (own restore could
 * leave it pointing at an emptied table; foreign restore remaps to new ids).
 * Currently holds — this catches future schema drift before it corrupts data.
 */
export function assertWipeSafe(
  catalog: Catalog
): { ok: true } | { ok: false; reason: string } {
  const wipeable = new Set(
    selectWipeableTables(catalog, { includeGroup: true }).map((t) => t.name)
  );
  for (const table of catalog.tables) {
    if (!isLeftAlone(table.name)) continue;
    const colByName = new Map(table.columns.map((c) => [c.name, c]));
    for (const fk of table.foreignKeys) {
      const col = colByName.get(fk.column);
      if (col && !col.isNullable && wipeable.has(fk.refTable)) {
        return {
          ok: false,
          reason: `"${table.name}.${fk.column}" requires "${fk.refTable}", which a restore wipes — it would be left dangling`
        };
      }
    }
  }
  return { ok: true };
}

/** FKs to these collapse to the importing user when re-stamping a foreign backup. */
export const USER_REF_TABLES = new Set(["user", "employee"]);

/**
 * FK targets a restore resolves WITHOUT the referenced row being in the backup:
 * `user` (global identity table, never in the catalog) and `company` (structural),
 * plus `employee` (collapsed to the importer) and `companyGroup` (re-stamped to the
 * target group). A FK to any of these can't be a closure gap.
 */
export const RETAINED_REF_TABLES = new Set([
  ...USER_REF_TABLES,
  "company",
  "companyGroup"
]);
