// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RATE_LIMIT } from "@carbon/auth";
import { AccountLockout, Ratelimit, redis } from "@carbon/kv";

/**
 * The mobile auth endpoints get their OWN rate-limit bucket.
 *
 * Web login, mfa and unlock all call `new Ratelimit({ redis, limiter:
 * slidingWindow(RATE_LIMIT, "1 h") })` with the default prefix and the bare IP
 * as the key, so they SHARE one bucket of 5/hour per IP. Every tablet in a
 * plant leaves through one NAT address, and a single sign-in spends three calls
 * (code, verify, mfa) — on the shared bucket the second operator of the shift
 * would be locked out. A separate prefix with a higher ceiling keeps the web
 * bucket exactly as it is.
 */
export const authIpRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(RATE_LIMIT * 6, "1 h"),
  prefix: "@carbon/mes-api:auth",
  analytics: true
});

/**
 * The per-EMAIL lockout is deliberately the SAME instance the web login uses
 * (default prefix): 5 attempts / 15 min with exponential backoff. That is the
 * NIST control, and an attacker must not get a fresh allowance by switching
 * from the web form to the app.
 */
export const signInLockout = () => new AccountLockout({ redis });
