// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteAttributeRecord } from "~/services/operations.service";
import { STEP_RECORD_REMOVE_REFUSAL } from "~/services/step-records";

export async function action({ params, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {});
  const { id } = params;

  if (!id) {
    throw notFound("Attribute ID is required");
  }

  const serviceRole = await getCarbonServiceRole();

  const attributeDelete = await deleteAttributeRecord(serviceRole, {
    id,
    companyId,
    userId
  });

  if (attributeDelete.error) {
    return data(
      { success: false },
      await flash(
        request,
        error(attributeDelete.error, "Failed to remove recorded value")
      )
    );
  }

  // The delete matches only the caller's own record, so an empty result is
  // someone else's record (or one already removed), not a success.
  if (!attributeDelete.data?.length) {
    return data(
      { success: false },
      await flash(request, error(null, STEP_RECORD_REMOVE_REFUSAL))
    );
  }

  return data(
    { success: true },
    await flash(request, success("Recorded value removed"))
  );
}
