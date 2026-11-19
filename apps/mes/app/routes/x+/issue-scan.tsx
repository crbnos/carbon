// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { issueScannedItem } from "~/services/issue.server";

const issueScanValidator = z.object({
  jobOperationId: z.string().min(1),
  itemId: z.string().min(1),
  // How many scans of the item this request carries.
  pieces: zfd.numeric(z.number().int().min(1).max(1000).optional()),
  parentTrackedEntityId: zfd.text(z.string().optional())
});

/** Item stickers scanned on an operation screen: issue them to the job. */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId, caller, permissions } = await requirePermissions(
    request,
    {}
  );
  // The posting runs as the system, so it checks nothing about the caller. An
  // operator on the floor may issue; an API key needs production update.
  if (
    caller === "apiKey" &&
    !permissions.production?.update?.includes(companyId)
  ) {
    return {
      success: false as const,
      message: "This API key cannot update production"
    };
  }

  const validation = await validator(issueScanValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  return issueScannedItem({ companyId, userId }, validation.data);
}
