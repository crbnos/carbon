import type { Kysely, KyselyDatabase } from "@carbon/database/client";
import { fromDate } from "@internationalized/date";
import type { CostingLine } from "./document-costing";
import { type CardTransactionType, JournalEntrySyncError } from "./posting";

export type CardChargeSource = {
  id: string;
  companyId: string;
  cardTransactionId: string;
  type: CardTransactionType;
  status: "Draft" | "Posted" | "Voided";
  supplierId: string | null;
  supplierExternalId: string | null;
  merchantName: string | null;
  memo: string | null;
  updatedAt: string | null;
};

/** node-postgres returns Date objects although generated DB types say string. */
function sourceTimestamp(value: string | Date | null): string | null {
  return value instanceof Date
    ? fromDate(value, "UTC").toAbsoluteString()
    : value;
}

/** One tenant-scoped query for headers and their provider vendor mappings. */
export async function loadCardChargeSources(
  database: Kysely<KyselyDatabase>,
  args: { ids: string[]; companyId: string; integration: string }
): Promise<Map<string, CardChargeSource>> {
  if (args.ids.length === 0) return new Map();
  const rows = await database
    .selectFrom("cardTransaction")
    .leftJoin("externalIntegrationMapping as mapping", (join) =>
      join
        .onRef("mapping.entityId", "=", "cardTransaction.supplierId")
        .onRef("mapping.companyId", "=", "cardTransaction.companyId")
        .on("mapping.integration", "=", args.integration)
        .on("mapping.entityType", "=", "vendor")
    )
    .select([
      "cardTransaction.id",
      "cardTransaction.companyId",
      "cardTransaction.cardTransactionId",
      "cardTransaction.type",
      "cardTransaction.status",
      "cardTransaction.supplierId",
      "cardTransaction.merchantName",
      "cardTransaction.memo",
      "cardTransaction.updatedAt",
      "mapping.externalId as supplierExternalId"
    ])
    .where("cardTransaction.id", "in", args.ids)
    .where("cardTransaction.companyId", "=", args.companyId)
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        ...row,
        type: row.type as CardTransactionType,
        status: row.status as CardChargeSource["status"],
        updatedAt: sourceTimestamp(row.updatedAt)
      }
    ])
  );
}

/**
 * The line description a pushed card charge carries: the merchant identity
 * leads (card spend now shares one catch-all vendor, so without this the
 * pushed charge would lose which merchant it was at), then the journal line
 * label, then the card memo. `undefined` when none is set, so the provider's
 * description field is omitted rather than sent empty. Shared by every charge
 * adapter (Rillet item, QBO expense line, Xero bank-transaction line item).
 */
export function chargeLineDescription(
  charge: Pick<CardChargeSource, "merchantName" | "memo">,
  line: Pick<CostingLine, "description">
): string | undefined {
  return charge.merchantName ?? line.description ?? charge.memo ?? undefined;
}

/** The parts of a card-transaction costing result the account-mapping guard
 * reads — the coded lines and the card-liability account they settle against. */
type ChargeAccountValidationCosting = {
  lines: CostingLine[];
  cardAccountId: string;
};

/**
 * Guard a card charge's account mapping before it is mapped to any provider,
 * the same two checks every charge adapter runs: refuse an empty journal (no
 * posted Card Transaction lines to replay), and refuse when any coded line or
 * the card-liability account is unmapped. Throws the structured
 * `UNMAPPED_ACCOUNTS` Warning each adapter surfaces; `providerName` is the ONLY
 * per-provider difference in the message ("Rillet" / "QuickBooks Online" /
 * "Xero"). `accountsById` is the provider's account lookup (codes for Rillet /
 * Xero, refs for QBO) — only membership is read here.
 */
export function validateChargeAccountMapping(args: {
  charge: Pick<CardChargeSource, "id">;
  costing: ChargeAccountValidationCosting;
  accountsById: ReadonlyMap<string, unknown>;
  providerName: string;
}): void {
  const { charge, costing, accountsById, providerName } = args;

  if (costing.lines.length === 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message:
        "Cannot sync card charge: no posted Card Transaction journal lines found. Post the card transaction with accounting enabled, then retry.",
      metadata: { cardTransactionId: charge.id }
    });
  }

  const unmapped = new Set<string>();
  const lineIdsWithoutAccount: string[] = [];
  for (const line of costing.lines) {
    if (!line.accountId) {
      lineIdsWithoutAccount.push(line.id);
    } else if (!accountsById.has(line.accountId)) {
      unmapped.add(line.accountId);
    }
  }
  if (!accountsById.has(costing.cardAccountId))
    unmapped.add(costing.cardAccountId);
  if (unmapped.size > 0 || lineIdsWithoutAccount.length > 0) {
    throw new JournalEntrySyncError({
      errorCode: "UNMAPPED_ACCOUNTS",
      warning: true,
      message: `Cannot sync card charge: one or more accounts are not mapped to ${providerName}. Map the accounts under the integration's Accounts tab, then retry.`,
      metadata: {
        cardTransactionId: charge.id,
        unmappedAccountIds: [...unmapped],
        lineIdsWithoutAccount
      }
    });
  }
}
