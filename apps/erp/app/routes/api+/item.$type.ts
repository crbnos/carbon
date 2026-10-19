// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { ITEM_TYPE_PAGES } from "@carbon/database/access";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { itemValidator } from "~/modules/items/items.models";
import { updateItem } from "~/modules/items/items.service";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { type } = params;
  if (!type) throw new Error("Could not find type");

  const page = Object.hasOwn(ITEM_TYPE_PAGES, type)
    ? ITEM_TYPE_PAGES[type]
    : undefined;
  if (!page) {
    throw new Error("Invalid type");
  }

  // The item's type picks its page.
  const { client, companyId } = await authorize(request, {
    [page]: "Create"
  });

  const formData = await request.formData();
  const validation = await validator(itemValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const update = await updateItem(client, {
    ...validation.data,
    type: type as "Part",
    companyId
  });

  if (update.error) {
    return data(
      update.error,
      await flash(request, error(update.error, "Failed to update item"))
    );
  }

  return data({ success: true }, await flash(request, success("Updated item")));
}
