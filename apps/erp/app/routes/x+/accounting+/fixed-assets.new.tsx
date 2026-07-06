import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { fixedAssetValidator, insertFixedAsset } from "~/modules/accounting";
import { FixedAssetForm } from "~/modules/accounting/ui/FixedAssets";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(fixedAssetValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  const result = await insertFixedAsset(client, {
    ...d,
    status: "Draft",
    companyId,
    createdBy: userId
  });

  if (result.error || !result.data) {
    return redirect(
      path.to.fixedAssets,
      await flash(request, error(result.error, "Failed to create fixed asset"))
    );
  }

  throw redirect(
    path.to.fixedAsset(result.data.id),
    await flash(request, success("Fixed asset created"))
  );
}

export default function NewFixedAssetRoute() {
  const navigate = useNavigate();

  const initialValues = {
    fixedAssetClassId: "",
    name: "",
    description: "",
    serialNumber: "",
    depreciationMethod: "Straight Line" as const,
    usefulLifeMonths: 60,
    residualValuePercent: 0
  };

  return (
    <FixedAssetForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
