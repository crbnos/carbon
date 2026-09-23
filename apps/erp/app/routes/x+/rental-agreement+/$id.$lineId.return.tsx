import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import {
  getRentalAgreement,
  getRentalAgreementLine,
  rentalAgreementReturnValidator
} from "~/modules/sales";
import { RentalAgreementReturnForm } from "~/modules/sales/ui/Rentals";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { getEdgeFunctionErrorMessage } from "~/utils/error";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const [agreement, line] = await Promise.all([
    getRentalAgreement(client, id),
    getRentalAgreementLine(client, lineId)
  ]);

  if (
    agreement.error ||
    agreement.data?.companyId !== companyId ||
    line.error ||
    line.data.rentalAgreementId !== id
  ) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "This unit does not belong to this rental agreement")
      )
    );
  }

  if (agreement.data.status !== "Active" || line.data.status !== "On Rent") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(request, error(null, "Only a unit on rent can be returned"))
    );
  }

  const timeZone = await getCompanyTimeZone(client, companyId);
  const isSalesType = line.data.lessorClassification === "Sales-Type";

  return {
    agreementId: id,
    isSalesType,
    endDate: agreement.data.endDate,
    unitLabel:
      [line.data.fixedAsset?.fixedAssetId, line.data.fixedAsset?.name]
        .filter(Boolean)
        .join(" · ") ||
      line.data.item?.readableIdWithRevision ||
      "",
    initialValues: {
      rentalAgreementLineId: lineId,
      returnedAt: datetime.today(timeZone).toString(),
      takeOutOfService: false,
      isSalesType,
      residualDestination: undefined
    }
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id, lineId } = params;
  if (!id) throw notFound("id not found");
  if (!lineId) throw notFound("lineId not found");

  const formData = await request.formData();
  const validation = await validator(rentalAgreementReturnValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    meterIn,
    returnNotes,
    takeOutOfService,
    outOfServiceReason,
    residualDestination
  } = validation.data;

  // The posted `isSalesType` only drives the form; the line decides. A
  // Sales-Type line's closing net investment must land somewhere.
  const line = await getRentalAgreementLine(client, lineId);
  if (line.error || line.data.rentalAgreementId !== id) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(null, "This unit does not belong to this rental agreement")
      )
    );
  }
  const isSalesType = line.data.lessorClassification === "Sales-Type";
  if (isSalesType && !residualDestination) {
    return validationError({
      fieldErrors: {
        residualDestination: "Choose where the returned unit goes"
      }
    });
  }

  // The line comes from the URL; the edge function re-reads it under the
  // agreement and company before touching anything.
  const result = await client.functions.invoke("post-rental-agreement", {
    body: {
      type: "return",
      companyId,
      userId,
      rentalAgreementId: id,
      rentalAgreementLineId: lineId,
      returnedAt: validation.data.returnedAt,
      meterIn: meterIn ?? null,
      returnNotes: returnNotes ?? null,
      takeOutOfService,
      outOfServiceReason: takeOutOfService
        ? (outOfServiceReason ?? null)
        : null,
      ...(isSalesType ? { residualDestination } : {})
    }
  });

  if (result.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          result.error,
          await getEdgeFunctionErrorMessage(
            result.error,
            "Failed to return the unit"
          )
        )
      )
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(request, success("Unit returned"))
  );
}

export default function ReturnRentalAgreementLineRoute() {
  const { agreementId, unitLabel, isSalesType, endDate, initialValues } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <RentalAgreementReturnForm
      initialValues={initialValues}
      unitLabel={unitLabel}
      isSalesType={isSalesType}
      endDate={endDate}
      onClose={() => navigate(path.to.rentalAgreementDetails(agreementId))}
    />
  );
}
