// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { FAILURE_STATUS } from "~/services/api-result.server";
import { issueTrackedEntities } from "~/services/commands.materials.server";
import { issueTrackedEntityValidator } from "~/services/models";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const payload = await request.json();
  const validation = issueTrackedEntityValidator.safeParse(payload);

  if (!validation.success) {
    return data(
      { success: false, message: "Failed to validate payload" },
      { status: 400 }
    );
  }

  const serviceRole = await getCarbonServiceRole();

  const result = await issueTrackedEntities(
    serviceRole,
    { companyId, userId },
    validation.data
  );

  if (!result.ok) {
    return data(
      { success: false, message: result.failure.message },
      { status: FAILURE_STATUS[result.failure.kind] }
    );
  }

  return {
    success: true,
    message: "Material issued successfully",
    splitEntities: result.data.splitEntities,
    warning: result.data.warning
  };
}
