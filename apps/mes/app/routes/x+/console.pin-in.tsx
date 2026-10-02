// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { setConsolePinIn } from "@carbon/auth/console-pin.server";
import { getClientIp } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { userContext } from "~/context";
import { pinInOperator } from "~/services/commands.console.server";
import { getDatabaseClient } from "~/services/database.server";

// The PIN verification itself — both Redis budgets, the employee lookup, the
// `verify_employee_pin` call and the audit events — lives in `pinInOperator`
// (`~/services/commands.console.server`), because the mobile API pins operators
// in too (`api+/v1+/console.pin-in.ts`) and a credential check that exists
// twice is a credential check that will drift. This route keeps what is its
// own: the console gate it reads from `userContext`, and the signed cookie that
// carries the pin-in on the web.

export async function action({ request, context }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, sessionUserId, consoleMode } = await requirePermissions(
    request,
    {}
  );

  // `userMiddleware` already asked the console gate (flag AND entitlement) for
  // this console session; `null` there means it could not tell, and pinning in
  // on an unknown answer is refused.
  if (!consoleMode || context.get(userContext)?.consoleEnabled !== true) {
    return data({ error: "Console mode is not enabled" }, { status: 403 });
  }

  const formData = await request.formData();
  const userId = formData.get("userId");
  const pin = formData.get("pin");

  if (typeof userId !== "string" || !userId) {
    return data({ error: "userId is required" }, { status: 400 });
  }

  const result = await pinInOperator({
    companyId,
    sessionUserId,
    userId,
    pin: typeof pin === "string" ? pin : "",
    ip: getClientIp(request) ?? undefined,
    db: getDatabaseClient()
  });

  if (!result.ok) {
    return data(
      { error: result.failure.message },
      { status: result.failure.status }
    );
  }

  // Return data (not a redirect) so the caller's fetcher revalidates the shell
  // loader — the `_layout` shouldRevalidate has an explicit case for this
  // action, and a redirect would drop the form context it matches on.
  return data(
    { success: true },
    {
      headers: {
        "Set-Cookie": await setConsolePinIn(
          companyId,
          sessionUserId,
          result.operator
        )
      }
    }
  );
}
