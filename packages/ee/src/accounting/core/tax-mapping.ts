// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { Kysely, KyselyDatabase, KyselyTx } from "@carbon/database/client";
import { sql } from "kysely";
import { createMappingService } from "./external-mapping";
import { ProviderID } from "./models";

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
 * name and percentage live in metadata, for display only: the syncers check
 * against the provider's live rates (core/provider-tax.ts).
 * See .ai/specs/2026-10-16-multi-jurisdiction-tax.md.
 */

export const TAX_CODE_MAPPING_ENTITY_TYPE = "taxCode";

export const TAX_DIRECTIONS = ["sales", "purchase"] as const;
export type TaxDirection = (typeof TAX_DIRECTIONS)[number];

/**
 * The fallback row's taxCodeId: the provider rate for a line with no tax code
 * and no tax (an exempt customer, a non-taxable item, header shipping on a
 * code that does not tax shipping) in a company that uses tax codes. Its
 * mapping row is `noTaxCode:<direction>`, beside the real codes.
 */
export const NO_TAX_CODE_MAPPING_ID = "noTaxCode";

/** The providers that send the fallback rate instead of their "no tax" rate. */
export const NO_TAX_CODE_FALLBACK_PROVIDERS: ReadonlySet<string> = new Set([
  ProviderID.XERO
]);

type Db = Kysely<KyselyDatabase> | KyselyTx;

