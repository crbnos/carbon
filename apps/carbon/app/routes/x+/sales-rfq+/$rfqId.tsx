import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import {
  SalesRFQHeader,
  SalesRFQProperties,
  getFilesByRfqId,
  getSalesRFQ,
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

  const [rfqSummary, files] = await Promise.all([
    getSalesRFQ(client, rfqId),
    getFilesByRfqId(client, rfqId, companyId),
  ]);

  if (rfqSummary.error) {
    throw redirect(
      path.to.sales,
      await flash(
        request,
        error(rfqSummary.error, "Failed to load part summary")
      )
    );
  }

  return json({
    rfqSummary: rfqSummary.data,
    files: files.data?.files ?? [],
    modelUploads: files.data?.modelUploads ?? [],
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
