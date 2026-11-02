// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { KanbanLabelPDF } from "@carbon/documents/pdf";
import type { KanbanLabelAction } from "@carbon/documents/zpl";
import { getLogger } from "@carbon/logger";
import { getRequestOrigin, labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { kanbanLabelSizes } from "~/modules/settings/settings.models";
import {
  getCompany,
  getKanbanOutputSetting
} from "~/modules/settings/settings.service";
import { getBase64ImageFromSupabase } from "~/modules/shared/shared.service";

const logger = getLogger("erp", "kanban-labels-pdf");

// `all` prints every card a kanban has: Create, Start and Complete for Make,
// Create only for Buy and Transfer.
const ACTIONS = ["order", "start", "complete", "all"] as const;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  // One action per card: Create, Start and Complete are separate cards.
  const action = ACTIONS.find((a) => a === params.action);
  if (!action) {
    return new Response("Invalid kanban action", { status: 400 });
  }

  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  const baseUrl = getRequestOrigin(request) ?? url.origin;

  if (!idsParam) {
    return new Response("No kanban IDs provided", { status: 400 });
  }

  const kanbanIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (kanbanIds.length === 0) {
    return new Response("No valid kanban IDs provided", { status: 400 });
  }

  const [company, setting, kanbans] = await Promise.all([
    getCompany(client, companyId),
    getKanbanOutputSetting(client, companyId),
    client
      .from("kanbans")
      .select("*")
      .in("id", kanbanIds)
      .eq("companyId", companyId)
  ]);
  if (company.error) {
    logger.error("Failed to load company", { companyId, error: company.error });
    throw new Error("Failed to load company");
  }
  if (kanbans.error) {
    logger.error("Failed to load kanbans", {
      companyId,
      error: kanbans.error
    });
    throw new Error("Failed to load kanbans");
  }

  // `?labelSize=` overrides the company's Label Size setting.
  const requested = url.searchParams.get("labelSize");
  const sizeId =
    kanbanLabelSizes.find((s) => s === requested) ??
    setting.data?.kanbanLabelSize ??
    "letter";
  const labelSize = labelSizes.find((s) => s.id === sizeId);

  // In the order asked for: .in() returns rows in no particular order.
  const rows = kanbanIds.flatMap(
    (id) => kanbans.data?.filter((k) => k.id === id) ?? []
  );
  if (rows.length === 0) {
    return new Response("No valid kanbans found", { status: 404 });
  }

  // Only the letter sheet prints the item thumbnail.
  const thumbnails: Record<string, string | null> = {};
  if (!labelSize) {
    await Promise.all(
      rows.map(async (kanban) => {
        if (!kanban.id || !kanban.thumbnailPath) return;
        thumbnails[kanban.id] = await getBase64ImageFromSupabase(
          client,
          kanban.thumbnailPath
        );
      })
    );
  }

  const labels = rows.flatMap((kanban) => {
    const actions: KanbanLabelAction[] =
      action !== "all"
        ? [action]
        : kanban.replenishmentSystem === "Make"
          ? ["order", "start", "complete"]
          : ["order"];
    return actions.map((cardAction) => ({
      action: cardAction,
      id: kanban.id!,
      kanbanId: kanban.kanbanId,
      itemName: kanban.name || "",
      itemReadableId: kanban.readableIdWithRevision || kanban.itemId || "",
      locationName: kanban.locationName || "",
      storageUnitName: kanban.storageUnitName,
      fromStorageUnitName: kanban.fromStorageUnitName,
      supplierName: kanban.supplierName,
      quantity: kanban.quantity ?? 0,
      replenishmentLevel: kanban.replenishmentLevel,
      unitOfMeasureCode: kanban.purchaseUnitOfMeasureCode,
      thumbnail: thumbnails[kanban.id!] ?? null
    }));
  });

  const stream = await renderToStream(
    <KanbanLabelPDF baseUrl={baseUrl} labels={labels} labelSize={labelSize} />
  );

  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - Kanban Labels.pdf"`
  });

  return new Response(new Uint8Array(body), { status: 200, headers });
}