export interface TaxCodeMapping {
  /** A tax code id, or `NO_TAX_CODE_MAPPING_ID`. */
  taxCodeId: string;
  direction: TaxDirection;
  externalId: string;
  externalName: string | null;
  /** The provider rate's percentage as a 0..1 fraction, for display. */
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
 * Upsert tax-code mappings, all or none. Returns the number written. The
 * fallback row (`NO_TAX_CODE_MAPPING_ID`) needs no tax code.
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
    const taxCodeIds = [
      ...new Set(
        args.mappings
          .map((m) => m.taxCodeId)
          .filter((id) => id !== NO_TAX_CODE_MAPPING_ID)
      )
    ];
    const found =
      taxCodeIds.length === 0
        ? []
        : await db
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

/** The account classes a provider rate may or may not apply to. */
export type ProviderAccountClass =
  | "asset"
  | "equity"
  | "expense"
  | "liability"
  | "revenue";

export type TaxRateOption = {
  id: string;
  name: string;
  /** 0..1 */
  rate: number;
  direction: TaxDirection;
  /** Xero `ReportTaxType`: where the rate lands on the return. */
  reportTaxType?: string | null;
  /** Xero `CanApplyTo*`; a class left out is unknown, never refused. */
  canApplyTo?: Partial<Record<ProviderAccountClass, boolean>>;
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

const STANDARD_REPORT_TAX_TYPE: Record<TaxDirection, string> = {
  sales: "OUTPUT",
  purchase: "INPUT"
};

/** A capital-goods rate (Xero CAPEXINPUT2, CAPITALSALESOUTPUT, …). */
function isCapitalRate(option: TaxRateOption): boolean {
  return /CAP/i.test(option.reportTaxType ?? "") || /^CAP/i.test(option.id);
}

/**
 * The one provider rate of `direction` at `rate`. When several share the
 * percentage, capital-goods rates drop out, then the rate whose
 * `ReportTaxType` is the standard OUTPUT / INPUT wins. Anything else is
 * ambiguous (`match` null): the caller refuses rather than guess.
 */
export function pickRateByPercent(
  options: ReadonlyArray<TaxRateOption>,
  direction: TaxDirection,
  rate: number
): { match: TaxRateOption | null; candidates: TaxRateOption[] } {
  const candidates = options.filter(
    (option) => option.direction === direction && sameRate(option.rate, rate)
  );
  if (candidates.length <= 1) {
    return { match: candidates[0] ?? null, candidates };
  }
  const current = candidates.filter((option) => !isCapitalRate(option));
  if (current.length === 1) return { match: current[0]!, candidates };
  const standard = current.filter(
    (option) => option.reportTaxType === STANDARD_REPORT_TAX_TYPE[direction]
  );
  return { match: standard.length === 1 ? standard[0]! : null, candidates };
}

/**
 * Proposals for unmapped (code, direction) pairs: the provider rate of that
 * direction `pickRateByPercent` picks for the code's charged rate (0 for a
 * Reverse Charge code). A Reverse Charge code needs no purchase rate: its
 * purchase documents go out tax-neutral. Ambiguity proposes nothing.
 */
export function matchTaxCodesByRate(args: {
  codes: ReadonlyArray<{ id: string; rate: number; reverseCharge?: boolean }>;
  options: ReadonlyArray<TaxRateOption>;
  /** `<taxCodeId>:<direction>` keys that already have a mapping. */
  mapped: ReadonlySet<string>;
}): TaxCodeMatchProposal[] {
  const proposals: TaxCodeMatchProposal[] = [];
  for (const code of args.codes) {
    for (const direction of TAX_DIRECTIONS) {
      if (direction === "purchase" && code.reverseCharge) continue;
      if (args.mapped.has(buildTaxCodeMappingEntityId(code.id, direction))) {
        continue;
      }
      const { match } = pickRateByPercent(args.options, direction, code.rate);
      if (!match) continue;
      proposals.push({
        taxCodeId: code.id,
        direction,
        externalId: match.id,
        externalName: match.name,
        externalRate: match.rate
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

/** One tax code of the company and the directions it is used in. */
export type TaxCodeUsage = {
  id: string;
  name: string;
  active: boolean;
  reverseCharge: boolean;
  usedForSales: boolean;
  usedForPurchase: boolean;
};

/**
 * Every tax code of the company, retired ones included, and whether a
 * customer, ship-to, sales document or customer memo names it (sales) or a
 * supplier, purchase document or supplier memo names it (purchase). One
 * statement with an EXISTS per source table per code; each EXISTS uses the
 * table's `taxCodeId` index, so it never walks the company's lines.
 */
export async function loadTaxCodeUsage(
  db: Db,
  companyId: string
): Promise<TaxCodeUsage[]> {
  const usedIn = (
    tables: ReadonlyArray<string>,
    memoParty: "customerId" | "supplierId"
  ) =>
    sql<boolean>`(${sql.join(
      [
        ...tables.map(
          (table) =>
            sql`EXISTS (SELECT 1 FROM ${sql.table(table)} s WHERE s."taxCodeId" = "taxCode"."id" AND s."companyId" = "taxCode"."companyId")`
        ),
        sql`EXISTS (SELECT 1 FROM "memo" s WHERE s."taxCodeId" = "taxCode"."id" AND s."companyId" = "taxCode"."companyId" AND s.${sql.ref(memoParty)} IS NOT NULL)`
      ],
      sql` OR `
    )})`;

  const rows = await db
    .selectFrom("taxCode")
    .select(["id", "name", "active", "calculationType"])
    .select([
      usedIn(SALES_TAX_CODE_SOURCES, "customerId").as("usedForSales"),
      usedIn(PURCHASE_TAX_CODE_SOURCES, "supplierId").as("usedForPurchase")
    ])
    .where("companyId", "=", companyId)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    active: Boolean(row.active),
    reverseCharge: row.calculationType === "Reverse Charge",
    usedForSales: Boolean(row.usedForSales),
    usedForPurchase: Boolean(row.usedForPurchase)
  }));
}

/** The Reverse Charge codes among `taxCodeIds`: their purchase documents go
 *  out tax-neutral in Phase 1. */
export async function loadReverseChargeCodeIds(
  db: Db,
  args: { companyId: string; taxCodeIds: ReadonlyArray<string> }
): Promise<Set<string>> {
  if (args.taxCodeIds.length === 0) return new Set();
  const rows = await db
    .selectFrom("taxCode")
    .select("id")
    .where("companyId", "=", args.companyId)
    .where("id", "in", [...args.taxCodeIds])
    .where("calculationType", "=", "Reverse Charge")
    .execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * The directions whose code-less, untaxed lines send the fallback rate: a
 * direction in which the company uses any tax code. A company (or a
 * direction) with no codes keeps sending the provider's "no tax" rate.
 */
export function noTaxCodeFallbackDirections(
  usage: ReadonlyArray<TaxCodeUsage>
): Set<TaxDirection> {
  return new Set(
    TAX_DIRECTIONS.filter((direction) =>
      usage.some((code) =>
        direction === "sales" ? code.usedForSales : code.usedForPurchase
      )
    )
  );
}

export type UnmappedTaxCode = {
  /** A tax code id, or `NO_TAX_CODE_MAPPING_ID` for the fallback row. */
  taxCodeId: string;
  name: string;
  direction: TaxDirection;
};

/**
 * The (code, direction) pairs that hold the sync switch off: a code used in
 * a direction with no mapping for it (retired codes too, since their open
 * documents still sync), and, for a provider that sends the fallback, the
 * unmapped fallback of each direction that uses codes. A Reverse Charge code
 * needs no purchase mapping. Pure.
 */
export function computeUnmappedTaxCodes(args: {
  usage: ReadonlyArray<TaxCodeUsage>;
  mappings: ReadonlyArray<Pick<TaxCodeMapping, "taxCodeId" | "direction">>;
  noTaxCodeFallback: boolean;
}): UnmappedTaxCode[] {
  const mapped = new Set(
    args.mappings.map((m) =>
      buildTaxCodeMappingEntityId(m.taxCodeId, m.direction)
    )
  );
  const isMapped = (taxCodeId: string, direction: TaxDirection) =>
    mapped.has(buildTaxCodeMappingEntityId(taxCodeId, direction));

  const data: UnmappedTaxCode[] = args.usage.flatMap((code) =>
    TAX_DIRECTIONS.filter((direction) =>
      direction === "sales"
        ? code.usedForSales
        : code.usedForPurchase && !code.reverseCharge
    )
      .filter((direction) => !isMapped(code.id, direction))
      .map((direction) => ({ taxCodeId: code.id, name: code.name, direction }))
  );
  if (args.noTaxCodeFallback) {
    for (const direction of noTaxCodeFallbackDirections(args.usage)) {
      if (!isMapped(NO_TAX_CODE_MAPPING_ID, direction)) {
        data.push({
          taxCodeId: NO_TAX_CODE_MAPPING_ID,
          name: "No tax code (exempt or non-taxable)",
          direction
        });
      }
    }
  }
  return data;
}

/**
 * The unmapped (code, direction) pairs of an integration
 * (`computeUnmappedTaxCodes`). Turning on sync is refused while this is
 * non-empty.
 */
export async function getUnmappedTaxCodes(
  db: Db,
  args: { companyId: string; integration: string }
): Promise<{ data: UnmappedTaxCode[] | null; error: string | null }> {
  try {
    const [usage, mappings] = await Promise.all([
      loadTaxCodeUsage(db, args.companyId),
      getTaxCodeMappings(db, args)
    ]);
    if (mappings.error) return { data: null, error: mappings.error };
    return {
      data: computeUnmappedTaxCodes({
        usage,
        mappings: mappings.data ?? [],
        noTaxCodeFallback: NO_TAX_CODE_FALLBACK_PROVIDERS.has(args.integration)
      }),
      error: null
    };
  } catch (err) {
    return { data: null, error: toErrorMessage(err) };
  }
}
