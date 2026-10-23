// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { isServiceJobLocked } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Navigate, useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { serviceJobItemValidator } from "~/modules/service/service.models";
import type { ServiceJobDetail, ServiceJobItem } from "~/modules/service/types";
import ServiceJobChargeForm from "~/modules/service/ui/ServiceJob/ServiceJobChargeForm";
import { path } from "~/utils/path";

/** The posted lines the charge's cost can be linked to. */
export async function loader(args: LoaderFunctionArgs) {
  const { jobId, itemId } = args.params;
  if (!jobId || !itemId) throw new Error("Could not find jobId or itemId");
  const api = await carbon(args.request);
  const result = await api.service.getLinkableCostLines({
    serviceJobId: jobId,
    serviceJobItemId: itemId
  });
  return result.data ?? { lines: [], coverageAccount: null };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceJobItemValidator).request(args, {
    params: ["jobId", "itemId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.service.upsertServiceJobCharge({
    ...input.data,
    id: input.params.itemId,
    serviceJobId: input.params.jobId
  });
}

/** Edits a charge. A part is issued from stock and has nothing to edit. */
export default function ServiceJobChargeRoute() {
  const { jobId, itemId } = useParams();
  if (!jobId || !itemId) throw new Error("Could not find jobId or itemId");
  const navigate = useNavigate();
  const { lines, coverageAccount } = useLoaderData<typeof loader>();
  const routeData = useRouteData<{
    job: ServiceJobDetail;
    items: ServiceJobItem[];
  }>(path.to.serviceJob(jobId));

  const charge = routeData?.items.find(
    (row) => row.id === itemId && row.lineType === "Charge"
  );
  if (!charge) return <Navigate to={path.to.serviceJob(jobId)} replace />;

  return (
    <ServiceJobChargeForm
      key={charge.id}
      initialValues={{
        id: charge.id,
        serviceJobId: jobId,
        itemId: charge.itemId,
        description: charge.description ?? "",
        quantity: charge.quantity,
        unitOfMeasureCode: charge.unitOfMeasureCode ?? undefined,
        unitPrice: charge.unitPrice,
        billable: charge.billable,
        reimbursementLineId: charge.reimbursementLineId ?? undefined,
        purchaseInvoiceLineId: charge.purchaseInvoiceLineId ?? undefined
      }}
      costLines={lines}
      coverageAccount={coverageAccount}
      isLocked={isServiceJobLocked(routeData?.job?.status)}
      onClose={() => navigate(path.to.serviceJob(jobId))}
    />
  );
}
