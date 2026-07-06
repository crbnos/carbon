import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getPickingList,
  pickingListValidator,
  upsertPickingList
} from "~/modules/inventory";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "inventory"
  });

  const { pickingListId } = params;
  if (!pickingListId) throw new Error("pickingListId not found");

  const { client: viewClient } = await requirePermissions(request, {
    view: "inventory"
  });
  const existing = await getPickingList(viewClient, pickingListId);
  if (existing.data?.status && !["Draft"].includes(existing.data.status)) {
    throw redirect(
      path.to.pickingList(pickingListId),
      await flash(
        request,
        error(null, "Cannot modify a locked picking list. Reopen it first.")
      )
    );
  }

  const formData = await request.formData();
  const validation = await validator(pickingListValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, pickingListId: validatedPickingListId, ...d } = validation.data;
  if (!id) throw new Error("id not found");
  if (!validatedPickingListId) throw new Error("pickingListId not found");

  const updateResult = await upsertPickingList(client, {
    id,
    pickingListId: validatedPickingListId,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateResult.error) {
    throw redirect(
      path.to.pickingList(pickingListId),
      await flash(
        request,
        error(updateResult.error, "Failed to update picking list")
      )
    );
  }

  throw redirect(
    path.to.pickingList(pickingListId),
    await flash(request, success("Updated picking list"))
  );
}
