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
  lineId?: string | null;
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

type PostedSlot = { id: string; lineId?: string; index?: number };

type TrackedUnit = Database["public"]["Tables"]["trackedEntity"]["Row"];

function shipmentSlots(attributes: unknown) {
  const slots = (attributes as { "Shipment Slots"?: PostedSlot[] } | null)?.[
    "Shipment Slots"
  ];
  return Array.isArray(slots) ? slots : null;
}

function atShipmentSlot(
  unit: TrackedUnit,
  shipmentId: string,
  slot: PostedSlot
): TrackedUnit {
  return {
    ...unit,
    attributes: {
      ...(unit.attributes as ShipmentTrackingAttributes | null),
      Shipment: shipmentId,
      "Shipment Line": slot.lineId,
      "Shipment Line Index": slot.index
    }
  };
}

/** Return shipments record the physical input for both stock and depot lines.
 * One shipment can have separate stock and service activities. */
async function returnShipmentMovements(
  client: SupabaseClient<Database>,
  shipmentId: string,
  companyId: string,
  lines: ShipmentSerialLine[]
) {
  const activities = await fetchAllRecords(() =>
    client
      .from("trackedActivity")
      .select("id, attributes")
      .eq("companyId", companyId)
      .eq("sourceDocument", "Shipment")
      .eq("sourceDocumentId", shipmentId)
      .eq("type", "Return Shipment")
      .order("id")
  );
  if (activities.error) return { data: null, error: activities.error };
  const recorded = new Map<string, PostedSlot>();
  for (const activity of activities.data) {
    for (const slot of shipmentSlots(activity.attributes) ?? [])
      recorded.set(slot.id, slot);
  }
  const inputs = await fetchAllByIds(
    activities.data.map((a) => a.id),
    (ids) =>
      client
        .from("trackedActivityInput")
        .select(
          "trackedActivityId, unit:trackedEntity!trackedActivityInput_trackedEntityId_fkey!inner(*)"
        )
        .eq("companyId", companyId)
        .eq("unit.companyId", companyId)
        .in("trackedActivityId", ids)
        .order("trackedActivityId")
        .order("trackedEntityId")
  );
  if (inputs.error) return { data: null, error: inputs.error };
  // Legacy service jobs tie the customer's serial to the RMA line even after
  // a resale changes every live tag. A depot serial occupies a quantity-one line.
  const depot = new Set(
    activities.data
      .filter(
        (activity) =>
          (activity.attributes as { "At Depot"?: boolean } | null)?.[
            "At Depot"
          ] === false
      )
      .map((activity) => activity.id)
  );
  const unknown = inputs.data.filter(
    ({ unit, trackedActivityId }) =>
      depot.has(trackedActivityId) &&
      !recorded.has(unit.id) &&
      (unit.attributes as ShipmentTrackingAttributes | null)?.Shipment !==
        shipmentId
  );
  if (unknown.length) {
    const jobs = await fetchAllByIds(
      unknown.map(({ unit }) => unit.id),
      (ids) =>
        client
          .from("serviceJob")
          .select("id, trackedEntityId, salesReturnOrderLineId")
          .eq("companyId", companyId)
          .in("trackedEntityId", ids)
          .order("id")
    );
    if (jobs.error) return { data: null, error: jobs.error };
    const shipmentLines = new Map<string, string[]>();
    for (const line of lines) {
      if (line.lineId && line.id && line.shippedQuantity === 1) {
        const matching = shipmentLines.get(line.lineId) ?? [];
        matching.push(line.id);
        shipmentLines.set(line.lineId, matching);
      }
    }
    const candidates = new Map<string, Set<string>>();
    for (const job of jobs.data) {
      if (!job.trackedEntityId || !job.salesReturnOrderLineId) continue;
      const matching = shipmentLines.get(job.salesReturnOrderLineId) ?? [];
      const ids = candidates.get(job.trackedEntityId) ?? new Set<string>();
      for (const id of matching) ids.add(id);
      candidates.set(job.trackedEntityId, ids);
    }
    for (const [id, matches] of candidates) {
      if (matches.size === 1)
        recorded.set(id, { id, lineId: [...matches][0], index: 0 });
    }
  }
  const postedItems = new Map(lines.map((line) => [line.id, line.itemId]));
  return {
    data: inputs.data.map(({ unit }) => {
      const slot = recorded.get(unit.id);
      return {
        itemId:
          (slot?.lineId ? postedItems.get(slot.lineId) : null) ??
          unit.itemId ??
          (unit.sourceDocument === "Item" ? unit.sourceDocumentId : null),
        documentLineId: null,
        unit: slot ? atShipmentSlot(unit, shipmentId, slot) : unit
      };
    }),
    error: null
  };
}

