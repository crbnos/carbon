// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import {
  clockInCommand,
  clockOutCommand
} from "~/services/commands.timecard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clockIn") {
    const result = await clockInCommand(client, { companyId, userId });
    return result.ok
      ? { success: true, error: undefined }
      : { success: false, error: result.failure.message };
  }

  if (intent === "clockOut") {
    const note = formData.get("note") as string | null;
    const result = await clockOutCommand(
      client,
      { companyId, userId },
      { note: note ?? undefined }
    );
    return result.ok
      ? { success: true, error: undefined }
      : { success: false, error: result.failure.message };
  }

  return { success: false, error: "Unknown intent" };
}
