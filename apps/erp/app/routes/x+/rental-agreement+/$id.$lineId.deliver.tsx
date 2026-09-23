import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getRentalAgreement, getRentalAgreementLine } from "~/modules/sales";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  if (agreement.data.status !== "Active" || line.data.status !== "Pending") {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(
        request,
        error(
          null,
          "Only a pending unit on an active agreement can be delivered"
        )
      )
    );
  }

  // A unit out of service stays in the yard until it is returned to service.
  // Read with the service role, scoped to the company and the line's unit:
  // the fleet register needs accounting_view, which a sales user may not
  // hold, and under RLS an unreadable unit looked available. A failed or
  // empty read refuses the delivery.
  if (line.data.fixedAssetId) {
    const asset = await getCarbonServiceRole()
      .from("fleetAssets")
      .select("fleetStatus, outOfServiceReason")
      .eq("id", line.data.fixedAssetId)
      .eq("companyId", companyId)
      .maybeSingle();
    if (asset.error || !asset.data) {
      throw redirect(
        path.to.rentalAgreementDetails(id),
        await flash(request, error(asset.error, "Failed to load the unit"))
      );
    }
    if (asset.data.fleetStatus === "In Maintenance") {
      throw redirect(
        path.to.rentalAgreementDetails(id),
        await flash(
          request,
          error(
            null,
            asset.data.outOfServiceReason
              ? `The unit is out of service: ${asset.data.outOfServiceReason}`
              : "The unit is out of service"
          )
        )
      );
    }
  }

  const timeZone = await getCompanyTimeZone(client, companyId);

  const update = await client
    .from("rentalAgreementLine")
    .update({
      deliveredAt: datetime.today(timeZone).toString(),
      status: "On Rent",
      updatedBy: userId,
      updatedAt: datetime.timestamp()
    })
    .eq("id", lineId)
    .eq("companyId", companyId)
    .eq("status", "Pending")
    .select("id")
    .single();

  if (update.error) {
    throw redirect(
      path.to.rentalAgreementDetails(id),
      await flash(request, error(update.error, "Failed to deliver the unit"))
    );
  }

  throw redirect(
    path.to.rentalAgreementDetails(id),
    await flash(request, success("Unit delivered"))
  );
}
