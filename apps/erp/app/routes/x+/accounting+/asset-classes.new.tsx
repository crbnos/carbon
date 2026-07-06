import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetClassValidator,
  getDefaultAccounts,
  upsertFixedAssetClass
} from "~/modules/accounting";
import { AssetClassForm } from "~/modules/accounting/ui/FixedAssets";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "accounting"
  });

  const [defaults, companySettings] = await Promise.all([
    getDefaultAccounts(client, companyId),
    getCompanySettings(client, companyId)
  ]);

  return {
    defaults: defaults.data,
    taxDepreciationEnabled:
      (companySettings.data as any)?.assetTaxDepreciationEnabled ?? false
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(fixedAssetClassValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;
  const modal = formData.get("type") === "modal";

  const result = await upsertFixedAssetClass(client, {
    ...d,
    companyId,
    createdBy: userId
  });

  if (result.error) {
    return modal
      ? result
      : redirect(
          path.to.assetClasses,
          await flash(
            request,
            error(result.error, "Failed to create asset class")
          )
        );
  }

  if (modal) return result;

  throw redirect(
    path.to.assetClasses,
    await flash(request, success("Asset class created"))
  );
}

export default function NewAssetClassRoute() {
  const navigate = useNavigate();
  const { defaults, taxDepreciationEnabled } = useLoaderData<typeof loader>();

  const initialValues = {
    name: "",
    description: "",
    depreciationMethod: "Straight Line" as const,
    usefulLifeMonths: 60,
    residualValuePercent: 0,
    assetAccountId: defaults?.assetAquisitionCostAccount ?? "",
    accumulatedDepreciationAccountId:
      defaults?.accumulatedDepreciationAccount ?? "",
    depreciationExpenseAccountId:
      defaults?.assetDepreciationExpenseAccount ?? "",
    writeOffAccountId: defaults?.assetGainsAndLossesAccount ?? "",
    writeDownAccountId: defaults?.assetGainsAndLossesAccount ?? "",
    disposalAccountId: defaults?.assetGainsAndLossesAccount ?? ""
  };

  return (
    <AssetClassForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
      taxDepreciationEnabled={taxDepreciationEnabled}
    />
  );
}
