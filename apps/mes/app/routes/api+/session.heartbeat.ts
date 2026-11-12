// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  resolveConsolePinIn,
  setConsolePinActivity
} from "@carbon/auth/console-pin.server";
import { touchAuthSession } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";

// Genuine user activity extends the session idle clock, or the operator's
// console pin-in. A pin-in that has already expired cannot be revived here.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, sessionUserId, consoleMode } = await requirePermissions(
    request,
    {}
  );
  if (consoleMode) {
    const pinIn = await resolveConsolePinIn(request, companyId, sessionUserId);
    if (!pinIn) return data({ ok: false });
    return data(
      { ok: true },
      {
        headers: {
          "Set-Cookie": await setConsolePinActivity(
            companyId,
            sessionUserId,
            pinIn.pinId
          )
        }
      }
    );
  }
  const cookie = await touchAuthSession(request);
  return data(
    { ok: Boolean(cookie) },
    cookie ? { headers: { "Set-Cookie": cookie } } : undefined
  );
}
