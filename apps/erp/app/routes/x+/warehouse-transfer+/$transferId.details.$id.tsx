// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { getWarehouseTransferLine } from "~/modules/inventory/inventory.service";
import { WarehouseTransferLineForm } from "~/modules/inventory/ui";
import { path } from "~/utils/path";

const warehouseTransferLineActionValidator = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("update"),
    quantity: zfd.numeric(z.number().min(0.0001)),
    fromStorageUnitId: zfd.text(z.string().optional()),
    toStorageUnitId: zfd.text(z.string().optional()),
    notes: zfd.text(z.string().optional())
  }),
  z.object({
    type: z.literal("delete")
  })
]);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    update: "inventory"
  });

  const { transferId, id } = params;
  if (!transferId) throw new Error("transferId not found");
  if (!id) throw new Error("id not found");

  const warehouseTransferLine = await getWarehouseTransferLine(
    client,
    transferId,
    id
  );
  if (warehouseTransferLine.error) {
    throw redirect(
      path.to.warehouseTransferDetails(transferId),
      await flash(
        request,
        error(
          warehouseTransferLine.error,
          "Failed to load warehouse transfer line"
        )
      )
    );
  }

  return { warehouseTransferLine: warehouseTransferLine.data };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(warehouseTransferLineActionValidator).request(
    args,
    { params: ["transferId", "id"] }
  );
  if ("invalid" in input) return input.invalid;
  const { transferId, id } = input.params;
  const api = await carbon(args.request);
  const { data } = input;
  const result =
    data.type === "delete"
      ? await api.inventory.removeWarehouseTransferLine({ transferId, id })
      : await api.inventory.updateWarehouseTransferLine({
          transferId,
          id,
          ...data
        });
  // An error is toasted by the form's fetcher.
  if (!result.data) return result;
  return respond(args.request, result).redirect(
    path.to.warehouseTransferDetails(transferId),
    {
      message:
        data.type === "delete"
          ? "Deleted warehouse transfer line"
          : "Updated warehouse transfer line"
    }
  );
}

export default function WarehouseTransferLineDetailsRoute() {
  const params = useParams();
  const { transferId, id } = params;
  if (!transferId) throw new Error("transferId not found");
  if (!id) throw new Error("id not found");

  const { warehouseTransferLine } = useLoaderData<typeof loader>();
  const initialValues = {
    type: "update" as const,
    id,
    transferId,
    itemId: warehouseTransferLine.itemId ?? "",
    fromLocationId:
      warehouseTransferLine.warehouseTransfer?.fromLocationId ?? "",
    toLocationId: warehouseTransferLine.warehouseTransfer?.toLocationId ?? "",
    quantity: warehouseTransferLine.quantity ?? 1,
    fromStorageUnitId: warehouseTransferLine.fromStorageUnitId ?? "",
    toStorageUnitId: warehouseTransferLine.toStorageUnitId ?? "",
    notes: warehouseTransferLine.notes ?? ""
  };

  const closeRoute = useCloseRoute();

  return (
    <div className="flex flex-col gap-4 pb-16 w-full">
      <WarehouseTransferLineForm
        key={initialValues.id}
        initialValues={initialValues}
        warehouseTransfer={warehouseTransferLine.warehouseTransfer!}
        onClose={() => closeRoute()}
      />
    </div>
  );
}
