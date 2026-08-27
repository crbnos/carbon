import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getCompanyTimeZone } from "@carbon/database";
import { getDatabaseClient } from "~/services/database.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { applyRepairWarranty, applyRepairWarrantyValidator } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(applyRepairWarrantyValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const timezone = await getCompanyTimeZone(client, companyId);
  const today = datetime.today(timezone).toString();

  try {
    await applyRepairWarranty(getDatabaseClient(), {
      lineId: validation.data.lineId,
      warrantyTermId: validation.data.warrantyTermId,
      companyId,
      userId,
      today
    });
  } catch (err) {
    throw redirect(
      path.to.repairOrderDetails(id),
      await flash(
        request,
        error(err, (err as Error)?.message ?? "Failed to apply repair warranty")
      )
    );
  }

  throw redirect(
    path.to.repairOrderDetails(id),
    await flash(request, success("Repair warranty registered"))
  );
}
