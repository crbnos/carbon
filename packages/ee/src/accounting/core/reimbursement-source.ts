import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { fromDate } from "@internationalized/date";
import type { JournalLineDimensionRef } from "./posting";
import { JournalEntrySyncError } from "./posting";

/**
 * The shared source loader behind every provider's reimbursement syncer
 * (Rillet native `/reimbursements`, QBO employee-vendor `Bill`, Xero
 * employee-Contact `ACCPAY` invoice). It exists for the same reason
 * `card-charge-source.ts` does: three adapters that read the SAME Carbon rows
 * must read them through one query, or they drift.
 *
 * Unlike a charge or a bill, a reimbursement is NOT replayed from its posting
 * journal. Its own `reimbursementLine` rows ARE the coding — one account, one
 * amount, in the document's own `currencyCode` (`post-reimbursement` debits
 * each line and credits the payable control account for the total, converting
 * to base itself). So there is no `loadChargeCostingLines` analogue here and
 * no debit-signed base-currency intermediate: the amounts that cross the wire
 * are the stored transaction-currency line amounts, with `exchangeRate` pinned
 * on the payload exactly as the bill syncers do.
 */

/**
 * The mapping `entityType` under which an EMPLOYEE is linked to the
 * provider-side vendor/contact that receives the reimbursement.
 *
 * Deliberately NOT `"vendor"` — that id space holds Carbon `supplier` ids, and
 * the whole point of the reimbursement document is that an employee is not in
 * the vendor master (`.ai/specs/2026-09-23-reimbursements-first-class.md`).
 * Deliberately NOT `"employee"` either: that is a declared (still
 * unimplemented) AccountingEntityType for a PAYROLL employee master sync —
 * Xero's `Employees` endpoint is a different object from a Contact, and
 * pointing an `employee` mapping at a Vendor id would poison it in advance.
 *
 * Same precedent as the Ramp sync's `"merchant"` entityType: a dedicated
 * string for a dedicated id space.
 */
export const EMPLOYEE_VENDOR_ENTITY_TYPE = "employeeVendor";

/** The employee identity a provider names its vendor/contact after. */
export type ReimbursementEmployee = {
  /** `employee.id` (= `user.id`). */
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
};

/**
 * `"<First> <Last> (<email>)"`, degrading to the email, then the full name,
 * then the raw id — the same convention `resolveEmployeeSupplier`
 * (`packages/ee/src/ramp/lib/suppliers.ts`) established for the Ramp
 * employee-supplier rows, kept so an existing provider-side employee vendor is
 * still recognisable next to the new ones.
 */
