// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { type KanbanLabelAction, kanbanLabelCode } from "@carbon/documents/zpl";
import { ERP_URL } from "@carbon/env";
import type { ProductLabelItem } from "@carbon/utils";
import type { SupabaseClient } from "@supabase/supabase-js";

export type KanbanCardItem = {
  id: string;
  /** The card's one action: Create, Start or Complete. */
  action: KanbanLabelAction;
  kanbanId: string | null;
  kanbanUrl: string;
  itemId: string;
  itemName: string;
  locationName: string;
  storageUnitId: string | null;
  storageUnitName: string | null;
  fromStorageUnitName: string | null;
  supplierName: string | null;
  quantity: number;
  replenishmentLevel: number | null;
  unitOfMeasureCode: string | null;
  thumbnailPath: string | null;
};

export type StorageUnitItem = {
  id: string;
  name: string;
};

export type ResolvedData<T> = {
  items: T[];
  readableId: string | null;
};

type TrackedEntity = Database["public"]["Tables"]["trackedEntity"]["Row"];

export async function resolveTrackedEntityData(
  client: SupabaseClient<Database>,
  sourceDocument: string,
  sourceDocumentId: string,
  companyId: string
): Promise<ResolvedData<ProductLabelItem> | null> {
  const { trackedEntities, readableId } = await queryTrackedEntities(
    client,
    sourceDocument,
    sourceDocumentId,
    companyId
  );

  if (!trackedEntities?.length) return null;

  const items = await enrichTrackedEntities(client, trackedEntities);
  if (items.length === 0) return null;

  return { items, readableId };
}

export async function resolveKanbanData(
  client: SupabaseClient<Database>,
  sourceDocumentId: string
): Promise<ResolvedData<KanbanCardItem> | null> {
  const { data: kanban } = await client
    .from("kanbans")
    .select("*")
    .eq("id", sourceDocumentId)
    .single();

  if (!kanban) return null;

  // One card per action, never several codes on one card: a Make kanban
  // prints its Create, Start and Complete cards; Buy and Transfer only Create.
  const actions: KanbanLabelAction[] =
    kanban.replenishmentSystem === "Make"
      ? ["order", "start", "complete"]
      : ["order"];

  return {
    items: actions.map((action) => ({
      id: sourceDocumentId,
      action,
      kanbanId: kanban.kanbanId,
      kanbanUrl: kanbanLabelCode(
        { id: sourceDocumentId },
        ERP_URL ?? "",
        action
      ).url,
      itemId: kanban.readableIdWithRevision || kanban.itemId || "",
      itemName: kanban.name || "",
      locationName: kanban.locationName || "",
      storageUnitId: kanban.storageUnitId,
      storageUnitName: kanban.storageUnitName,
      fromStorageUnitName: kanban.fromStorageUnitName,
      supplierName: kanban.supplierName,
      quantity: kanban.quantity ?? 0,
      replenishmentLevel: kanban.replenishmentLevel ?? null,
      unitOfMeasureCode: kanban.purchaseUnitOfMeasureCode,
      thumbnailPath: kanban.thumbnailPath
    })),
    readableId: kanban.kanbanId ?? kanban.readableIdWithRevision ?? null
  };
}

export async function resolveStorageUnitData(
  client: SupabaseClient<Database>,
  sourceDocumentId: string
): Promise<ResolvedData<StorageUnitItem> | null> {
  const { data: unit } = await client
    .from("storageUnit")
    .select("id, name")
    .eq("id", sourceDocumentId)
    .single();

  if (!unit) return null;

  return {
    items: [{ name: unit.name, id: unit.id }],
    readableId: unit.name
  };
}

