// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { validationError, validator } from "@carbon/form";
import { getLogger } from "@carbon/logger";
import type { ActionFunctionArgs } from "react-router";
import { feedbackValidator, setFeedback } from "~/modules/agent";

const logger = getLogger("erp", "agent-feedback");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const validation = await validator(feedbackValidator).validate(
    await request.formData()
  );
  if (validation.error) return validationError(validation.error);

  const { messageId, feedback, note } = validation.data;
  const result = await setFeedback(client, {
    messageId,
    companyId,
    feedback,
    note
  });
  if (result.error) {
    logger.error("Failed to save agent feedback", {
      companyId,
      messageId,
      error: result.error
    });
  }
  // No row means the answer was never saved (or is not the caller's).
  return { success: !result.error && !!result.data };
}
