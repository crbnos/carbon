// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { createMappingService } from "./external-mapping";

/**
 * Tax-code mapping: a Carbon tax code, per direction, to a provider tax rate
 * (a Xero `TaxType`, a QuickBooks Online `TaxCode` id). Thin wrappers over
 * ExternalIntegrationMappingService with entityType = "taxCode", like
 * core/dimension-mapping.ts.
 *
 * One Carbon code needs a SALES rate and a PURCHASE rate — Xero refuses a
 * revenue rate on an expense account — so the mapping row's entityId is the
 * composite `<taxCodeId>:<direction>`. Many Carbon codes may map to one
 * provider rate, so duplicate external ids are allowed. The provider rate's
 * name and percentage live in metadata, for display and for the
 * one-minor-unit check in core/provider-tax.ts.
 * See .ai/specs/2026-10-16-multi-jurisdiction-tax.md.
 */

export const TAX_CODE_MAPPING_ENTITY_TYPE = "taxCode";

export const TAX_DIRECTIONS = ["sales", "purchase"] as const;
export type TaxDirection = (typeof TAX_DIRECTIONS)[number];

type Db = Kysely<KyselyDatabase> | KyselyTx;

export interface TaxCodeMapping {
  taxCodeId: string;
  direction: TaxDirection;
  externalId: string;
  externalName: string | null;
  /** The provider rate's percentage as a 0..1 fraction. */
  externalRate: number | null;
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** `<taxCodeId>:<direction>` — the mapping row's entityId. */
export function buildTaxCodeMappingEntityId(
  taxCodeId: string,
  direction: TaxDirection
): string {
  return `${taxCodeId}:${direction}`;
}

/** Split a mapping entityId back into its parts (null when malformed). */
export function parseTaxCodeMappingEntityId(
  entityId: string
): { taxCodeId: string; direction: TaxDirection } | null {
  const separator = entityId.lastIndexOf(":");
  if (separator <= 0) return null;
  const direction = entityId.slice(separator + 1);
  if (!(TAX_DIRECTIONS as readonly string[]).includes(direction)) return null;
  return {
    taxCodeId: entityId.slice(0, separator),
    direction: direction as TaxDirection
  };
}

function readMetadata(metadata: unknown): {
  externalName: string | null;
  externalRate: number | null;
} {
  const value = (metadata ?? {}) as Record<string, unknown>;
  return {
    externalName:
      typeof value.externalName === "string" ? value.externalName : null,
    externalRate:
      typeof value.externalRate === "number" ? value.externalRate : null
  };
}

/** Every tax-code mapping of an integration. Malformed rows are skipped. */
export async function getTaxCodeMappings(
  db: Db,
  args: { companyId: string; integration: string }
): Promise<{ data: TaxCodeMapping[] | null; error: string | null }> {
  try {
    const rows = await db
      .selectFrom("externalIntegrationMapping")
      .select(["entityId", "externalId", "metadata"])
      .where("entityType", "=", TAX_CODE_MAPPING_ENTITY_TYPE)
      .where("integration", "=", args.integration)
      .where("companyId", "=", args.companyId)
      .execute();

    const data: TaxCodeMapping[] = [];
    for (const row of rows) {
      const parsed = parseTaxCodeMappingEntityId(row.entityId);
      if (!parsed || !row.externalId) continue;
      data.push({
        ...parsed,
        externalId: row.externalId,
        ...readMetadata(row.metadata)
      });
    }
    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

/** `<taxCodeId>:<direction>` → mapping, for the syncers' lookups. */
export function buildTaxCodeMappingLookup(
  mappings: ReadonlyArray<TaxCodeMapping>
): Map<string, TaxCodeMapping> {
  return new Map(
    mappings.map((mapping) => [
      buildTaxCodeMappingEntityId(mapping.taxCodeId, mapping.direction),
      mapping
    ])
  );
}

/**
 * Upsert tax-code mappings, all or none. Returns the number written.
 */
export async function upsertTaxCodeMappings(
  db: Db,
  args: {
    companyId: string;
    integration: string;
    userId: string;
    mappings: TaxCodeMapping[];
  }
): Promise<{ data: number | null; error: string | null }> {
  if (args.mappings.length === 0) return { data: 0, error: null };

  try {
    // The ids come from the form, and this Kysely client bypasses RLS.
    const taxCodeIds = [...new Set(args.mappings.map((m) => m.taxCodeId))];
    const found = await db
      .selectFrom("taxCode")
      .select("id")
      .where("id", "in", taxCodeIds)
      .where("companyId", "=", args.companyId)
      .execute();
    const known = new Set(found.map((row) => row.id));
    const missing = taxCodeIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      return { data: null, error: `Tax code ${missing.join(", ")} not found` };
    }

    await createMappingService(db, args.companyId).linkBatch(
      args.mappings.map((mapping) => ({
        entityType: TAX_CODE_MAPPING_ENTITY_TYPE,
        entityId: buildTaxCodeMappingEntityId(
          mapping.taxCodeId,
          mapping.direction
        ),
        integration: args.integration,
        externalId: mapping.externalId,
        options: {
          metadata: {
            externalName: mapping.externalName,
            externalRate: mapping.externalRate
          },
          createdBy: args.userId,
          allowDuplicateExternalId: true
        }
      }))
    );
    return { data: args.mappings.length, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}

export type TaxRateOption = {
  id: string;
  name: string;
  /** 0..1 */
  rate: number;
  direction: TaxDirection;
};

export type TaxCodeMatchProposal = {
  taxCodeId: string;
  direction: TaxDirection;
  externalId: string;
  externalName: string;
  externalRate: number;
};

/** Rates compare at basis-point-of-a-basis-point precision (0.0001%). */
function sameRate(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/**
 * Proposals for unmapped (code, direction) pairs: the one provider rate of
 * that direction whose percentage equals the code's. Two or more candidates
 * propose nothing — the user picks.
 */
export function matchTaxCodesByRate(args: {
  codes: ReadonlyArray<{ id: string; rate: number }>;
  options: ReadonlyArray<TaxRateOption>;
  /** `<taxCodeId>:<direction>` keys that already have a mapping. */
  mapped: ReadonlySet<string>;
}): TaxCodeMatchProposal[] {
  const proposals: TaxCodeMatchProposal[] = [];
  for (const code of args.codes) {
    for (const direction of TAX_DIRECTIONS) {
      if (args.mapped.has(buildTaxCodeMappingEntityId(code.id, direction))) {
        continue;
      }
      const candidates = args.options.filter(
        (option) =>
          option.direction === direction && sameRate(option.rate, code.rate)
      );
      if (candidates.length !== 1) continue;
      const [match] = candidates;
      proposals.push({
        taxCodeId: code.id,
        direction,
        externalId: match!.id,
        externalName: match!.name,
        externalRate: match!.rate
      });
    }
  }
  return proposals;
}

const SALES_TAX_CODE_SOURCES = [
  "customerTax",
  "customerLocation",
  "quoteLine",
  "salesOrderLine",
  "salesInvoiceLine",
  "rentalAgreement",
  "rentalAgreementCharge",
  "customerContractLine"
] as const;

const PURCHASE_TAX_CODE_SOURCES = [
  "supplierTax",
  "supplierQuoteLinePrice",
  "purchaseOrderLine",
  "purchaseInvoiceLine"
] as const;

/**
 * The (code, direction) pairs a company uses that have no mapping. A code is
 * used for sales when a customer, ship-to, sales document or customer memo
 * names it, and for purchases when a supplier, purchase document or supplier
 * memo names it. Turning on sync is refused while this is non-empty.
 */
export async function getUnmappedTaxCodes(
  db: Db,
  args: { companyId: string; integration: string }
): Promise<{
  data: Array<{
    taxCodeId: string;
    name: string;
    direction: TaxDirection;
  }> | null;
  error: string | null;
}> {
  try {
    const distinctIds = async (
      table:
        | (typeof SALES_TAX_CODE_SOURCES)[number]
        | (typeof PURCHASE_TAX_CODE_SOURCES)[number]
    ) =>
      (
        await db
          .selectFrom(table)
          .select("taxCodeId")
          .distinct()
          .where("companyId", "=", args.companyId)
          .where("taxCodeId", "is not", null)
          .execute()
      ).map((row) => row.taxCodeId as string);

    const memoIds = async (side: "customerId" | "supplierId") =>
      (
        await db
          .selectFrom("memo")
          .select("taxCodeId")
          .distinct()
          .where("companyId", "=", args.companyId)
          .where("taxCodeId", "is not", null)
          .where(side, "is not", null)
          .execute()
      ).map((row) => row.taxCodeId as string);

    const [sales, purchase, codes, mappings] = await Promise.all([
      Promise.all([
        ...SALES_TAX_CODE_SOURCES.map(distinctIds),
        memoIds("customerId")
      ]),
      Promise.all([
        ...PURCHASE_TAX_CODE_SOURCES.map(distinctIds),
        memoIds("supplierId")
      ]),
      db
        .selectFrom("taxCode")
        .select(["id", "name"])
        .where("companyId", "=", args.companyId)
        .where("active", "=", true)
        .execute(),
      getTaxCodeMappings(db, args)
    ]);
    if (mappings.error) return { data: null, error: mappings.error };

    const used: Record<TaxDirection, Set<string>> = {
      sales: new Set(sales.flat()),
      purchase: new Set(purchase.flat())
    };
    const mapped = new Set(
      (mappings.data ?? []).map((m) =>
        buildTaxCodeMappingEntityId(m.taxCodeId, m.direction)
      )
    );
    const data = codes.flatMap((code) =>
      TAX_DIRECTIONS.filter(
        (direction) =>
          used[direction].has(code.id) &&
          !mapped.has(buildTaxCodeMappingEntityId(code.id, direction))
      ).map((direction) => ({ taxCodeId: code.id, name: code.name, direction }))
    );
    return { data, error: null };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}
