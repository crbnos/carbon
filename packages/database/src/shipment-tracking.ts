// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.ts";
import { fetchAllByIds, fetchAllRecords } from "./utils.ts";

export type ShipmentTrackingAttributes = {
  Shipment?: string;
  "Shipment Line"?: string;
  "Shipment Line Index"?: number;
};

type Shipment = Pick<
  Database["public"]["Tables"]["shipment"]["Row"],
  "status" | "sourceDocument"
>;

export type ShipmentSerialLine = {
  id: string | null;
  itemId: string | null;
  requiresSerialTracking: boolean | null;
  shippedQuantity: number | null;
};

/** The current assignments on a draft, including retained shelf lots for labels. */
export function getTaggedShipmentTracking(
  client: SupabaseClient<Database>,
  shipmentId: string,
  companyId: string
) {
  return fetchAllRecords(() =>
    client
      .from("trackedEntity")
      .select("*")
      .eq("attributes ->> Shipment", shipmentId)
      .eq("companyId", companyId)
      .order("id")
  );
}

/** Use immutable slots for voided returns and stock debits for posted or voided sales. */
export async function getShipmentTracking(
  client: SupabaseClient<Database>,
  shipmentId: string,
  companyId: string,
  loaded?: { shipment: Shipment; lines: ShipmentSerialLine[] }
) {
  let shipment = loaded?.shipment;
  if (!shipment) {
    const header = await client
      .from("shipment")
      .select("sourceDocument, status")
      .eq("id", shipmentId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (header.error) return { data: null, error: header.error };
    if (!header.data) return { data: [], error: null };
    shipment = header.data;
  }
  if (
    shipment.sourceDocument === "Sales Return Order" &&
    shipment.status === "Voided"
  ) {
    // A replacement draft may already own the serial's live tags. The void
    // captured the slots it released after locking every shipped unit.
    const reversal = await client
      .from("trackedActivity")
      .select("attributes")
      .eq("companyId", companyId)
      .eq("sourceDocument", "Shipment")
      .eq("sourceDocumentId", shipmentId)
      .eq("type", "Void Shipment")
      .maybeSingle();
    if (reversal.error) return { data: null, error: reversal.error };
    const slots = (
      reversal.data?.attributes as {
        "Shipment Slots"?: { id: string; lineId?: string; index?: number }[];
      } | null
    )?.["Shipment Slots"];
    if (Array.isArray(slots)) {
      const byId = new Map(slots.map((slot) => [slot.id, slot]));
      const units = await fetchAllByIds([...byId.keys()], (ids) =>
        client
          .from("trackedEntity")
          .select("*")
          .eq("companyId", companyId)
          .in("id", ids)
          .order("id")
      );
      if (units.error) return units;
      const history: typeof units.data = units.data.map((unit) => {
        const slot = byId.get(unit.id)!;
        return {
          ...unit,
          attributes: {
            ...(unit.attributes as ShipmentTrackingAttributes | null),
            Shipment: shipmentId,
            "Shipment Line": slot.lineId,
            "Shipment Line Index": slot.index
          }
        };
      });
      return { data: history, error: null };
    }
  }
  if (
    shipment.sourceDocument !== "Sales Order" ||
    (shipment.status !== "Posted" && shipment.status !== "Voided")
  ) {
    return getTaggedShipmentTracking(client, shipmentId, companyId);
  }

  let postedLines = loaded?.lines;
  if (!postedLines) {
    const result = await fetchAllRecords(() =>
      client
        .from("shipmentLine")
        .select("id, itemId, requiresSerialTracking, shippedQuantity")
        .eq("companyId", companyId)
        .eq("shipmentId", shipmentId)
        .order("id")
    );
    if (result.error) return { data: null, error: result.error };
    postedLines = result.data;
  }
  const serialLines = postedLines.filter((line) => line.requiresSerialTracking);
  if (!serialLines.length)
    return getTaggedShipmentTracking(client, shipmentId, companyId);
  const [tags, debits] = await Promise.all([
    getTaggedShipmentTracking(client, shipmentId, companyId),
    fetchAllRecords(() =>
      client
        .from("itemLedger")
        .select(
          "documentLineId, itemId, unit:trackedEntity!itemLedger_trackedEntityId_fkey!inner(*)"
        )
        .eq("companyId", companyId)
        .eq("unit.companyId", companyId)
        .eq("documentType", "Sales Shipment")
        .eq("documentId", shipmentId)
        .eq("quantity", -1)
        .order("entryNumber")
    )
  ]);
  if (tags.error) return tags;
  if (debits.error) return { data: null, error: debits.error };

  type Unit = (typeof tags.data)[number];
  // Keep tag-based tracking for batches and older lines with no serialized
  // debits. For a SKU with physical posting evidence, only its debits belong.
  const soldItems = new Set(debits.data.map((row) => row.itemId));
  const slots = new Map<string, (Unit | undefined)[]>();
  for (const line of serialLines) {
    if (line.id && line.itemId && soldItems.has(line.itemId)) {
      slots.set(line.id, Array.from({ length: line.shippedQuantity ?? 0 }));
    }
  }
  const history = tags.data.filter((unit) => {
    const attributes = unit.attributes as ShipmentTrackingAttributes | null;
    return !slots.has(attributes?.["Shipment Line"] ?? "");
  });
  const nextIndex = new Map<string, number>();
  const moved = new Map<string, Unit | null>();
  for (const { documentLineId, itemId, unit } of debits.data) {
    if (documentLineId) {
      const line = slots.get(documentLineId);
      if (!line) continue;
      const index = nextIndex.get(documentLineId) ?? 0;
      line[index] = unit;
      nextIndex.set(documentLineId, index + 1);
      continue;
    }
    const attributes = unit.attributes as ShipmentTrackingAttributes | null;
    const line = slots.get(attributes?.["Shipment Line"] ?? "");
    const index = attributes?.["Shipment Line Index"];
    if (
      attributes?.Shipment === shipmentId &&
      line &&
      index !== undefined &&
      index >= 0 &&
      index < line.length
    ) {
      line[index] = unit;
    } else {
      // Two moved debits of the same SKU cannot identify each other's slots.
      moved.set(itemId, moved.has(itemId) ? null : unit);
    }
  }
  // A legacy debit has no line ID. Restore a missing pick only when exactly
  // one physical debit and one matching slot remain unaccounted for.
  for (const [itemId, unit] of moved) {
    if (
      !unit ||
      postedLines.some(
        (line) =>
          line.itemId === itemId &&
          !line.requiresSerialTracking &&
          (line.shippedQuantity ?? 0) > 0
      )
    )
      continue;
    const open = serialLines
      .filter((line) => line.itemId === itemId)
      .flatMap((line) => {
        const entries = slots.get(line.id ?? "") ?? [];
        return entries.flatMap((value, index) =>
          value ? [] : [{ entries, index }]
        );
      });
    if (open.length === 1) open[0]!.entries[open[0]!.index] = unit;
  }
  for (const [lineId, entries] of slots) {
    entries.forEach((unit, index) => {
      if (!unit) return;
      history.push({
        ...unit,
        attributes: {
          ...(unit.attributes as ShipmentTrackingAttributes | null),
          Shipment: shipmentId,
          "Shipment Line": lineId,
          "Shipment Line Index": index
        }
      });
    });
  }
  return { data: history, error: null };
}
