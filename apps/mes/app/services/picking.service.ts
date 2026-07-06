import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPickingListLocked } from "~/services/models";

export async function getAssignedPickingLists(
  client: SupabaseClient<Database>,
  userId: string
) {
  return client
    .from("pickingLists")
    .select("*")
    .eq("assignee", userId)
    .in("status", ["Draft", "In Progress"])
    .order("dueDate", { ascending: true, nullsFirst: false });
}

export async function getPickingListForExecution(
  client: SupabaseClient<Database>,
  pickingListId: string
) {
  const { data: pickingList, error: plError } = await client
    .from("pickingList")
    .select("*, location:location(name)")
    .eq("id", pickingListId)
    .single();

  if (plError || !pickingList) return { data: null, error: plError };

  const { data: lines, error: lineError } = await client
    .from("pickingListLine")
    .select(
      "*, item:item(name, readableId), job:job(jobId), jobOperation:jobOperation(order, processId, workCenterId, process:process(name), workCenter:workCenter(name)), storageUnit:storageUnit!pickingListLine_storageUnitId_fkey(name), toStorageUnit:storageUnit!pickingListLine_toStorageUnitId_fkey(name)"
    )
    .eq("pickingListId", pickingListId)
    .order("jobOperationId")
    .order("storageUnitId");

  if (lineError) return { data: null, error: lineError };

  const lineIds = lines?.map((l) => l.id) ?? [];
  const { data: trackedEntities } =
    lineIds.length > 0
      ? await client
          .from("pickingListLineTrackedEntity")
          .select("*, trackedEntity:trackedEntity(readableId, quantity)")
          .in("pickingListLineId", lineIds)
      : { data: [] };

  // Warehouse on-hand per line (incl. the unassigned/null bin) → drives the
  // "No Stock" warning. A null source bin is not a shortage if there's on-hand.
  const availabilityResult = await client.rpc("get_picking_list_availability", {
    p_picking_list_id: pickingListId
  });
  const availability = new Map<string, number>();
  for (const row of availabilityResult.data ?? []) {
    availability.set(
      (row as { pickingListLineId: string }).pickingListLineId,
      Number(
        (row as { availableQuantity?: number | null }).availableQuantity ?? 0
      )
    );
  }

  return {
    data: {
      ...pickingList,
      lines: lines?.map((line) => ({
        ...line,
        availableQuantity: availability.get(line.id) ?? 0,
        trackedEntities:
          trackedEntities?.filter((te) => te.pickingListLineId === line.id) ??
          []
      }))
    },
    error: null
  };
}

export async function updatePickingListStatus(
  client: SupabaseClient<Database>,
  pickingListId: string,
  status: Database["public"]["Enums"]["pickingListStatus"],
  updatedBy: string,
  companyId: string
) {
  return client
    .from("pickingList")
    .update({
      status,
      updatedBy,
      updatedAt: new Date().toISOString()
    })
    .eq("id", pickingListId)
    .eq("companyId", companyId);
}

function getPostPickingErrorMessage(error: unknown): string {
  return (error as { message?: string })?.message ?? "Failed to pick material";
}

/**
 * Set the picked quantity on a picking line (pick, short, or unpick).
 *
 * A pick TRANSFERS the material from its warehouse source shelf to the work
 * center's lineside shelf via the `post-picking` edge function (consumption
 * happens later at production). `quantity <= 0` reverses a prior pick. "Short"
 * just records the status with no inventory movement — the kitter couldn't
 * fully pick it, and production handles the shortfall. The picking list header
 * status is maintained by the `update_picking_list_status` trigger.
 */
