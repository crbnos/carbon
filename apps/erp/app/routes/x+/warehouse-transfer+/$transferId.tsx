import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { getWarehouseTransfer, getWarehouseTransferLines } from "~/modules/inventory";
import WarehouseTransferHeader from "~/modules/inventory/ui/WarehouseTransfers/WarehouseTransferHeader";
import WarehouseTransferLines from "~/modules/inventory/ui/WarehouseTransfers/WarehouseTransferLines";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Warehouse Transfer Details",
  to: path.to.warehouseTransfers,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
  });

  const { transferId } = params;
  if (!transferId) throw new Response("Not found", { status: 404 });

  const [warehouseTransfer, warehouseTransferLines] = await Promise.all([
    getWarehouseTransfer(client, transferId),
    getWarehouseTransferLines(client, transferId),
  ]);

  if (warehouseTransfer.error) {
    throw redirect(
      path.to.warehouseTransfers,
      await flash(
        request,
        error(warehouseTransfer.error, "Failed to load warehouse transfer")
      )
    );
  }

  if (warehouseTransferLines.error) {
    throw redirect(
      path.to.warehouseTransfers,
      await flash(
        request,
        error(warehouseTransferLines.error, "Failed to load warehouse transfer lines")
      )
    );
  }

  return json({
    warehouseTransfer: warehouseTransfer.data,
    warehouseTransferLines: warehouseTransferLines.data ?? [],
  });
}

export default function WarehouseTransferRoute() {
  const { warehouseTransfer, warehouseTransferLines } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={4} className="h-full p-4">
      <WarehouseTransferHeader warehouseTransfer={warehouseTransfer} />
      <WarehouseTransferLines 
        warehouseTransferLines={warehouseTransferLines}
        transferId={warehouseTransfer.id}
      />
      <Outlet />
    </VStack>
  );
}