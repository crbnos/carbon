import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import invariant from "tiny-invariant";
import {
  getInboundInspection,
  getInboundInspectionLotTrackedEntities,
  getIssueTypesList
} from "~/modules/quality";
import type {
  InboundInspectionRow,
  InboundInspectionSample,
  InspectionTrackedEntity,
  IssueTypeListItem
} from "~/modules/quality/types";
import InboundInspectionLotView from "~/modules/quality/ui/InboundInspections/InboundInspectionLotView";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  const [inspection, settings, issueTypes] = await Promise.all([
    getInboundInspection(id),
    getCompanySettings(),
    getIssueTypesList()
  ]);

  if (inspection.error || !inspection.data) {
    throw redirect(
      path.to.inboundInspections,
      await flash(request, error(inspection.error, "Failed to load inspection"))
    );
  }

  const insp = inspection.data as InboundInspectionRow & {
    item: { readableId: string | null; name: string; type: string } | null;
    receipt: {
      receiptId: string;
      supplierId: string | null;
      createdBy: string;
    } | null;
    supplier: { name: string } | null;
    inboundInspectionSample: InboundInspectionSample[];
  };

  if (insp.companyId !== companyId) {
    throw redirect(path.to.inboundInspections);
  }

  const lotEntities = await getInboundInspectionLotTrackedEntities(
    insp.receiptLineId
  );

  return data({
    inspection: insp,
    receiptReadableId: insp.receipt?.receiptId ?? null,
    receiverId: insp.receipt?.createdBy ?? null,
    itemName: insp.item?.name ?? "",
    supplierName: insp.supplier?.name ?? null,
    samples: insp.inboundInspectionSample ?? [],
    lotEntities: (lotEntities.data ?? []) as InspectionTrackedEntity[],
    issueTypes: (issueTypes.data ?? []) as IssueTypeListItem[],
    enforceFourEyes:
      ((settings.data as any)?.enforceInspectionFourEyes as boolean) ?? false,
    currentUserId: userId
  });
}

export default function InboundInspectionRoute() {
  const {
    inspection,
    receiptReadableId,
    receiverId,
    itemName,
    supplierName,
    samples,
    lotEntities,
    issueTypes,
    enforceFourEyes,
    currentUserId
  } = useLoaderData<typeof loader>();

  return (
    <InboundInspectionLotView
      inspection={inspection as InboundInspectionRow}
      receiptReadableId={receiptReadableId}
      receiverId={receiverId}
      itemName={itemName}
      supplierName={supplierName}
      samples={samples as InboundInspectionSample[]}
      lotEntities={lotEntities as InspectionTrackedEntity[]}
      issueTypes={issueTypes as IssueTypeListItem[]}
      currentUserId={currentUserId}
      enforceFourEyes={enforceFourEyes}
    />
  );
}
