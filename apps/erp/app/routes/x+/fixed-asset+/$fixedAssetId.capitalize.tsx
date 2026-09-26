import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetCapitalizeCipValidator,
  getFixedAsset,
  getFixedAssetCipCosts,
  invokeAssetTransfer
} from "~/modules/accounting";
import { FixedAssetCapitalizeCipForm } from "~/modules/accounting/ui/FixedAssets";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const [asset, cipCosts, assetClasses, timeZone] = await Promise.all([
    getFixedAsset(client, fixedAssetId),
    getFixedAssetCipCosts(client, fixedAssetId, companyId),
    // The in-service classes an asset under construction can move into.
    // `getFixedAssetClassesList` does not select `isConstructionInProgress`,
    // so the filter is applied here (same select as `x+/job+/new.tsx`).
    client
      .from("fixedAssetClass")
      .select("id, name")
      .eq("companyId", companyId)
      .eq("isConstructionInProgress", false)
      .order("name"),
    getCompanyTimeZone(client, companyId)
  ]);

  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to get fixed asset"))
    );
  }

  const assetClass = asset.data.fixedAssetClass as {
    name: string;
    isConstructionInProgress: boolean;
  } | null;

  if (
    !assetClass?.isConstructionInProgress ||
    asset.data.status !== "Under Construction"
  ) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(null, "Only an asset under construction can be capitalized")
      )
    );
  }

  const totalCost = (cipCosts.data ?? []).reduce(
    (sum, cost) => sum + Number(cost.amount),
    0
  );

  return {
    initialValues: {
      toClassId: "",
      inServiceDate: datetime.today(timeZone).toString()
    },
    assetClasses: assetClasses.data ?? [],
    totalCost,
    cipClassName: assetClass.name
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
  const validation = await validator(fixedAssetCapitalizeCipValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const result = await invokeAssetTransfer(client, {
    type: "capitalizeCip",
    companyId,
    userId,
    fixedAssetId,
    ...validation.data
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
            "Failed to capitalize the asset"
          )
        )
      )
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset capitalized"))
  );
}

export default function CapitalizeCipFixedAssetRoute() {
  const { initialValues, assetClasses, totalCost, cipClassName } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <FixedAssetCapitalizeCipForm
      initialValues={initialValues}
      assetClasses={assetClasses}
      totalCost={totalCost}
      cipClassName={cipClassName}
      onClose={() => navigate(-1)}
    />
  );
}