/** Posted documents retain the serials that physically left on each line. */
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
    const slots = shipmentSlots(reversal.data?.attributes);
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
      const history: typeof units.data = units.data.map((unit) =>
        atShipmentSlot(unit, shipmentId, byId.get(unit.id)!)
      );
      return { data: history, error: null };
    }
  }
  if (
    (shipment.sourceDocument !== "Sales Order" &&
      shipment.sourceDocument !== "Sales Return Order") ||
    (shipment.status !== "Posted" && shipment.status !== "Voided")
  ) {
    return getTaggedShipmentTracking(client, shipmentId, companyId);
  }

  let postedLines = loaded?.lines;
  if (!postedLines) {
    const result = await fetchAllRecords(() =>
      client
        .from("shipmentLine")
        .select("id, itemId, lineId, requiresSerialTracking, shippedQuantity")
        .eq("companyId", companyId)
        .eq("shipmentId", shipmentId)
        .order("id")
    );
    if (result.error) return { data: null, error: result.error };
    postedLines = result.data;
  }
  const serialLines = postedLines.filter((line) => line.requiresSerialTracking);
  const isReturn = shipment.sourceDocument === "Sales Return Order";
  if (!isReturn && !serialLines.length)
    return getTaggedShipmentTracking(client, shipmentId, companyId);
  const [tags, movements] = await Promise.all([
    getTaggedShipmentTracking(client, shipmentId, companyId),
    isReturn
      ? returnShipmentMovements(client, shipmentId, companyId, postedLines)
      : fetchAllRecords(() =>
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
  if (movements.error) return { data: null, error: movements.error };

  type Unit = (typeof tags.data)[number];
  // Ordinary shipments keep live batch tags. Return activities identify the
  // physical units, including stockless service units and whole batches.
  const shippedItems = new Set(movements.data.map((row) => row.itemId));
  const slots = new Map<string, (Unit | undefined)[]>();
  for (const line of serialLines) {
    if (line.id && line.itemId && shippedItems.has(line.itemId)) {
      slots.set(line.id, Array.from({ length: line.shippedQuantity ?? 0 }));
    }
  }
  const history: typeof tags.data =
    isReturn && movements.data.length
      ? []
      : tags.data.filter((unit) => {
          const attributes =
            unit.attributes as ShipmentTrackingAttributes | null;
          return !slots.has(attributes?.["Shipment Line"] ?? "");
        });
  const nextIndex = new Map<string, number>();
  const moved = new Map<string, Unit | null>();
  for (const { documentLineId, itemId, unit } of movements.data) {
    if (!itemId) continue;
    if (documentLineId) {
      const line = slots.get(documentLineId);
      if (!line) continue;
      const index = nextIndex.get(documentLineId) ?? 0;
      line[index] = unit;
      nextIndex.set(documentLineId, index + 1);
      continue;
    }
    const attributes = unit.attributes as ShipmentTrackingAttributes | null;
    const lineId = attributes?.["Shipment Line"] ?? "";
    const line = slots.get(lineId);
    if (
      isReturn &&
      !line &&
      attributes?.Shipment === shipmentId &&
      postedLines.some(
        (row) => row.id === lineId && !row.requiresSerialTracking
      )
    ) {
      if (!history.some((entry) => entry.id === unit.id)) history.push(unit);
      continue;
    }
    const index =
      attributes?.["Shipment Line Index"] ??
      (attributes?.Shipment === shipmentId && line?.length === 1
        ? 0
        : undefined);
    if (
      attributes?.Shipment === shipmentId &&
      line &&
      index !== undefined &&
      index >= 0 &&
      index < line.length
    ) {
      line[index] = unit;
    } else {
      // Two moved units of the same SKU cannot identify each other's slots.
      moved.set(itemId, moved.has(itemId) ? null : unit);
    }
  }
  // Old postings can lack a line ID. Restore a missing pick only when one
  // physical unit and one matching slot remain unaccounted for.
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
