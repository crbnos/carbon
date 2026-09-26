import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetReturnToInventoryValidator,
  getFixedAsset,
  invokeAssetTransfer
} from "~/modules/accounting";
import { FixedAssetReturnToInventoryForm } from "~/modules/accounting/ui/FixedAssets";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
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

  if (!asset.data.itemId) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(
          null,
          "Only an asset capitalized from inventory can be returned to inventory"
        )
      )
    );
  }

  if (
    asset.data.status !== "Active" &&
    asset.data.status !== "Fully Depreciated"
  ) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(
          null,
          "Only Active or Fully Depreciated assets can be returned to inventory"
        )
      )
    );
  }

  if (asset.data.outOfServiceSince) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(
          null,
          "Return the asset to service before returning it to inventory"
        )
      )
    );
  }

  const timeZone = await getCompanyTimeZone(client, companyId);

  const currentNBV =
    Number(asset.data.acquisitionCost) -
    Number(asset.data.accumulatedDepreciation);

  return {
    currentNBV,
    itemId: asset.data.itemId,
    initialValues: {
      transferDate: datetime.today(timeZone).toString(),
      locationId: asset.data.locationId ?? "",
      storageUnitId: ""
    }
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const formData = await request.formData();
  const validation = await validator(
    fixedAssetReturnToInventoryValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { storageUnitId, ...transfer } = validation.data;

  const result = await invokeAssetTransfer(client, {
    type: "return",
    companyId,
    userId,
    fixedAssetId,
    ...transfer,
    storageUnitId: storageUnitId || null
  });

  if (result.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(
          result.error,
          await getEdgeFunctionErrorMessage(
            result.error,
            "Failed to return the asset to inventory"
          )
        )
      )
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset returned to inventory"))
  );
}

export default function ReturnFixedAssetToInventoryRoute() {
  const { currentNBV, itemId, initialValues } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <FixedAssetReturnToInventoryForm
      initialValues={initialValues}
      currentNBV={currentNBV}
      itemId={itemId}
      onClose={() => navigate(-1)}
    />
  );
}
