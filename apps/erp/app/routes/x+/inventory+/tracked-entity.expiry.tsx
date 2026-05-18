import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  trackedEntityExpiryValidator,
  updateTrackedEntityExpiry
} from "~/modules/inventory";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const formData = await request.formData();
  const validation = await validator(trackedEntityExpiryValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  const { trackedEntityId, expirationDate, reason } = validation.data;

  const result = await updateTrackedEntityExpiry({
    trackedEntityId,
    expirationDate:
      expirationDate && expirationDate.length > 0 ? expirationDate : null,
    reason,
    userId
  });

  if (result.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.trackedEntities,
      await flash(
        request,
        error(result.error, "Failed to update expiration date")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.trackedEntities,
    await flash(request, success("Expiration date updated"))
  );
}
