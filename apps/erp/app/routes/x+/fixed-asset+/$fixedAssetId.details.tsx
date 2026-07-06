import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetValidator,
  getFixedAsset,
  updateFixedAsset
} from "~/modules/accounting";
import { FixedAssetForm } from "~/modules/accounting/ui/FixedAssets";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const asset = await getFixedAsset(client, fixedAssetId);

  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  return {
    asset: asset.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(fixedAssetValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw notFound("Fixed Asset ID was not found");

  const result = await updateFixedAsset(client, {
    id,
    fixedAssetClassId: d.fixedAssetClassId,
    name: d.name,
    description: d.description ?? null,
    serialNumber: d.serialNumber ?? null,
    depreciationMethod: d.depreciationMethod,
    usefulLifeMonths: d.usefulLifeMonths,
    residualValuePercent: d.residualValuePercent,
    assetLifetimeUsage: d.assetLifetimeUsage ?? null,
    locationId: d.locationId ?? null,
    taxDepreciationMethod: d.taxDepreciationMethod ?? null,
    taxUsefulLifeMonths: d.taxUsefulLifeMonths ?? null,
    taxResidualValuePercent: d.taxResidualValuePercent ?? null,
    macrsPropertyClass: d.macrsPropertyClass ?? null,
    macrsConvention: d.macrsConvention ?? null,
    bonusDepreciationPercent: d.bonusDepreciationPercent ?? null,
    updatedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(result.error, "Failed to update fixed asset"))
    );
  }

  const { fixedAssetId } = params;
  throw redirect(
    path.to.fixedAsset(fixedAssetId!),
    await flash(request, success("Fixed asset updated"))
  );
}

export default function FixedAssetDetailsRoute() {
  const { asset } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: asset.id,
    fixedAssetClassId: asset.fixedAssetClassId,
    name: asset.name,
    description: asset.description ?? "",
    serialNumber: asset.serialNumber ?? "",
    depreciationMethod: asset.depreciationMethod,
    usefulLifeMonths: asset.usefulLifeMonths,
    residualValuePercent: Number(asset.residualValuePercent),
    assetLifetimeUsage: asset.assetLifetimeUsage
      ? Number(asset.assetLifetimeUsage)
      : undefined,
    locationId: asset.locationId ?? undefined,
    taxDepreciationMethod: (asset as any).taxDepreciationMethod ?? undefined,
    taxUsefulLifeMonths: (asset as any).taxUsefulLifeMonths ?? undefined,
    taxResidualValuePercent:
      (asset as any).taxResidualValuePercent != null
        ? Number((asset as any).taxResidualValuePercent)
        : undefined,
    macrsPropertyClass: (asset as any).macrsPropertyClass ?? undefined,
    macrsConvention: (asset as any).macrsConvention ?? undefined,
    bonusDepreciationPercent:
      (asset as any).bonusDepreciationPercent != null
        ? Number((asset as any).bonusDepreciationPercent)
        : undefined
  };

  return (
    <FixedAssetForm
      onClose={() => navigate(-1)}
      key={initialValues.id}
      initialValues={initialValues}
    />
  );
}
