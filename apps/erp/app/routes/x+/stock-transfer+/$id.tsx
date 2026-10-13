// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import { getStockTransfer, getStockTransferLines } from "~/modules/inventory";
import StockTransferDocuments from "~/modules/inventory/ui/StockTransfers/StockTransferDocuments";
import StockTransferHeader from "~/modules/inventory/ui/StockTransfers/StockTransferHeader";
import StockTransferLines from "~/modules/inventory/ui/StockTransfers/StockTransferLines";
import StockTransferNotes from "~/modules/inventory/ui/StockTransfers/StockTransferNotes";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: [
    { table: "stockTransfer", column: "id", param: "id" },
    { table: "stockTransferLine", column: "stockTransferId", param: "id" }
  ],
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Stock Transfers`, to: path.to.stockTransfers },
    (data) => data?.stockTransfer?.stockTransferId
  ),
  module: "inventory"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [stockTransfer, stockTransferLines] = await Promise.all([
    getStockTransfer(client, id),
    getStockTransferLines(client, id)
  ]);

  if (stockTransfer.error) {
    throw redirect(
      path.to.stockTransfers,
      await flash(
        request,
        error(stockTransfer.error, "Failed to load stockTransfer")
      )
    );
  }

  if (stockTransfer.data.companyId !== companyId) {
    throw redirect(path.to.stockTransfers);
  }

  return {
    stockTransfer: stockTransfer.data,
    stockTransferLines: stockTransferLines.data ?? []
  };
}

export default function StockTransferRoute() {
  const { stockTransfer } = useLoaderData<typeof loader>();

  return (
    <>
      <DocumentPage
        header={<StockTransferHeader />}
        sidebar={
          <DocumentSidebar
            documents={<StockTransferDocuments />}
            activity={{
              entityType: "stockTransfer",
              entityId: stockTransfer.id,
              refreshKey: `${stockTransfer.updatedAt ?? ""}:${stockTransfer.status}`
            }}
          />
        }
      >
        <StockTransferLines />
        <StockTransferNotes
          id={stockTransfer.id}
          notes={(stockTransfer.notes ?? {}) as JSONContent}
        />
      </DocumentPage>
      <RecordOutlet />
    </>
  );
}
