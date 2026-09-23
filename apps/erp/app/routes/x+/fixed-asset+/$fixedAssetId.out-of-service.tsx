import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  fixedAssetOutOfServiceValidator,
  getFixedAsset,
  returnFixedAssetToService,
  setFixedAssetOutOfService
} from "~/modules/accounting";
import { FixedAssetOutOfServiceForm } from "~/modules/accounting/ui/FixedAssets";
import { getOnRentLineForAsset } from "~/modules/sales";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

/** A redirect when the unit is on rent: it goes to maintenance through the
 *  agreement's Return (with "Take out of service"), never around it. Read
 *  with the service role, scoped to the company and the asset: agreement
 *  lines need sales_view, which an accountant may not hold, and under RLS
 *  that reads as "not on rent". A failed read refuses rather than passes. */
async function refuseWhileOnRent(
  request: Request,
  fixedAssetId: string,
  companyId: string
) {
  const onRent = await getOnRentLineForAsset(
    getCarbonServiceRole(),
    fixedAssetId,
    companyId
  );
  if (onRent.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(onRent.error, "Failed to check whether the asset is on rent")
      )
    );
  }
  if (!onRent.data) return;
  const agreement = onRent.data.rentalAgreement;
  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(
      request,
      error(
        null,
        `The asset is on rent${agreement ? ` on ${agreement.rentalAgreementId}` : ""}; return it from the agreement and take it out of service there`
      )
    )
  );
}

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

  if (asset.data.outOfServiceSince) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, error(null, "The asset is already out of service"))
    );
  }

  if (asset.data.status === "Disposed") {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(null, "A disposed asset cannot be taken out of service")
      )
    );
  }

  await refuseWhileOnRent(request, fixedAssetId, companyId);

  return null;
}

// POST with `?intent=return` clears the out-of-service state and needs no
// body; a plain POST takes the asset out of service with the form's reason.
export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw notFound("fixedAssetId not found");

  const intent = new URL(request.url).searchParams.get("intent");

  if (intent === "return") {
    const result = await returnFixedAssetToService(client, {
      id: fixedAssetId,
      companyId,
      updatedBy: userId
    });

    if (result.error) {
      throw redirect(
        path.to.fixedAsset(fixedAssetId),
        await flash(
          request,
          error(result.error, "Failed to return the asset to service")
        )
      );
    }

    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(request, success("Asset returned to service"))
    );
  }

  const formData = await request.formData();
  const validation = await validator(fixedAssetOutOfServiceValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  await refuseWhileOnRent(request, fixedAssetId, companyId);

  const timeZone = await getCompanyTimeZone(client, companyId);

  const result = await setFixedAssetOutOfService(client, {
    id: fixedAssetId,
    companyId,
    reason: validation.data.reason,
    since: datetime.today(timeZone).toString(),
    updatedBy: userId
  });

  if (result.error) {
    throw redirect(
      path.to.fixedAsset(fixedAssetId),
      await flash(
        request,
        error(result.error, "Failed to take the asset out of service")
      )
    );
  }

  throw redirect(
    path.to.fixedAsset(fixedAssetId),
    await flash(request, success("Asset taken out of service"))
  );
}

export default function FixedAssetOutOfServiceRoute() {
  const navigate = useNavigate();

  return <FixedAssetOutOfServiceForm onClose={() => navigate(-1)} />;
}
