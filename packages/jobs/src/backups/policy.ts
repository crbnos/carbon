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
 * TEXT columns holding a storage path (`{companyId}/…/{id}.ext`). A cross-company
 * restore changes both the companyId and the embedded ids, so these are rewritten
 * in lock-step with the files they point at (`rewriteStoragePath`).
 *
 * A backup collects assets by LISTING the bucket under `{companyId}/`, not from
 * these columns — so every `modelUpload` artifact is carried regardless, and a
 * column missing here silently survives the restore still pointing at the SOURCE
 * company. Add a new `modelUpload` path column here too; the coverage test in
 * `company-backup.closure.test.ts` fails to COMPILE otherwise — it derives the
 * column set from the generated `modelUpload` row type.
 */
export const STORAGE_PATH_COLUMNS = new Set([
  "thumbnailPath",
  "modelPath",
  "originalPath",
  "optimizedModelPath",
  "glbPath",
  "graphPath",
  "pmiPath"
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
 * in `company-backup.closure.test.ts`.
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
 * Additional tables skipped in `reseed` mode — memberships, invites and
 * integration state belong to the source company's users, not to a copy.
 * The importing company already has its admin membership from onboarding.
 * (Tables whose PK is keyed by a user/employee FK — employeeJob, customer/
 * supplierAccount — are skipped automatically via `isUserScopedIdentityTable`,
 * so they don't need listing here.)
 */
export const RESEED_SKIPPED_TABLES = [
  "userToCompany",
  "employee",
  "employeeType",
  "employeeTypePermission",
  "invite",
  "externalIntegrationMapping"
];

/**
 * Tables an in-place restore must NOT wipe or reload — the caller's own access
 * and identity. Wiping these mid-restore would lock the user out of the company
 * they're restoring. The backup still carries them; they're simply left as-is.
 */
export const IN_PLACE_SKIPPED_TABLES = new Set([
  "userToCompany",
  "employee",
  "employeeType",
  "employeeTypePermission",
  "invite",
  "externalIntegrationMapping"
]);

/**
 * The companyId-scoped tables an in-place restore may clear and reload: minus
 * the access/identity tables (kept, so the user isn't locked out) and secrets
 * (never travel). companyGroupId-scoped tables (chart of accounts, currencies)
 * are excluded — shared across the group, so a single company's restore must
 * not touch them. Returned in catalog (topological) order.
 *
 * The full set is WIPED (so a table empty in the backup ends up empty, matching
 * the snapshot exactly); only the subset with rows in the backup is reloaded.
 */
/**
 * A table whose primary key is keyed by a `user`/`employee` FK (e.g. `employeeJob`,
 * `customerAccount`, `supplierAccount`, `userToCompany`) is per-source-user
 * identity. A foreign restore / reseed collapses every user FK onto the single
 * importing user, so all such rows would collide on whatever uniqueness constraint
 * the user column participates in — a composite PK like `(id, companyId)`, OR a
 * unique index like `trainingCompletion(trainingAssignmentId, employeeId, period)`.
 * They can never be meaningfully copied to another company — skip them on both load
 * paths (the source's belong to the source's users; the target keeps its own).
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
      (fk.refTable === "user" || fk.refTable === "employee")
  );
}

export function selectWipeableTables(
  catalog: Catalog,
  opts: { includeGroup?: boolean } = {}
): TableInfo[] {
  const skip = new Set([...SECRET_TABLES, ...IN_PLACE_SKIPPED_TABLES]);
  return catalog.tables.filter(
    (t) =>
      !skip.has(t.name) &&
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
  const kept = new Set([...IN_PLACE_SKIPPED_TABLES, ...SECRET_TABLES]);
  for (const table of catalog.tables) {
    if (!kept.has(table.name)) continue;
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
  "user",
  "employee",
  "company",
  "companyGroup"
]);
