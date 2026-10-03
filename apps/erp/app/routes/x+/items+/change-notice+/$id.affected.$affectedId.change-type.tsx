// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  changeNoticeAffectedItemChangeTypeValidator,
  updateChangeNoticeAffectedItemChangeType
} from "~/modules/items";
import {
  requireChangeNoticeChildRoute,
  requireEditableChangeNoticeRoute
} from "~/modules/items/items.server";
import { getDatabaseClient } from "~/services/database.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const changeNoticeId = params.id;
  if (!changeNoticeId) throw new Error("Could not find id");

  const locked = await requireEditableChangeNoticeRoute(request, {
    client,
    changeNoticeId,
    companyId,
    scope: "engineering"
  });
  if (locked) return locked;

  const formData = await request.formData();
  const validation = await validator(
    changeNoticeAffectedItemChangeTypeValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, changeType } = validation.data;

  // A New Part is net-new by construction — it can't be switched to (or away
  // from) another type. Belt-and-suspenders with the service-level guard.
  if (changeType === "New Part") {
    return data(
      { success: false },
      await flash(
        request,
        error(null, "New Part change type cannot be switched")
      )
    );
  }

  const owned = await requireChangeNoticeChildRoute(request, {
    client,
    table: "changeOrderAffectedItem",
    id,
    changeNoticeId,
    companyId
  });
  if (owned) return owned;

  const update = await updateChangeNoticeAffectedItemChangeType(
    client,
    getDatabaseClient(),
    {
      id,
      changeType,
      companyId,
      userId
    }
  );

  if (update.error) {
    return data(
      { success: false },
      await flash(request, error(update.error, "Failed to change type"))
    );
  }

  return { success: true, id: update.data?.id };
}
