import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { PanelItemRow } from "@carbon/ee";
import { externalIdForPart, planPartPush } from "@carbon/ee";
import type { OnshapeDocument } from "@carbon/ee/onshape";
import { getOnshapeClient, OnshapeWVMType } from "@carbon/ee/onshape";
import { trigger } from "@carbon/jobs";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { upsertPart } from "~/modules/items";

export const config = {
  runtime: "nodejs"
};

const payloadSchema = z.object({
  documentId: z.string().min(1),
  // Push needs a place assets can be exported from: a workspace or a version.
  wv: z.enum(["w", "v"]),
  wvId: z.string().min(1),
  elementId: z.string().min(1),
  partIds: z.array(z.string().min(1)).min(1).max(50)
});

type PushResult = {
  partId: string;
  action: "created" | "adopted" | "updated" | "unchanged" | "skipped" | "error";
  itemId?: string;
  message?: string;
};

/**
 * Push parts of the current Onshape element into Carbon.
 *
 * Fast path only: create/link the item and write the mapping, then queue the
 * slow asset export (`carbon/onshape-panel-sync`) per part. Onshape reads here
 * are the element part list — one live call at most, usually the dev cache.
 * Re-pushing an unchanged part (same microversion) does nothing and costs
 * nothing.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
    update: "parts"
  });

  const parsed = payloadSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return data({ error: "Invalid push payload" }, { status: 400 });
  }
  const { documentId, wv, wvId, elementId, partIds } = parsed.data;

  const onshape = await getOnshapeClient(client, companyId, userId);
  if (onshape.error || !onshape.client) {
    return data(
      { error: "Onshape is not connected for this company" },
      { status: 422 }
    );
  }

  const document: OnshapeDocument = {
    documentId,
    wvm: wv === "w" ? OnshapeWVMType.WORKSPACE : OnshapeWVMType.VERSION,
    wvmId: wvId
  };

  let parts: Awaited<ReturnType<typeof onshape.client.getPartsInElement>>;
  try {
    parts = await onshape.client.getPartsInElement(document, elementId);
  } catch (error) {
    return data(
      {
        error: error instanceof Error ? error.message : "Onshape request failed"
      },
      { status: 502 }
    );
  }

  const requested = parts.filter((p) => partIds.includes(p.partId));

  const [mappings, matches] = await Promise.all([
    client
      .from("externalIntegrationMapping")
      .select("entityId, externalId, lastSyncedAt, metadata")
      .eq("companyId", companyId)
      .eq("integration", "onshape")
      .eq("entityType", "item")
      .like("externalId", `${documentId}:${elementId}:%`),
    (async () => {
      const partNumbers = requested
        .map((p) => p.partNumber)
        .filter((n): n is string => !!n);
      if (partNumbers.length === 0) return { data: [], error: null };
      return client
        .from("item")
        .select("id, readableId, revision, name")
        .eq("companyId", companyId)
        .in("readableId", partNumbers);
    })()
  ]);

  if (mappings.error) {
    return data({ error: "Failed to read Onshape mappings" }, { status: 500 });
  }

  const serviceRole = getCarbonServiceRole();
  const results: PushResult[] = [];

  for (const partId of partIds) {
    const part = requested.find((p) => p.partId === partId);
    if (!part) {
      results.push({
        partId,
        action: "error",
        message: "Part is not in this element"
      });
      continue;
    }

    const mapping = (mappings.data ?? []).find(
      (m) => m.externalId === externalIdForPart(documentId, elementId, partId)
    );
    const mappingMeta = (mapping?.metadata ?? null) as Record<
      string,
      unknown
    > | null;
    const matchedItem = part.partNumber
      ? ((matches.data ?? []) as PanelItemRow[]).find(
          (i) => i.readableId === part.partNumber
        )
      : undefined;

    const plan = planPartPush({
      part,
      mapping: mapping ?? undefined,
      mappingMicroversionId: mappingMeta?.microversionId as string | undefined,
      matchedItem
    });

    if (plan.action === "skip-no-part-number") {
      results.push({
        partId,
        action: "skipped",
        message: "Set a part number in Onshape first"
      });
      continue;
    }

    if (plan.action === "unchanged") {
      results.push({ partId, action: "unchanged", itemId: plan.itemId });
      continue;
    }

    let itemId: string;
    if (plan.action === "create") {
      // Pushed parts are designed in-house: Make. One dropdown to change if a
      // part turns out to be purchased.
      const created = await upsertPart(client, {
        id: part.partNumber as string,
        name: part.name,
        description: part.description ?? undefined,
        revision: part.revision ?? "0",
        replenishmentSystem: "Make",
        defaultMethodType: "Make to Order",
        itemTrackingType: "Inventory",
        unitOfMeasureCode: "EA",
        companyId,
        createdBy: userId
        // biome-ignore lint/suspicious/noExplicitAny: partValidator carries many optional form-only fields
      } as any);
      if (created.error || !created.data) {
        results.push({
          partId,
          action: "error",
          message: created.error?.message ?? "Failed to create the item"
        });
        continue;
      }
      itemId = created.data.id as string;
    } else {
      itemId = plan.itemId;
      // Onshape owns name/description; refresh them on the linked item.
      const updated = await client
        .from("item")
        .update({
          name: part.name,
          description: part.description ?? null,
          updatedBy: userId
        })
        .eq("id", itemId)
        .eq("companyId", companyId);
      if (updated.error) {
        results.push({
          partId,
          action: "error",
          message: updated.error.message
        });
        continue;
      }
    }

    // Upsert the mapping: one row per item, one per external part.
    const externalId = externalIdForPart(documentId, elementId, partId);
    await serviceRole
      .from("externalIntegrationMapping")
      .delete()
      .eq("companyId", companyId)
      .eq("integration", "onshape")
      .eq("entityType", "item")
      .or(`entityId.eq.${itemId},externalId.eq.${externalId}`);
    const inserted = await client.from("externalIntegrationMapping").insert({
      entityType: "item",
      entityId: itemId,
      integration: "onshape",
      externalId,
      metadata: {
        documentId,
        elementId,
        partId,
        wv,
        wvId,
        microversionId: part.microversionId ?? null,
        partNumber: part.partNumber ?? null,
        name: part.name,
        revision: part.revision ?? null,
        pushedBy: userId,
        pushedAt: new Date().toISOString()
      },
      lastSyncedAt: new Date().toISOString(),
      companyId,
      createdBy: userId
    });
    if (inserted.error) {
      results.push({
        partId,
        action: "error",
        message: "Item saved but the Onshape link failed; push again"
      });
      continue;
    }

    await trigger("onshape-panel-sync", {
      companyId,
      userId,
      itemId,
      documentId,
      wvm: wv,
      wvmId: wvId,
      elementId,
      elementKind: "partstudio",
      partId,
      assetBaseName: part.partNumber ?? part.name
    });

    results.push({
      partId,
      action:
        plan.action === "create"
          ? "created"
          : plan.action === "adopt"
            ? "adopted"
            : "updated",
      itemId
    });
  }

  return data({ results }, { headers: { "Cache-Control": "no-store" } });
}