export async function setPickingListLineQuantity(
  client: SupabaseClient<Database>,
  args: {
    pickingListLineId: string;
    quantity: number;
    markShort?: boolean;
    userId: string;
    companyId: string;
  }
) {
  const lineResult = await client
    .from("pickingListLine")
    .select(
      "*, pickingList(locationId, companyId, status), item(itemTrackingType)"
    )
    .eq("id", args.pickingListLineId)
    .eq("companyId", args.companyId)
    .single();

  if (lineResult.error || !lineResult.data) {
    return { data: null, error: lineResult.error ?? "Line not found" };
  }

  const line = lineResult.data;
  const pickingList = line.pickingList as {
    locationId: string;
    companyId: string;
    status: string;
  } | null;
  const item = line.item as { itemTrackingType: string } | null;

  if (!pickingList) {
    return { data: null, error: "Missing related data" };
  }

  if (isPickingListLocked(pickingList.status)) {
    return {
      data: null,
      error: "This picking list is closed. Reopen it from the ERP to continue."
    };
  }

  if (
    item?.itemTrackingType === "Serial" ||
    item?.itemTrackingType === "Batch"
  ) {
    return {
      data: null,
      error: "Tracked items must be picked via the scan flow"
    };
  }

  // The DELTA between the desired picked quantity and what's already picked is
  // what moves: positive transfers in, negative reverses. Pick = full quantity,
  // Unpick = 0, Short = whatever was actually picked (markShort).
  const previousPicked = Number(line.quantityPicked ?? 0);
  const target = Math.max(0, args.quantity);
  const delta = target - previousPicked;

  if (delta !== 0) {
    // A null source is allowed: the kitter can pick material the system shows no
    // stock for (counts are often wrong) — on-hand simply goes negative at the
    // source until it's reconciled. Only the lineside destination is required.
    if (delta > 0 && !line.toStorageUnitId) {
      return {
        data: null,
        error: "No lineside destination is set for this line"
      };
    }

    const body =
      delta > 0
        ? {
            type: "inventory",
            pickingListId: line.pickingListId,
            pickingListLineId: line.id,
            quantity: delta,
            locationId: pickingList.locationId,
            userId: args.userId,
            companyId: pickingList.companyId
          }
        : {
            type: "unpickInventory",
            pickingListId: line.pickingListId,
            pickingListLineId: line.id,
            quantity: -delta,
            locationId: pickingList.locationId,
            userId: args.userId,
            companyId: pickingList.companyId
          };

    const result = await client.functions.invoke("post-picking", { body });

    if (result.error) {
      return { data: null, error: getPostPickingErrorMessage(result.error) };
    }
  }

  // Short overrides the status the edge function derived from quantities.
  if (args.markShort) {
    const update = await client
      .from("pickingListLine")
      .update({
        status: "Short",
        quantityPicked: target,
        updatedBy: args.userId,
        updatedAt: new Date().toISOString()
      })
      .eq("id", args.pickingListLineId);
    if (update.error) {
      return { data: null, error: update.error };
    }
  }

  return { data: { id: args.pickingListLineId }, error: null };
}

/**
 * Pick (or unpick) a tracked (serial/batch) lot for a picking line. Mirrors the
 * ERP service: moves the chosen lot warehouse→lineside via `post-picking`,
 * records it on the line, points the job material at lineside. `unpick` reverses.
 */
export async function setPickingListLineTrackedEntity(
  client: SupabaseClient<Database>,
  args: {
    pickingListLineId: string;
    trackedEntityId: string;
    fromStorageUnitId?: string | null;
    quantity?: number;
    unpick?: boolean;
    userId: string;
  }
) {
  const lineResult = await client
    .from("pickingListLine")
    .select(
      "*, pickingList(locationId, companyId, status), item(itemTrackingType)"
    )
    .eq("id", args.pickingListLineId)
    .single();

  if (lineResult.error || !lineResult.data) {
    return { data: null, error: lineResult.error ?? "Line not found" };
  }

  const line = lineResult.data;
  const pickingList = line.pickingList as {
    locationId: string;
    companyId: string;
    status: string;
  } | null;
  const item = line.item as { itemTrackingType: string } | null;

  if (!pickingList) {
    return { data: null, error: "Missing related data" };
  }
  if (isPickingListLocked(pickingList.status)) {
    return {
      data: null,
      error: "This picking list is closed. Reopen it from the ERP to continue."
    };
  }

  const isSerial = item?.itemTrackingType === "Serial";
  const isBatch = item?.itemTrackingType === "Batch";
  if (!isSerial && !isBatch) {
    return { data: null, error: "This line is not a tracked item" };
  }
  if (!args.unpick && !line.toStorageUnitId) {
    return {
      data: null,
      error: "No lineside destination is set for this line"
    };
  }

  const type = args.unpick
    ? isSerial
      ? "unpickSerial"
      : "unpickBatch"
    : isSerial
      ? "serial"
      : "batch";

  const body: Record<string, unknown> = {
    type,
    pickingListId: line.pickingListId,
    pickingListLineId: line.id,
    trackedEntityId: args.trackedEntityId,
    locationId: pickingList.locationId,
    userId: args.userId,
    companyId: pickingList.companyId
  };
  if (!args.unpick) {
    body.fromStorageUnitId = args.fromStorageUnitId ?? null;
    if (isBatch) body.quantity = Math.max(1, args.quantity ?? 1);
  }

  const result = await client.functions.invoke("post-picking", { body });
  if (result.error) {
    return { data: null, error: getPostPickingErrorMessage(result.error) };
  }

  return { data: { id: args.pickingListLineId }, error: null };
}
