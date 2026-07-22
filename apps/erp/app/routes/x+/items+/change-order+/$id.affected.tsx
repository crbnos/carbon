import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  addChangeOrderAffectedItem,
  changeOrderAffectedItemValidator,
  changeOrderNewPartValidator
} from "~/modules/items";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();

  // Net-new "New Part": no existing itemId — mint a brand-new Part/Tool and add
  // it as a New Part affected item. The other change types add an existing item.
  if (formData.get("changeType") === "New Part") {
    const validation = await validator(changeOrderNewPartValidator).validate(
      formData
    );
    if (validation.error) {
      return validationError(validation.error);
    }
    const {
      changeOrderId,
      readableId,
      name,
      replenishmentSystem,
      itemTrackingType
    } = validation.data;
    const add = await addChangeOrderAffectedItem(client, {
      changeOrderId,
      changeType: "New Part",
      // A net-new affected item is always a Part.
      newPart: {
        readableId,
        name,
        itemType: "Part",
        replenishmentSystem,
        itemTrackingType
      },
      companyId,
      userId
    });
    if (add.error || !add.data) {
      return data(
        { success: false },
        await flash(
          request,
          error(add.error, add.error?.message ?? "Failed to add new part")
        )
      );
    }
    return { success: true, id: add.data.id };
  }

  const validation = await validator(changeOrderAffectedItemValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { changeOrderId, itemId, changeType, revision } = validation.data;

  const add = await addChangeOrderAffectedItem(client, {
    changeOrderId,
    itemId,
    changeType,
    // Only a Revision change consumes an explicit revision label.
    revision: changeType === "Revision" ? revision : undefined,
    companyId,
    userId
  });

  if (add.error || !add.data) {
    return data(
      { success: false },
      await flash(
        request,
        error(add.error, add.error?.message ?? "Failed to add affected item")
      )
    );
  }

  return { success: true, id: add.data.id };
}
