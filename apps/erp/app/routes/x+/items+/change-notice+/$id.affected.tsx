import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  addChangeNoticeAffectedItem,
  changeNoticeAffectedItemValidator,
  changeNoticeNewPartValidator
} from "~/modules/items";
import { requireEditableChangeNoticeRoute } from "~/modules/items/items.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");
  const locked = await requireEditableChangeNoticeRoute(request, {
    client,
    changeNoticeId: params.id,
    companyId,
    scope: "engineering"
  });
  if (locked) return locked;

  const formData = await request.formData();

  // Net-new "New Part": no existing itemId — mint a brand-new Part/Tool and add
  // it as a New Part affected item. The other change types add an existing item.
  if (formData.get("changeType") === "New Part") {
    const validation = await validator(changeNoticeNewPartValidator).validate(
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
    // The lock guard above authorized the notice in the URL, so the write must
    // target that same notice.
    if (changeOrderId !== id) {
      return data(
        { success: false },
        await flash(request, error(null, "Invalid change notice"))
      );
    }
    const add = await addChangeNoticeAffectedItem(client, {
      changeNoticeId: changeOrderId,
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

  const validation = await validator(
    changeNoticeAffectedItemValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { changeOrderId, itemId, changeType, revision } = validation.data;

  if (changeOrderId !== id) {
    return data(
      { success: false },
      await flash(request, error(null, "Invalid change notice"))
    );
  }

  const add = await addChangeNoticeAffectedItem(client, {
    changeNoticeId: changeOrderId,
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
