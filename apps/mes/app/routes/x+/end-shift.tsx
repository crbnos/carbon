// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { clearConsolePinIn } from "@carbon/auth/console-pin.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { endShift } from "~/services/commands.timecard.server";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId, consoleMode } = await requirePermissions(
    request,
    {}
  );
  await request.formData();

  const serviceRole = await getCarbonServiceRole();

  const result = await endShift(client, serviceRole, {
    companyId,
    userId,
    consoleMode
  });

  if (!result.ok) {
    return data(
      { success: false, message: result.failure.message },
      { status: 500 }
    );
  }

  // In console mode, pin out the operator after ending their shift
  const headers = new Headers();
  if (result.data.endedConsole) {
    headers.append("Set-Cookie", await clearConsolePinIn(companyId));
  }

  return data(
    { success: true, message: "Successfully ended shift" },
    headers.has("Set-Cookie") ? { headers } : undefined
  );
}
