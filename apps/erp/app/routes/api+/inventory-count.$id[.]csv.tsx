// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { CSV_CONTENT_TYPE, encodeCsv } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import {
  INVENTORY_COUNT_CSV_COLUMNS,
  inventoryCountLineState,
  isBlindCountEntry,
  protectCsvIdentifier
} from "~/modules/inventory/inventory.utils";
import { getDatabaseClient } from "~/services/database.server";

const logger = getLogger("erp", "api/inventory-count.csv");

// One row per unit of a count, in the columns the count import reads. A
// blind count leaves out the units not counted yet and the Missing ones.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "inventory"
  });
  const { id } = params;
  if (!id)
    throw new Response("The inventory count was not found.", { status: 404 });

  const db = getDatabaseClient();
  const count = await db
    .selectFrom("inventoryCount")
    .select(["inventoryCountId", "isBlind", "status"])
    .where("id", "=", id)
    .where("companyId", "=", companyId)
    .executeTakeFirst();
  if (!count) {
    logger.error("Inventory count not found for export", { companyId, id });
    throw new Response("The inventory count was not found.", { status: 404 });
  }
  const blind = isBlindCountEntry(count);

  const lines = await db
    .selectFrom("inventoryCountLines")
    .leftJoin("storageUnit", (join) =>
      join
        .onRef("storageUnit.id", "=", "inventoryCountLines.storageUnitId")
        .onRef("storageUnit.companyId", "=", "inventoryCountLines.companyId")
    )
    .select([
      "inventoryCountLines.itemReadableIdWithRevision",
      "inventoryCountLines.itemName",
      "inventoryCountLines.readableId",
      "inventoryCountLines.assignedReadableId",
      "inventoryCountLines.countedQuantity",
      "inventoryCountLines.foundDuringCount",
      "storageUnit.name as storageUnitName"
    ])
    .where("inventoryCountLines.inventoryCountId", "=", id)
    .where("inventoryCountLines.companyId", "=", companyId)
    .orderBy("inventoryCountLines.itemReadableIdWithRevision")
    .orderBy("storageUnit.name")
    .orderBy("inventoryCountLines.readableId")
    .execute();

  const rows = lines.map((line) => {
    const counted =
      line.countedQuantity === null ? null : Number(line.countedQuantity);
    const state = inventoryCountLineState({
      countedQuantity: counted,
      foundDuringCount: Boolean(line.foundDuringCount)
    });
    // A blind count lists every unit, as its count sheet does, so a filled-in
    // file imports as a full count. The state stays hidden: it shows which
    // units are not counted yet.
    return {
      Item: protectCsvIdentifier(line.itemReadableIdWithRevision ?? ""),
      "Storage Unit": protectCsvIdentifier(line.storageUnitName ?? ""),
      "Serial / Batch": protectCsvIdentifier(
        line.assignedReadableId ?? line.readableId ?? ""
      ),
      "Counted Quantity": counted ?? "",
      State: blind ? "" : state,
      "Item Name": line.itemName
    };
  });

  const csv = encodeCsv(rows, {
    fields: [...INVENTORY_COUNT_CSV_COLUMNS, "State", "Item Name"]
  });
  return new Response(csv, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename=${count.inventoryCountId}.csv`
    }
  });
}
