// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { changeNoticeStatusValidator } from "~/modules/items";
import { transitionChangeNotice } from "~/modules/items/items.server";
import { getDatabaseClient } from "~/services/database.server";
import { path, requestReferrer } from "~/utils/path";

const approvalOutcomeFlash = {
  requested: success("Submitted for approval"),
  "already-pending": error(
    null,
    "This change notice is already waiting for approval"
  )
};

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {
    update: "parts"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(changeNoticeStatusValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { fromStatus, status: toStatus, assignee } = validation.data;

  // The approval gate, the release on Done, approval withdrawal and stage
  // notifications all live in transitionChangeNotice, shared with the API.
  const result = await transitionChangeNotice(client, getDatabaseClient(), {
    id,
    companyId,
    userId,
    fromStatus,
    toStatus,
    assignee
  });

  const back = requestReferrer(request) ?? path.to.changeNoticeDetails(id);
  if (result.error) {
    throw redirect(
      back,
      await flash(
        request,
        error(result.error.cause ?? null, result.error.message)
      )
    );
  }
  if (result.data.approval) {
    throw redirect(
      back,
      await flash(request, approvalOutcomeFlash[result.data.approval])
    );
  }

  throw redirect(
    back,
    await flash(request, success("Updated change notice status"))
  );
}
