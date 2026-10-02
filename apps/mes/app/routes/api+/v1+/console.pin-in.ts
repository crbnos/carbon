// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ApiErrorCode } from "@carbon/auth/api-user.server";
import { ApiError } from "@carbon/auth/api-user.server";
import { consolePinMaxAgeMs } from "@carbon/auth/console-pin.server";
import {
  signOperatorToken,
  terminalTokenMatches
} from "@carbon/auth/console-token.server";
import { isConsoleModeEnabledForCompany } from "@carbon/ee/console.server";
import { consolePinInResponse, HEADERS, pinInBody } from "@carbon/mes-core";
import { getClientIp } from "@carbon/utils";
import type { PinInFailure } from "~/services/commands.console.server";
import { pinInOperator } from "~/services/commands.console.server";
import { getDatabaseClient } from "~/services/database.server";
import { apiRoute, methodNotAllowed } from "./lib/route.server";

/**
 * An operator pins in at a shared tablet — the mobile counterpart of
 * `x+/console.pin-in.tsx`, running the same `pinInOperator`, the same two
 * Redis budgets and the same audit events.
 *
 * Three gates, in order, before a PIN is even looked at:
 *
 * 1. a valid Bearer token for the terminal account (`apiRoute` → `requireApiUser`);
 * 2. an `x-carbon-terminal` token this server signed FOR THAT COMPANY AND THAT
 *    SESSION — so a token lifted off one tablet cannot pin anyone in on
 *    another, and cannot be replayed against another tenant;
 * 3. console mode on AND entitled for the company, a definite `true`.
 *
 * Then `pinInOperator` spends the per-terminal and per-operator budgets and
 * checks the PIN in the database. What comes back is a signed operator token
 * the app holds in MEMORY ONLY — never SecureStore, never the query cache — so
 * a stolen tablet carries no operator session and a cold start lands on the
 * PIN screen. The server stores nothing: there is no session row to steal and
 * nothing to clean up.
 *
 * Deliberately NOT idempotency-keyed. That window fingerprints the request
 * body with sha256 and keeps it for 24 h; a 4-digit PIN has 10,000 preimages,
 * so storing the fingerprint would put the PIN within brute-force reach of
 * anything that can read Redis. Pinning in twice is harmless anyway — the
 * second call simply mints a second claim for the same operator.
 */

const FAILURE_CODE = {
  rate_limited: "rate_limited",
  locked: "locked",
  invalid_pin: "invalid_code",
  // "Employee not found in this company" / "No PIN set" — a 400 about the
  // `userId` in the body, which is what `validation_failed` means here.
  forbidden: "validation_failed"
} satisfies Record<PinInFailure["code"], ApiErrorCode>;

export const action = apiRoute(
  { method: "POST", body: pinInBody, idempotent: false },
  async ({ request, body, user }) => {
    if (!user) throw new Error("unreachable: console/pin-in is not public");

    // `sessionUserId`, never `userId`: a tablet with an operator already
    // pinned in is handing over to the next one, and both the binding and the
    // rate-limit budget belong to the terminal session.
    const bound = await terminalTokenMatches(
      request.headers.get(HEADERS.terminal),
      { companyId: user.companyId, sessionUserId: user.sessionUserId }
    );
    if (!bound) {
      throw new ApiError(
        403,
        "forbidden",
        "This tablet is not set up as a shared terminal"
      );
    }

    const enabled = await isConsoleModeEnabledForCompany(
      user.client,
      user.companyId
    );
    if (enabled !== true) {
      throw new ApiError(
        403,
        "forbidden",
        "Console mode is not enabled for this company"
      );
    }

    const result = await pinInOperator({
      companyId: user.companyId,
      sessionUserId: user.sessionUserId,
      userId: body.userId,
      pin: body.pin,
      ip: getClientIp(request) ?? undefined,
      db: getDatabaseClient()
    });

    if (!result.ok) {
      const { failure } = result;
      throw new ApiError(
        failure.status,
        FAILURE_CODE[failure.code],
        failure.message
      );
    }

    const operator = {
      ...result.operator,
      companyId: user.companyId,
      sessionUserId: user.sessionUserId
    };

    return consolePinInResponse.parse({
      operatorToken: await signOperatorToken(operator),
      operator: {
        userId: operator.userId,
        name: operator.name,
        avatarUrl: operator.avatarUrl
      },
      expiresAt: operator.pinnedAt + consolePinMaxAgeMs()
    });
  }
);

export const loader = methodNotAllowed();
