import type { KyselyDatabase } from "@carbon/database/client";
import type { MigrationPlan, PlanSection } from "@carbon/netsuite";
import { PLAN_SECTIONS } from "@carbon/netsuite";
import type { Transaction } from "kysely";

import type { MigrationIdMap } from "../mapping";

export type LoadTx = Transaction<KyselyDatabase>;

export type SectionCounts = {
  inserted: number;
  updated: number;
  skipped: number;
};

/**
 * Config the tiers resolve ONCE, before the first insert.
 *
 * Every one of these is something Carbon already created when the company was
 * set up — a chart of accounts, a unit of measure, a customer status. The
 * migration's job is to MERGE onto them, never to duplicate them: a second
 * "Net 30" payment term or a second "EA" unit is a data-quality bug the customer
 * inherits on day one and has to clean up by hand.
 */
export type CompanyConfig = {
  companyGroupId: string;
  baseCurrencyCode: string;
  timezone: string;
  /** Carbon's own location, used when a NetSuite record names none. */
  defaultLocationId: string;
  /** Lower-cased name/code → existing Carbon id, for every lookup the tiers merge onto. */
  unitOfMeasureByCode: Map<string, string>;
  paymentTermByName: Map<string, string>;
  shippingMethodByName: Map<string, string>;
  customerStatusByName: Map<string, string>;
  customerTypeByName: Map<string, string>;
  supplierTypeByName: Map<string, string>;
  departmentByName: Map<string, string>;
  locationByName: Map<string, string>;
  currencyByCode: Map<string, string>;
  accountByNumber: Map<string, string>;
  accountByName: Map<string, string>;
  /** Readable ids already taken, so a migrated one never collides. */
  customerReadableIds: Set<string>;
  supplierReadableIds: Set<string>;
  salesOrderIds: Set<string>;
  purchaseOrderIds: Set<string>;
};

export type LoadCtx = {
  trx: LoadTx;
  companyId: string;
  userId: string;
  plan: MigrationPlan;
  ids: MigrationIdMap;
  config: CompanyConfig;
  /** One timestamp for the whole run, so every migrated row shares an audit stamp. */
  now: string;
  counts: Record<PlanSection, SectionCounts>;
  /**
   * Non-fatal problems: a record that could not be linked, a lookup that fell
   * back to a default. These reach the run report — a migration that silently
   * dropped 40 order lines is the failure mode this exists to prevent.
   */
  warnings: string[];
  warn: (message: string) => void;
  log: (message: string) => void;
};

export function emptyCounts(): Record<PlanSection, SectionCounts> {
  const counts = {} as Record<PlanSection, SectionCounts>;
  for (const section of PLAN_SECTIONS) {
    counts[section] = { inserted: 0, updated: 0, skipped: 0 };
  }
  return counts;
}

/** Case- and whitespace-insensitive key for every name/code lookup. */
export function lookupKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** Cap on how many warnings are kept — a broken account must not produce a 200 MB marker row. */
const MAX_WARNINGS = 500;

export function makeWarn(warnings: string[]): (message: string) => void {
  let overflow = 0;
  return (message: string) => {
    if (warnings.length < MAX_WARNINGS) {
      warnings.push(message);
      return;
    }
    overflow += 1;
    if (warnings.length === MAX_WARNINGS) {
      warnings.push("…more warnings were suppressed.");
    }
    // Keep the suppressed count current in the last slot rather than growing.
    warnings[warnings.length - 1] =
      `…and ${overflow} more warnings were suppressed.`;
  };
}

/**
 * Read the company's existing configuration.
 *
 * Runs inside the load transaction so it cannot observe a half-applied state,
 * and every map is keyed with `lookupKey` so "Net 30", "NET 30" and " net 30 "
 * all find the same row.
 */
export async function readCompanyConfig(
  trx: LoadTx,
  companyId: string
): Promise<CompanyConfig> {
  const company = await trx
    .selectFrom("company")
    .select(["companyGroupId", "baseCurrencyCode", "timezone"])
    .where("id", "=", companyId)
    .executeTakeFirst();

  if (!company) throw new Error(`Company ${companyId} not found`);
  if (!company.companyGroupId) {
    // currency and account are company-GROUP scoped; without a group there is
    // nowhere to put them and the failure would surface as a null FK deep in a tier.
    throw new Error(
      `Company ${companyId} has no company group, so currencies and accounts cannot be migrated`
    );
  }
  const companyGroupId = company.companyGroupId;

  const [
    locations,
    unitsOfMeasure,
    paymentTerms,
    shippingMethods,
    customerStatuses,
    customerTypes,
    supplierTypes,
    departments,
    currencies,
    accounts,
    customers,
    suppliers,
    salesOrders,
    purchaseOrders
  ] = await Promise.all([
    trx
      .selectFrom("location")
      .select(["id", "name"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("unitOfMeasure")
      .select(["id", "code"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("paymentTerm")
      .select(["id", "name"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("shippingMethod")
      .select(["id", "name"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("customerStatus")
      .select(["id", "name"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("customerType")
      .select(["id", "name"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("supplierType")
      .select(["id", "name"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("department")
      .select(["id", "name"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("currency")
      .select(["id", "code"])
      .where("companyGroupId", "=", companyGroupId)
      .execute(),
    trx
      .selectFrom("account")
      .select(["id", "name", "number"])
      .where("companyGroupId", "=", companyGroupId)
      .execute(),
    trx
      .selectFrom("customer")
      .select(["readableId"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("supplier")
      .select(["readableId"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("salesOrder")
      .select(["salesOrderId"])
      .where("companyId", "=", companyId)
      .execute(),
    trx
      .selectFrom("purchaseOrder")
      .select(["purchaseOrderId"])
      .where("companyId", "=", companyId)
      .execute()
  ]);

  const defaultLocationId = locations[0]?.id;
  if (!defaultLocationId) {
    throw new Error(
      `Company ${companyId} has no location — finish onboarding before migrating from NetSuite`
    );
  }

  const byName = <T extends { id: string }>(rows: (T & { name: string })[]) =>
    new Map(rows.map((row) => [lookupKey(row.name), row.id]));

  return {
    companyGroupId,
    baseCurrencyCode: company.baseCurrencyCode,
    timezone: company.timezone,
    defaultLocationId,
    locationByName: byName(locations),
    unitOfMeasureByCode: new Map(
      unitsOfMeasure.map((row) => [lookupKey(row.code), row.id])
    ),
    paymentTermByName: byName(paymentTerms),
    shippingMethodByName: byName(shippingMethods),
    customerStatusByName: byName(customerStatuses),
    customerTypeByName: byName(customerTypes),
    supplierTypeByName: byName(supplierTypes),
    departmentByName: byName(departments),
    currencyByCode: new Map(
      currencies.map((row) => [lookupKey(row.code), row.id])
    ),
    accountByNumber: new Map(
      accounts
        .filter((row) => row.number)
        .map((row) => [lookupKey(row.number), row.id])
    ),
    accountByName: byName(accounts),
    customerReadableIds: new Set(
      customers.map((row) => lookupKey(row.readableId))
    ),
    supplierReadableIds: new Set(
      suppliers.map((row) => lookupKey(row.readableId))
    ),
    salesOrderIds: new Set(
      salesOrders.map((row) => lookupKey(row.salesOrderId))
    ),
    purchaseOrderIds: new Set(
      purchaseOrders.map((row) => lookupKey(row.purchaseOrderId))
    )
  };
}
