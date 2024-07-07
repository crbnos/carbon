import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import {
  SalesRFQHeader,
  SalesRFQProperties,
  getModelUploadsByRfqId,
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
  const { client } = await requirePermissions(request, {
    view: "sales",
  });

  const { rfqId } = params;
  if (!rfqId) throw new Error("Could not find rfqId");

  const [rfqSummary, modelUpload] = await Promise.all([
    getSalesRFQ(client, rfqId),
    getModelUploadsByRfqId(client, rfqId),
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
    modelUploads: modelUpload.data,
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
