import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  fixedAssetCapitalizeValidator,
  invokeAssetTransfer
} from "~/modules/accounting";
import { FixedAssetCapitalizeForm } from "~/modules/accounting/ui/FixedAssets";
import { getTrackedEntity } from "~/modules/inventory";
import { getItem, getItemCost } from "~/modules/items";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { path } from "~/utils/path";

// The name the function derives when none is given — shown so the user can
// see (and change) what the asset will be called.
const RENTAL_FLEET_CLASS_NAME = "Rental Fleet";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const searchParams = new URL(request.url).searchParams;
  const itemId = searchParams.get("itemId");
  const trackedEntityId = searchParams.get("trackedEntityId");
  const locationId = searchParams.get("locationId");
  const storageUnitId = searchParams.get("storageUnitId");

  if (!itemId || !trackedEntityId || !locationId) {
    throw redirect(
      path.to.fixedAssets,
      await flash(
        request,
        error(
          null,
          "Choose a serialized unit from the item's inventory to capitalize"
        )
      )
    );
  }

  const [entity, item, itemCost, assetClasses, timeZone] = await Promise.all([
    getTrackedEntity(client, trackedEntityId),
    getItem(client, itemId),
    getItemCost(client, itemId, companyId),
    // A CIP class is a holding account, never a capitalization target.
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

  if (
    entity.error ||
    entity.data.companyId !== companyId ||
    entity.data.itemId !== itemId
  ) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(entity.error, "Tracked entity not found"))
    );
  }

  if (item.error || item.data.companyId !== companyId) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(item.error, "Item not found"))
    );
  }

  const classes = assetClasses.data ?? [];
  const rentalFleetClassId =
    classes.find((c) => c.name === RENTAL_FLEET_CLASS_NAME)?.id ?? "";
  const serialNumber = entity.data.readableId;

  return {
    initialValues: {
      fixedAssetClassId: rentalFleetClassId,
      itemId,
      trackedEntityId,
      locationId,
      storageUnitId: storageUnitId ?? "",
      transferDate: datetime.today(timeZone).toString(),
      name: [item.data.name, serialNumber].filter(Boolean).join(" ")
    },
    assetClasses: classes,
    item: {
      readableId: item.data.readableIdWithRevision ?? item.data.readableId,
      name: item.data.name
    },
    serialNumber,
    unitCost: Number(itemCost.data?.unitCost ?? 0)
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const validation = await validator(fixedAssetCapitalizeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { storageUnitId, name, ...transfer } = validation.data;

  const result = await invokeAssetTransfer(client, {
    type: "capitalize",
    companyId,
    userId,
    ...transfer,
    storageUnitId: storageUnitId || null,
    name: name || null
  });

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(
          result.error,
          await getEdgeFunctionErrorMessage(
            result.error,
            "Failed to capitalize the unit"
          )
        )
      )
    );
  }

  const fixedAssetId = (result.data as { fixedAssetId?: string } | null)
    ?.fixedAssetId;
  if (!fixedAssetId) {
    return data(
      {},
      await flash(request, error(null, "Failed to capitalize the unit"))
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset capitalized"))
  );
}

export default function CapitalizeFixedAssetRoute() {
  const { initialValues, assetClasses, item, serialNumber, unitCost } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <FixedAssetCapitalizeForm
      initialValues={initialValues}
      assetClasses={assetClasses}
      item={item}
      serialNumber={serialNumber}
      unitCost={unitCost}
      onClose={() => navigate(-1)}
    />
  );
}
