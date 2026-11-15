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
  parentTrackedEntityId: zfd.text(z.string().optional())
});

/** An item sticker scanned on an operation screen: issue it to the job. */
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId, companyId } = await requirePermissions(request, {});

  const validation = await validator(issueScanValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  return issueScannedItem({ companyId, userId }, validation.data);
}
