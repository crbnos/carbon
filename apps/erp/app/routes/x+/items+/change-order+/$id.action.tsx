import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  addChangeOrderActionTasksFromTemplates,
  changeOrderActionValidator,
  upsertChangeOrderAction
} from "~/modules/items";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();

  // "Add Actions" modal (Quality-style required-action picker): a comma-list of
  // changeOrderRequiredAction template ids to instantiate as tasks.
  const actionIds = formData.get("actionIds");
  if (typeof actionIds === "string") {
    const { id } = params;
    if (!id) throw new Error("id not found");
    const add = await addChangeOrderActionTasksFromTemplates(client, {
      changeOrderId: id,
      requiredActionIds: actionIds.split(",").filter(Boolean),
      companyId,
      userId
    });
    if (add.error) {
      return data(
        { success: false },
        await flash(request, error(add.error, "Failed to add actions"))
      );
    }
    return { success: true };
  }

  const validation = await validator(changeOrderActionValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, changeOrderId, name, assignee, dueDate } = validation.data;

  const upsert = await upsertChangeOrderAction(client, {
    id,
    changeOrderId,
    name,
    assignee,
    dueDate,
    companyId,
    userId
  });

  if (upsert.error) {
    return data(
      { success: false },
      await flash(request, error(upsert.error, "Failed to save action"))
    );
  }

  return { success: true };
}
