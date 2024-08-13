import type { JSONContent } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import {
  SalesRFQHeader,
  SalesRFQProperties,
  getFilesByRfqId,
  getSalesRFQ,
  getSalesRFQLines,
} from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "RFQs",
  to: path.to.salesRfqs,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const [rfqSummary, lines, files] = await Promise.all([
    getSalesRFQ(client, rfqId),
    getSalesRFQLines(client, rfqId),
    getFilesByRfqId(client, rfqId, companyId),
  ]);

  if (rfqSummary.error) {
    throw redirect(
      path.to.salesRfqs,
      await flash(
        request,
        error(rfqSummary.error, "Failed to load part summary")
      )
    );
  }

  if (lines.error) {
    throw redirect(
      path.to.salesRfqs,
      await flash(request, error(lines.error, "Failed to load RFQ lines"))
    );
  }

  return json({
    rfqSummary: rfqSummary.data,
    lines:
      lines.data.map((line) => ({
        ...line,
        id: line.id ?? "",
        order: line.order ?? 0,
        unitOfMeasureCode: line.unitOfMeasureCode ?? "",
        customerPartId: line.customerPartId ?? "",
        customerPartRevision: line.customerPartRevision ?? "",
        description: line.description ?? "",
        externalNotes: (line.externalNotes ?? {}) as JSONContent,
        internalNotes: (line.internalNotes ?? {}) as JSONContent,
        itemId: line.itemId ?? "",
        quantity: line.quantity ?? [1],
      })) ?? [],
    files: files.data?.files ?? [],
  });
}

export default function SalesRFQRoute() {
  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <SalesRFQHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <Outlet />
        </div>
        <SalesRFQProperties />
      </div>
    </div>
  );
}
