// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import {
  getWarehouseTransfer,
  getWarehouseTransferLines
} from "~/modules/inventory";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Warehouse Transfer`, to: path.to.warehouseTransfers },
    (data) => data?.warehouseTransfer?.transferId
  ),
  module: "inventory"
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["transferId"] })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory"
  });

  const { transferId } = params;
  if (!transferId) throw new Response("Not found", { status: 404 });

  const [warehouseTransfer, warehouseTransferLines] = await Promise.all([
    getWarehouseTransfer(client, transferId),
    getWarehouseTransferLines(client, transferId)
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
        error(
          warehouseTransferLines.error,
          "Failed to load warehouse transfer lines"
        )
      )
    );
  }

  return {
    warehouseTransfer: warehouseTransfer.data,
    warehouseTransferLines: warehouseTransferLines.data ?? []
  };
}

export default function WarehouseTransferRoute() {
  const params = useParams();
  const { transferId } = params;
  if (!transferId) throw new Error("Could not find transferId");

  return (
    <div className="flex h-[calc(100dvh-var(--topbar-height)-var(--content-inset))] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 w-full max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 pb-16 w-full">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
