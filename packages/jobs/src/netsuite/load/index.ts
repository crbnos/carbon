import type { MigrationPlan, PlanSection } from "@carbon/netsuite";
import { sql } from "kysely";

import {
  type MigrationIdMap,
  readExistingMappings,
  writeMappings
} from "../mapping";
import {
  type CompanyConfig,
  emptyCounts,
  type LoadCtx,
  type LoadTx,
  makeWarn,
  readCompanyConfig,
  type SectionCounts
} from "./context";
import {
  loadAccounts,
  loadCurrencies,
  loadCustomerTypes,
  loadDepartments,
  loadLocations,
  loadPaymentTerms,
  loadShippingMethods,
  loadSupplierTypes,
  loadUnitsOfMeasure
} from "./foundation";
import {
  loadBillsOfMaterial,
  loadItems,
  loadOpeningStock,
  loadSupplierParts
} from "./items";
import {
  advanceDocumentSequences,
  loadPurchaseOrders,
  loadSalesOrders
} from "./orders";
import { loadCustomers, loadSuppliers } from "./parties";

export type LoadOptions = {
  companyId: string;
  userId: string;
  plan: MigrationPlan;
  /**
   * Section-by-section progress. Awaited between sections, so it must NOT touch
   * `trx` — that transaction is open here. The job's reporter writes over
   * supabase-js on its own connection, which is why this is safe at all.
   */
  onProgress?: (progress: {
    phase: string;
    done: number;
    total: number;
  }) => Promise<void>;
  log?: (message: string) => void;
};

export type LoadResult = {
  counts: Record<PlanSection, SectionCounts>;
  warnings: string[];
  /** How many `externalIntegrationMapping` rows this run wrote. */
  linked: number;
};

/**
 * Every section, in the ONE order that satisfies the foreign keys.
 *
 * The ordering is the contract: locations before items (the item interceptor
 * creates one planning row per existing location), items and parties before
 * orders, items before bills of material. Re-ordering this list is a schema
 * decision, not a cosmetic one.
 */
const TIERS: { section: PlanSection; run: (ctx: LoadCtx) => Promise<void> }[] =
  [
    { section: "currencies", run: loadCurrencies },
    { section: "unitsOfMeasure", run: loadUnitsOfMeasure },
    { section: "paymentTerms", run: loadPaymentTerms },
    { section: "shippingMethods", run: loadShippingMethods },
    { section: "locations", run: loadLocations },
    { section: "departments", run: loadDepartments },
    { section: "accounts", run: loadAccounts },
    { section: "customerTypes", run: loadCustomerTypes },
    { section: "supplierTypes", run: loadSupplierTypes },
    { section: "customers", run: loadCustomers },
    { section: "suppliers", run: loadSuppliers },
    { section: "items", run: loadItems },
    { section: "supplierParts", run: loadSupplierParts },
    { section: "billsOfMaterial", run: loadBillsOfMaterial },
    { section: "openingStock", run: loadOpeningStock },
    { section: "salesOrders", run: loadSalesOrders },
    { section: "purchaseOrders", run: loadPurchaseOrders }
  ];

/**
 * Write a migration plan into a Carbon company.
 *
 * Runs inside the caller's transaction, so a failure in the last tier rolls back
 * the first: a half-migrated company — customers but no items, orders pointing at
 * items that do not exist — is not a state anybody could reason about, let alone
 * clean up.
 *
 * Idempotent by construction. Every entity is keyed through
 * `externalIntegrationMapping`, so a second run over the same NetSuite account
 * updates what it created and inserts only what is new. The one thing with no
 * natural key, opening stock, carries its own marker (see `loadOpeningStock`).
 */
export async function loadMigrationPlan(
  trx: LoadTx,
  options: LoadOptions
): Promise<LoadResult> {
  const { companyId, userId, plan, onProgress, log } = options;

  // Suppress the event system for the duration: every insert below would
  // otherwise enqueue a webhook and evaluate every customer workflow, turning a
  // migration of 20,000 rows into 20,000 queued events on day one. Same flag the
  // dataset seeder sets, for the same reason.
  await sql`SET LOCAL "app.sync_in_progress" = 'true'`.execute(trx);

  const config: CompanyConfig = await readCompanyConfig(trx, companyId);
  const ids: MigrationIdMap = await readExistingMappings(trx, companyId);
  const warnings: string[] = [];

  const ctx: LoadCtx = {
    trx,
    companyId,
    userId,
    plan,
    ids,
    config,
    now: new Date().toISOString(),
    counts: emptyCounts(),
    warnings,
    warn: makeWarn(warnings),
    log:
      log ??
      (() => {
        /* the caller did not want a log */
      })
  };

  await onProgress?.({ phase: "load", done: 0, total: TIERS.length });

  let linked = 0;
  for (let i = 0; i < TIERS.length; i += 1) {
    const tier = TIERS[i];
    if (!tier) continue;

    ctx.log(`Migrating ${tier.section}`);
    await tier.run(ctx);

    // Flush the links this tier created before the next one runs. The map still
    // holds them in memory, so this is purely about bounding how much a single
    // statement has to carry on a large account.
    linked += await writeMappings(trx, {
      companyId,
      userId,
      rows: ids.takePending()
    });

    await onProgress?.({ phase: "load", done: i + 1, total: TIERS.length });
  }

  await advanceDocumentSequences(ctx);

  return { counts: ctx.counts, warnings: ctx.warnings, linked };
}

export type { LoadCtx, LoadTx, SectionCounts } from "./context";