async function queryTrackedEntities(
  client: SupabaseClient<Database>,
  sourceDocument: string,
  sourceDocumentId: string,
  companyId: string
): Promise<{
  trackedEntities: TrackedEntity[] | null;
  readableId: string | null;
}> {
  switch (sourceDocument) {
    case "Receipt": {
      const { data: receipt } = await client
        .from("receipt")
        .select("receiptId")
        .eq("id", sourceDocumentId)
        .single();

      const { data: trackedEntities } = await client
        .from("trackedEntity")
        .select("*")
        .eq("attributes ->> Receipt", sourceDocumentId)
        .eq("companyId", companyId);

      return { trackedEntities, readableId: receipt?.receiptId ?? null };
    }
    case "Shipment": {
      const { data: shipment } = await client
        .from("shipment")
        .select("shipmentId")
        .eq("id", sourceDocumentId)
        .single();

      const { data: trackedEntities } = await client
        .from("trackedEntity")
        .select("*")
        .eq("attributes ->> Shipment", sourceDocumentId)
        .eq("companyId", companyId);

      return { trackedEntities, readableId: shipment?.shipmentId ?? null };
    }
    case "Operation": {
      const { data: jobOperation } = await client
        .from("jobOperation")
        .select(
          "jobMakeMethodId, ...jobMakeMethod(...item(readableIdWithRevision))"
        )
        .eq("id", sourceDocumentId)
        .eq("companyId", companyId)
        .single();

      if (!jobOperation?.jobMakeMethodId)
        return { trackedEntities: null, readableId: null };

      const { data: trackedEntities } = await client
        .from("trackedEntity")
        .select("*")
        .eq("attributes->>Job Make Method", jobOperation?.jobMakeMethodId)
        .eq("companyId", companyId)
        // Unit-axis order (see MES getTrackedEntitiesByMakeMethodId), so
        // labels print in serial order even for serials minted together.
        .order("createdAt", { ascending: true })
        .order("readableId", { ascending: true })
        .order("id", { ascending: true });

      return {
        trackedEntities,
        readableId: jobOperation.readableIdWithRevision ?? null
      };
    }
    case "Entity":
    case "Split": {
      const { data: trackedEntity } = await client
        .from("trackedEntity")
        .select("*")
        .eq("id", sourceDocumentId)
        .single();

      return {
        trackedEntities: trackedEntity ? [trackedEntity] : null,
        readableId: trackedEntity?.readableId ?? null
      };
    }
    case "Job": {
      const { data: trackedEntity } = await client
        .from("trackedEntity")
        .select("*")
        .eq("id", sourceDocumentId)
        .single();

      if (!trackedEntity) return { trackedEntities: null, readableId: null };

      const jobId = (trackedEntity.attributes as Record<string, unknown>)
        ?.Job as string | undefined;
      let readableId: string | null = null;
      if (jobId) {
        const { data: job } = await client
          .from("job")
          .select("jobId")
          .eq("id", jobId)
          .single();
        readableId = job?.jobId ?? null;
      }

      return {
        trackedEntities: [trackedEntity],
        readableId
      };
    }
    case "StockTransfer": {
      const { data: stockTransfer } = await client
        .from("stockTransfer")
        .select("stockTransferId")
        .eq("id", sourceDocumentId)
        .single();

      const { data: lines } = await client
        .from("stockTransferLine")
        .select("trackedEntityId")
        .eq("stockTransferId", sourceDocumentId)
        .not("trackedEntityId", "is", null);

      const entityIds = [
        ...new Set(
          (lines ?? [])
            .map((l) => l.trackedEntityId)
            .filter((id): id is string => !!id)
        )
      ];

      if (entityIds.length === 0) {
        return {
          trackedEntities: null,
          readableId: stockTransfer?.stockTransferId ?? null
        };
      }

      const { data: trackedEntities } = await client
        .from("trackedEntity")
        .select("*")
        .in("id", entityIds)
        .eq("companyId", companyId);

      return {
        trackedEntities,
        readableId: stockTransfer?.stockTransferId ?? null
      };
    }
    default:
      return { trackedEntities: null, readableId: null };
  }
}

async function enrichTrackedEntities(
  client: SupabaseClient<Database>,
  trackedEntities: TrackedEntity[]
): Promise<ProductLabelItem[]> {
  const sourceDocIds = [
    ...new Set(
      trackedEntities
        .map((te) => te.sourceDocumentId)
        .filter(Boolean) as string[]
    )
  ];

  const { data: items } = await client
    .from("item")
    .select("id, readableId, revision, itemTrackingType")
    .in("id", sourceDocIds);

  const itemMap = new Map(items?.map((i) => [i.id, i]) ?? []);

  return trackedEntities.flatMap((te) => {
    const item = itemMap.get(te.sourceDocumentId ?? "");
    if (!item) return [];

    return {
      itemId: item.readableId,
      revision: item.revision ?? "0",
      number: te.readableId || te.id,
      trackedEntityId: te.id,
      quantity: te.quantity ?? 1,
      trackingType: item.itemTrackingType
    };
  });
}
