import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { costCenterValidator } from "~/modules/accounting";
import {
  getCostCenter,
  upsertCostCenter
} from "~/modules/accounting/accounting.service.server";
import { CostCenterForm } from "~/modules/accounting/ui/CostCenters";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "accounting"
  });

  const { costCenterId } = params;
  if (!costCenterId) throw notFound("Cost Center ID was not found");

  const costCenter = await getCostCenter(costCenterId);

  if (costCenter.error) {
    throw redirect(
      path.to.costCenters,
      await flash(request, error(costCenter.error, "Failed to get cost center"))
    );
  }

  return {
    costCenter: costCenter.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(costCenterValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw notFound("Cost Center ID was not found");

  const updateCostCenter = await upsertCostCenter({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateCostCenter.error) {
    throw redirect(
      path.to.costCenters,
      await flash(
        request,
        error(updateCostCenter.error, "Failed to update cost center.")
      )
    );
  }

  throw redirect(
    path.to.costCenters,
    await flash(request, success("Cost center updated"))
  );
}

export default function CostCenterRoute() {
  const { costCenter } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: costCenter.id,
    name: costCenter.name,
    parentCostCenterId: costCenter.parentCostCenterId ?? undefined,
    ownerId: costCenter.ownerId ?? "",
    ...getCustomFields(costCenter.customFields)
  };

  return (
    <CostCenterForm
      onClose={() => navigate(-1)}
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
