// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import {
  getWarehouseTransfer,
  getWarehouseTransferLines,
  getWarehouseTransferRelatedItems
} from "~/modules/inventory";
import {
  WarehouseTransferDocuments,
  WarehouseTransferHeader
} from "~/modules/inventory/ui/WarehouseTransfers";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: [
    { table: "warehouseTransfer", column: "id", param: "transferId" },
    {
      table: "warehouseTransferLine",
      column: "transferId",
      param: "transferId"
    }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Warehouse Transfer`, to: path.to.warehouseTransfers },
    (data) => data?.warehouseTransfer?.transferId
  ),
  module: "inventory"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
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
    warehouseTransferLines: warehouseTransferLines.data ?? [],
    relatedItems: getWarehouseTransferRelatedItems(
      client,
      companyId,
      transferId
    )
  };
}

export default function WarehouseTransferRoute() {
  const { warehouseTransfer } = useLoaderData<typeof loader>();

  return (
    <DocumentPage
      header={<WarehouseTransferHeader />}
      sidebar={
        <DocumentSidebar
          documents={<WarehouseTransferDocuments />}
          activity={{
            entityType: "warehouseTransfer",
            entityId: warehouseTransfer.id,
            refreshKey: `${warehouseTransfer.updatedAt ?? ""}:${warehouseTransfer.status}`
          }}
        />
      }
    >
      <RecordOutlet />
    </DocumentPage>
  );
}
