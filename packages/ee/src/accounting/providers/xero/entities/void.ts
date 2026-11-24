// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import type { KyselyDatabase } from "@carbon/database/client";
import type { Kysely } from "kysely";
import { createMappingService } from "../../../core/external-mapping";
import type { BatchSyncResult, SyncResult } from "../../../core/types";
import { withTriggersDisabled } from "../../../core/utils";
import type { XeroProvider } from "../provider";

type VoidableEntity = "invoice" | "bill";

const TABLE: Record<VoidableEntity, "salesInvoice" | "purchaseInvoice"> = {
  invoice: "salesInvoice",
  bill: "purchaseInvoice"
};

/**
 * Voids in Xero the documents Carbon voided after they synced, and marks the
 * mapping `voided` so the reconciler stops asking. A document Xero refuses to
 * void (a payment is applied) fails with Xero's message. Returns the results
 * and the ids that still take the normal push.
 */
export async function pushXeroVoids(args: {
  database: Kysely<KyselyDatabase>;
  companyId: string;
  provider: XeroProvider;
  entityType: VoidableEntity;
  entityIds: string[];
}): Promise<{ results: SyncResult[]; remaining: string[] }> {
  if (args.entityIds.length === 0) return { results: [], remaining: [] };

  const voided = await args.database
    .selectFrom(TABLE[args.entityType])
    .select("id")
    .where("companyId", "=", args.companyId)
    .where("id", "in", args.entityIds)
    .where("status", "=", "Voided")
    .execute();
  const voidedIds = new Set(voided.map((row) => row.id));
  if (voidedIds.size === 0) return { results: [], remaining: args.entityIds };

  const mappingService = createMappingService(args.database, args.companyId);
  const results: SyncResult[] = [];
  for (const entityId of voidedIds) {
    const mapping = await mappingService.getByEntity(
      args.entityType,
      entityId,
      args.provider.id
    );
    if (!mapping?.externalId) {
      results.push({
        status: "skipped",
        action: "none",
        localId: entityId,
        error: "Voided before it reached Xero: nothing to void"
      });
      continue;
    }
    if (mapping.metadata?.voided === true) {
      results.push({
        status: "skipped",
        action: "none",
        localId: entityId,
        remoteId: mapping.externalId,
        error: "Already voided in Xero"
      });
      continue;
    }

    const response = await args.provider.request<unknown>(
      "POST",
      `/Invoices/${mapping.externalId}`,
      {
        body: JSON.stringify({
          Invoices: [{ InvoiceID: mapping.externalId, Status: "VOIDED" }]
        })
      }
    );
    if (response.error) {
      results.push({
        status: "error",
        action: "none",
        localId: entityId,
        remoteId: mapping.externalId,
        error: `Xero refused to void the ${args.entityType}: ${xeroErrorMessage(response.data) ?? response.message ?? `HTTP ${response.code}`}. If a payment is applied in Xero, remove it there, then retry.`
      });
      continue;
    }

    await withTriggersDisabled(args.database, async (tx) => {
      await createMappingService(tx, args.companyId).link(
        args.entityType,
        entityId,
        args.provider.id,
        mapping.externalId!,
        { metadata: { ...mapping.metadata, voided: true } }
      );
    });
    results.push({
      status: "success",
      action: "deleted",
      localId: entityId,
      remoteId: mapping.externalId
    });
  }

  return {
    results,
    remaining: args.entityIds.filter((id) => !voidedIds.has(id))
  };
}

export function mergeBatchResults(
  voids: SyncResult[],
  rest: BatchSyncResult | null
): BatchSyncResult {
  const results = [...voids, ...(rest?.results ?? [])];
  return {
    results,
    successCount: results.filter((r) => r.status === "success").length,
    errorCount: results.filter((r) => r.status === "error").length,
    skippedCount: results.filter((r) => r.status === "skipped").length
  };
}

function xeroErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const elements = (data as { Elements?: unknown[] }).Elements;
  const messages = (elements ?? []).flatMap((element) =>
    (
      ((element as { ValidationErrors?: { Message?: string }[] })
        .ValidationErrors ?? []) as { Message?: string }[]
    ).map((error) => error.Message)
  );
  const first = messages.find(Boolean);
  if (first) return first;
  const message = (data as { Message?: string }).Message;
  return typeof message === "string" ? message : undefined;
}
