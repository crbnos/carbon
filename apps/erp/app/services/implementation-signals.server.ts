// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { redis } from "@carbon/kv";
import { getLogger } from "@carbon/logger";
import type { Signals } from "@carbon/onboarding";
import { detectImplementationSignals } from "@carbon/onboarding/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const log = getLogger("erp", "implementation-signals");

// A day, not forever: wiping a company's data (a demo template revert, a
// restore) can make a signal false again, and this bounds how long the hub
// would keep showing that step as done.
const TTL_SECONDS = 60 * 60 * 24;

const key = (companyId: string) => `implementation:signals:${companyId}`;

/**
 * The hub's product signals, probing only the ones not already seen true.
 *
 * The app shell loads these on every page for an enrolled company — five
 * existence queries each time. A signal that is true stays true, so it is
 * remembered per company and its probe is skipped; a company that has done
 * all five steps costs one Redis read instead.
 */
export async function getImplementationSignals(
  client: SupabaseClient<Database>,
  companyId: string
): Promise<Signals> {
  let known: Partial<Signals> = {};
  try {
    const cached = await redis.get(key(companyId));
    if (cached) known = JSON.parse(cached) as Partial<Signals>;
  } catch (error) {
    // Redis is an optimisation here; without it, probe everything.
    log.warn("Could not read cached implementation signals", {
      companyId,
      error
    });
  }

  const signals = await detectImplementationSignals(client, companyId, known);

  const seen = Object.fromEntries(
    Object.entries(signals).filter(([, value]) => value)
  ) as Partial<Signals>;
  if (Object.keys(seen).length > Object.keys(known).length) {
    try {
      await redis.set(key(companyId), JSON.stringify(seen), "EX", TTL_SECONDS);
    } catch (error) {
      log.warn("Could not cache implementation signals", { companyId, error });
    }
  }
  return signals;
}
