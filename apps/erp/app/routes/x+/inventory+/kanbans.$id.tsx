// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { notFound } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { kanbanValidator } from "~/modules/inventory/inventory.models";
import { getKanban } from "~/modules/inventory/inventory.service";
import { KanbanForm } from "~/modules/inventory/ui";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const kanban = await getKanban(client, id, companyId);

  return {
    kanban: kanban?.data ?? null
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(kanbanValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id: _, ...kanban } = input.data;
  const api = await carbon(args.request);
  const result = await api.inventory.updateKanban({
    ...kanban,
    id: input.params.id
  });
  const { pathname, search } = new URL(args.request.url);
  return respond(args.request, result).redirect(
    `${path.to.kanbans}?${getParams(args.request)}`,
    { message: "Updated kanban", onError: `${pathname}${search}` }
  );
}

export default function EditKanbanRoute() {
  const { kanban } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: kanban?.id ?? undefined,
    itemId: kanban?.itemId ?? "",
    quantity: kanban?.quantity ?? 1,
    replenishmentSystem: kanban?.replenishmentSystem ?? "Buy",
    locationId: kanban?.locationId ?? "",
    storageUnitId: kanban?.storageUnitId ?? "",
    fromStorageUnitId: kanban?.fromStorageUnitId ?? "",
    supplierId: kanban?.supplierId ?? "",
    purchaseUnitOfMeasureCode: kanban?.purchaseUnitOfMeasureCode ?? "",
    conversionFactor: kanban?.conversionFactor ?? 1,
    replenishmentLevel: kanban?.replenishmentLevel ?? undefined,
    autoRelease: kanban?.autoRelease ?? false,
    autoStartJob: kanban?.autoStartJob ?? false,
    completedBarcodeOverride: kanban?.completedBarcodeOverride ?? ""
  };

  return (
    <KanbanForm
      key={initialValues.id}
      initialValues={initialValues}
      locationId={initialValues.locationId}
      onClose={() => closeRoute()}
    />
  );
}
