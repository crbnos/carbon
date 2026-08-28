import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  repairOrderChargeValidator,
  upsertRepairOrderCharge
} from "~/modules/sales";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(repairOrderChargeValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  // biome-ignore lint/correctness/noUnusedVariables: id is stripped for insert
  const { id: chargeId, ...d } = validation.data;

  const insertCharge = await upsertRepairOrderCharge(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (insertCharge.error) {
    throw redirect(
      path.to.repairOrderDetails(id),
      await flash(
        request,
        error(insertCharge.error, "Failed to add the charge")
      )
    );
  }

  throw redirect(
    path.to.repairOrderDetails(id),
    await flash(request, success("Charge added"))
  );
}
