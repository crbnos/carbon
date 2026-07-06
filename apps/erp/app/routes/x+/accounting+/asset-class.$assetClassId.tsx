import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetClassValidator,
  getFixedAssetClass,
  upsertFixedAssetClass
} from "~/modules/accounting";
import { AssetClassForm } from "~/modules/accounting/ui/FixedAssets";
import { getCompanySettings } from "~/modules/settings";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { assetClassId } = params;
  if (!assetClassId) throw notFound("Asset Class ID was not found");

  const [assetClass, companySettings] = await Promise.all([
    getFixedAssetClass(client, assetClassId),
    getCompanySettings(client, companyId)
  ]);

  if (assetClass.error) {
    throw redirect(
      path.to.assetClasses,
      await flash(request, error(assetClass.error, "Failed to get asset class"))
    );
  }

  return {
    assetClass: assetClass.data,
    taxDepreciationEnabled:
      (companySettings.data as any)?.assetTaxDepreciationEnabled ?? false
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(fixedAssetClassValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw notFound("Asset Class ID was not found");

  const result = await upsertFixedAssetClass(client, {
    id,
    ...d,
    updatedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.assetClasses,
      await flash(request, error(result.error, "Failed to update asset class"))
    );
  }

  throw redirect(
    path.to.assetClasses,
    await flash(request, success("Asset class updated"))
  );
}

export default function AssetClassRoute() {
  const { assetClass, taxDepreciationEnabled } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: assetClass.id,
    name: assetClass.name,
    description: assetClass.description ?? "",
    depreciationMethod: assetClass.depreciationMethod,
    usefulLifeMonths: assetClass.usefulLifeMonths,
    residualValuePercent: Number(assetClass.residualValuePercent),
    assetAccountId: assetClass.assetAccountId,
    accumulatedDepreciationAccountId:
      assetClass.accumulatedDepreciationAccountId,
    depreciationExpenseAccountId: assetClass.depreciationExpenseAccountId,
    writeOffAccountId: assetClass.writeOffAccountId,
    writeDownAccountId: assetClass.writeDownAccountId,
    disposalAccountId: assetClass.disposalAccountId,
    taxDepreciationMethod: (assetClass as any).taxDepreciationMethod ?? null,
    taxUsefulLifeMonths: (assetClass as any).taxUsefulLifeMonths ?? null,
    taxResidualValuePercent:
      (assetClass as any).taxResidualValuePercent != null
        ? Number((assetClass as any).taxResidualValuePercent)
        : null,
    macrsPropertyClass: (assetClass as any).macrsPropertyClass ?? null,
    macrsConvention: (assetClass as any).macrsConvention ?? null,
    bonusDepreciationPercent:
      (assetClass as any).bonusDepreciationPercent != null
        ? Number((assetClass as any).bonusDepreciationPercent)
        : null
  };

  return (
    <AssetClassForm
      onClose={() => navigate(-1)}
      key={initialValues.id}
      initialValues={initialValues}
      taxDepreciationEnabled={taxDepreciationEnabled}
    />
  );
}