export function employeeVendorName(employee: ReimbursementEmployee): string {
  const fullName = [employee.firstName, employee.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (employee.email) {
    return fullName ? `${fullName} (${employee.email})` : employee.email;
  }
  return fullName || employee.id;
}

/** One coding line, in the reimbursement's own transaction currency. */
export type ReimbursementLineSource = {
  id: string;
  accountId: string;
  description: string | null;
  /** Transaction currency (`ReimbursementSource.currencyCode`), positive. */
  amount: number;
  sequence: number;
  /**
   * The line's dimension refs, already MERGED the way
   * `post-reimbursement`'s posting pass merges them: the legacy
   * `costCenterId` / `projectId` columns resolved to their company-group
   * dimension, then the generic `reimbursementLineDimension` rows applied on
   * top — the GENERIC TABLE WINS on a collision, because the legacy columns
   * are what the Ramp sync wrote at import and the generic rows are where a
   * human's edit in the line editor lands.
   *
   * Reading them the same way here is what keeps a pushed document's
   * dimensions identical to the GL dimensions of the journal it replaces.
   */
  dimensions: JournalLineDimensionRef[];
};

export type ReimbursementSource = {
  id: string;
  companyId: string;
  /** Readable, sequential: `REIMB-yyyy-mm-NNNNNN`. */
  reimbursementId: string;
  employeeId: string;
  status: "Draft" | "Posted" | "Voided";
  /** Which spend tool the row was imported from (`charge.integration`'s twin). */
  integration: string | null;
  /** YYYY-MM-DD. */
  reimbursementDate: string;
  /** YYYY-MM-DD; set by posting, so non-null on every syncable row. */
  postingDate: string | null;
  currencyCode: string;
  /** Document currency per 1 unit of company base currency. */
  exchangeRate: number;
  /** Header total, transaction currency. Equals the sum of the line amounts. */
  amount: number;
  /**
   * The employee-payable control account the posting CREDITED. Resolved and
   * stored by `post-reimbursement`, so it is non-null on a Posted row; a
   * provider that names its own payable (Rillet) takes it from here rather
   * than re-deriving the fallback chain.
   */
  payableAccountId: string | null;
  reference: string | null;
  notes: string | null;
  updatedAt: string | null;
  employee: ReimbursementEmployee;
  /** The provider-side vendor/contact id for this employee, if already linked. */
  employeeVendorExternalId: string | null;
  /** Company base currency — for the directed provider exchange rate. */
  baseCurrencyCode: string;
  /** `currency.decimalPlaces` for `currencyCode`, the settlement scale. */
  decimalPlaces: number;
  lines: ReimbursementLineSource[];
};

/**
 * One line's dimension refs, merged the way `post-reimbursement`'s posting
 * pass merges them — the ONE piece of real decision-making in the loader, so
 * it is pure and tested rather than only reachable through a database.
 *
 * `journalLineDimension` is UNIQUE on (journalLineId, dimensionId) — one value
 * per dimension per line — so the two sources must be merged, not concatenated.
 * On a collision the GENERIC TABLE WINS: the legacy `costCenterId` /
 * `projectId` columns are what the Ramp sync wrote at import, and the generic
 * rows are where a human's edit in the line editor lands. Human intent beats a
 * machine default.
 *
 * A legacy column is dropped when its company group has no active dimension of
 * that entity type — there is nothing to key it on. (Posting REFUSES in that
 * case; here, dropping is right: the syncer must not block a document the GL
 * already accepted.)
 */
export function mergeReimbursementLineDimensions(args: {
  costCenterDimensionId: string | null;
  projectDimensionId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  generic: ReadonlyArray<JournalLineDimensionRef>;
}): JournalLineDimensionRef[] {
  const byDimension = new Map<string, string>();
  if (args.costCenterDimensionId && args.costCenterId) {
    byDimension.set(args.costCenterDimensionId, args.costCenterId);
  }
  if (args.projectDimensionId && args.projectId) {
    byDimension.set(args.projectDimensionId, args.projectId);
  }
  for (const row of args.generic) {
    byDimension.set(row.dimensionId, row.valueId);
  }
  return [...byDimension].map(([dimensionId, valueId]) => ({
    dimensionId,
    valueId
  }));
}

/** node-postgres returns Date objects although generated DB types say string. */
function sourceTimestamp(value: string | Date | null): string | null {
  return value instanceof Date
    ? fromDate(value, "UTC").toAbsoluteString()
    : value;
}

/** node-postgres hands DATE columns back as Date (local midnight). */
function sourceDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = `${value.getMonth() + 1}`.padStart(2, "0");
    const day = `${value.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

/**
 * Every reimbursement in `ids`, tenant-scoped, with its coding lines, merged
 * line dimensions, employee identity, the provider's employee-vendor mapping
 * and the currency scale — batched, never one query per row.
 */
export async function loadReimbursementSources(
  database: Kysely<KyselyDatabase>,
  args: { ids: string[]; companyId: string; integration: string }
): Promise<Map<string, ReimbursementSource>> {
  if (args.ids.length === 0) return new Map();

  const company = await database
    .selectFrom("company")
    .select(["companyGroupId", "baseCurrencyCode"])
    .where("id", "=", args.companyId)
    .executeTakeFirst();
  if (!company?.companyGroupId) {
    throw new Error(
      "Company group is required to load reimbursements for accounting sync"
    );
  }

  const headers = await database
    .selectFrom("reimbursement")
    .innerJoin("user", "user.id", "reimbursement.employeeId")
    .leftJoin("externalIntegrationMapping as employeeVendor", (join) =>
      join
        .onRef("employeeVendor.entityId", "=", "reimbursement.employeeId")
        .onRef("employeeVendor.companyId", "=", "reimbursement.companyId")
        .on("employeeVendor.integration", "=", args.integration)
        .on("employeeVendor.entityType", "=", EMPLOYEE_VENDOR_ENTITY_TYPE)
    )
    .select([
      "reimbursement.id",
      "reimbursement.companyId",
      "reimbursement.reimbursementId",
      "reimbursement.employeeId",
      "reimbursement.status",
      "reimbursement.integration",
      "reimbursement.reimbursementDate",
      "reimbursement.postingDate",
      "reimbursement.currencyCode",
      "reimbursement.exchangeRate",
      "reimbursement.amount",
      "reimbursement.payableAccountId",
      "reimbursement.reference",
      "reimbursement.notes",
      "reimbursement.updatedAt",
      "user.firstName",
      "user.lastName",
      "user.email",
      "employeeVendor.externalId as employeeVendorExternalId"
    ])
    .where("reimbursement.id", "in", args.ids)
    .where("reimbursement.companyId", "=", args.companyId)
    .execute();

  if (headers.length === 0) return new Map();

  const headerIds = headers.map((header) => header.id);

  const lineRows = await database
    .selectFrom("reimbursementLine")
    .select([
      "id",
      "reimbursementId",
      "accountId",
      "costCenterId",
      "projectId",
      "description",
      "amount",
      "sequence"
    ])
    .where("reimbursementId", "in", headerIds)
    .where("companyId", "=", args.companyId)
    .orderBy("sequence")
    .orderBy("id")
    .execute();

  const lineIds = lineRows.map((line) => line.id);

  const genericDimensionRows = lineIds.length
    ? await database
        .selectFrom("reimbursementLineDimension")
        .select(["reimbursementLineId", "dimensionId", "valueId"])
        .where("reimbursementLineId", "in", lineIds)
        .where("companyId", "=", args.companyId)
        .orderBy("dimensionId")
        .execute()
    : [];

  // The legacy columns resolve to the company group's single active
  // CostCenter / Project dimension — the same lookup post-reimbursement runs.
  // Only read when a line actually carries one.
  const needsCostCenter = lineRows.some((line) => line.costCenterId !== null);
  const needsProject = lineRows.some((line) => line.projectId !== null);
  const legacyDimensionIds =
    needsCostCenter || needsProject
      ? await database
          .selectFrom("dimension")
          .select(["id", "entityType"])
          .where("companyGroupId", "=", company.companyGroupId)
          .where("active", "=", true)
          .where("entityType", "in", [
            ...(needsCostCenter ? ["CostCenter" as const] : []),
            ...(needsProject ? ["Project" as const] : [])
          ])
          .orderBy("createdAt")
          .orderBy("id")
          .execute()
      : [];
  const costCenterDimensionId =
    legacyDimensionIds.find((row) => row.entityType === "CostCenter")?.id ??
    null;
  const projectDimensionId =
    legacyDimensionIds.find((row) => row.entityType === "Project")?.id ?? null;

  const genericByLineId = new Map<string, JournalLineDimensionRef[]>();
  for (const row of genericDimensionRows) {
    const existing = genericByLineId.get(row.reimbursementLineId);
    if (existing) existing.push(row);
    else genericByLineId.set(row.reimbursementLineId, [row]);
  }

  const currencyCodes = [
    ...new Set(headers.map((header) => header.currencyCode))
  ];
  const currencies = await database
    .selectFrom("currency")
    .select(["code", "decimalPlaces"])
    .where("code", "in", currencyCodes)
    .where("companyGroupId", "=", company.companyGroupId)
    .execute();
  const decimalPlacesByCode = new Map(
    currencies.map((currency) => [currency.code, currency.decimalPlaces])
  );

  const linesByReimbursementId = new Map<string, ReimbursementLineSource[]>();
  for (const line of lineRows) {
    const existing = linesByReimbursementId.get(line.reimbursementId) ?? [];
    existing.push({
      id: line.id,
      accountId: line.accountId,
      description: line.description,
      amount: Number(line.amount) || 0,
      sequence: Number(line.sequence) || 0,
      dimensions: mergeReimbursementLineDimensions({
        costCenterDimensionId,
        projectDimensionId,
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        generic: genericByLineId.get(line.id) ?? []
      })
    });
    linesByReimbursementId.set(line.reimbursementId, existing);
  }

  const result = new Map<string, ReimbursementSource>();
  for (const header of headers) {
    const decimalPlaces = decimalPlacesByCode.get(header.currencyCode);
    if (decimalPlaces == null) {
      throw new Error(
        `Currency precision for ${header.currencyCode} is required to serialize reimbursement ${header.reimbursementId}`
      );
    }
    result.set(header.id, {
      id: header.id,
      companyId: header.companyId,
      reimbursementId: header.reimbursementId,
      employeeId: header.employeeId,
      status: header.status as ReimbursementSource["status"],
      integration: header.integration,
      // A DATE column, so the calendar date is what is stored — never shift it
      // through a timezone.
      reimbursementDate: sourceDate(header.reimbursementDate) ?? "",
      postingDate: sourceDate(header.postingDate),
      currencyCode: header.currencyCode,
      exchangeRate: Number(header.exchangeRate) || 1,
      amount: Number(header.amount) || 0,
      payableAccountId: header.payableAccountId,
      reference: header.reference,
      notes: header.notes,
      updatedAt: sourceTimestamp(header.updatedAt),
      employee: {
        id: header.employeeId,
        firstName: header.firstName,
        lastName: header.lastName,
        email: header.email
      },
      employeeVendorExternalId: header.employeeVendorExternalId,
      baseCurrencyCode: company.baseCurrencyCode ?? "USD",
      decimalPlaces,
      lines: linesByReimbursementId.get(header.id) ?? []
    });
  }
  return result;
}

/**
 * The push gate every provider's reimbursement `shouldSync` returns. Shared
 * because the three adapters must agree with `POSTING_POLICY.Reimbursement`
 * (`backingEntityType: "reimbursement"`) exactly: a row this skips keeps
 * pushing as a journal entry, and a row it accepts must NOT — so a divergent
 * copy would double-post or silently drop the spend.
 *
 * Only a Posted row syncs. A Draft has no journal and no resolved payable
 * account; a Voided row reaches the provider through the syncer base's
 * delete-and-tombstone path, not through a push.
 */
export function resolveReimbursementSyncGate(
  reimbursement: Pick<ReimbursementSource, "reimbursementId" | "status">
): true | string {
  if (reimbursement.status !== "Posted") {
    return `Reimbursement must be posted before syncing (current status: ${reimbursement.status})`;
  }
  return true;
}

/**
 * Guard a reimbursement's account mapping before it is mapped to any
 * provider — the same three checks every adapter runs: refuse an empty
 * coding set, refuse an unmapped line account, and refuse an unmapped (or
 * unresolved) employee-payable control account. Throws the structured
 * `UNMAPPED_ACCOUNTS` Warning the operator can fix and retry;
 * `providerName` is the ONLY per-provider difference in the message.
 * `accountsById` is the provider's account lookup (codes for Rillet / Xero,
 * refs for QBO) — only membership is read here.
 *
 * `requirePayableAccount` is false for a provider whose AP control account is
 * fixed per organisation and cannot be named on the document (Xero), where
 * demanding a mapping would park a document the provider would have accepted.
 */
export function validateReimbursementAccountMapping(args: {
  reimbursement: Pick<ReimbursementSource, "id" | "reimbursementId">;
  lines: ReadonlyArray<Pick<ReimbursementLineSource, "id" | "accountId">>;
  payableAccountId: string | null;
  accountsById: ReadonlyMap<string, unknown>;
  providerName: string;
  requirePayableAccount?: boolean;
}): void {
  const { reimbursement, lines, payableAccountId, accountsById, providerName } =
    args;
  const requirePayableAccount = args.requirePayableAccount ?? true;

  if (lines.length === 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message: `Cannot sync reimbursement ${reimbursement.reimbursementId}: it has no coding lines. Add at least one line, then retry.`,
      metadata: { reimbursementId: reimbursement.id }
    });
  }

  if (requirePayableAccount && !payableAccountId) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message: `Cannot sync reimbursement ${reimbursement.reimbursementId}: it has no employee-payable control account. Post the reimbursement (with accounting enabled), then retry.`,
      metadata: { reimbursementId: reimbursement.id }
    });
  }

  const unmapped = new Set<string>();
  for (const line of lines) {
    if (!accountsById.has(line.accountId)) unmapped.add(line.accountId);
  }
  if (
    requirePayableAccount &&
    payableAccountId &&
    !accountsById.has(payableAccountId)
  ) {
    unmapped.add(payableAccountId);
  }

  if (unmapped.size > 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message: `Cannot sync reimbursement ${reimbursement.reimbursementId}: ${unmapped.size} account(s) are not mapped to ${providerName}. Map them under the integration's Accounts tab, then retry.`,
      metadata: {
        reimbursementId: reimbursement.id,
        unmappedAccountIds: [...unmapped]
      }
    });
  }
}
