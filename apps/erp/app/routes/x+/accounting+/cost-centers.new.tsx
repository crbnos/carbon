import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useSearchParams } from "react-router";
import { costCenterValidator, upsertCostCenter } from "~/modules/accounting";
import { CostCenterForm } from "~/modules/accounting/ui/CostCenters";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(costCenterValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createCostCenter = await upsertCostCenter({
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (createCostCenter.error) {
    return modal
      ? data(
          createCostCenter,
          await flash(
            request,
            error(createCostCenter.error, "Failed to insert cost center")
          )
        )
      : redirect(
          path.to.costCenters,
          await flash(
            request,
            error(createCostCenter.error, "Failed to create cost center.")
          )
        );
  }

  return modal
    ? data(createCostCenter, { status: 201 })
    : redirect(
        path.to.costCenters,
        await flash(request, success("Cost center created"))
      );
}

export default function NewCostCenterRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const parentCostCenterId =
    searchParams.get("parentCostCenterId") ?? undefined;

  const initialValues = {
    name: "",
    parentCostCenterId,
    ownerId: ""
  };

  return (
    <CostCenterForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
