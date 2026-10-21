// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SYSTEM_STATUS_URL } from "@carbon/env";
import { redis } from "@carbon/kv";
import { fetchSystemStatus, type SystemStatus } from "./system-status";

const CACHE_KEY = "system-status";
const CACHE_TTL_SECONDS = 300;
// A failed fetch is cached too, briefly, so a dead host costs one request a
// minute instead of one per page.
const FAILURE_TTL_SECONDS = 60;

/**
 * The deployment's status document, or null when `SYSTEM_STATUS_URL` is unset
 * (no request is made) or the host is unreachable.
 */
export async function getSystemStatus(): Promise<SystemStatus | null> {
  if (!SYSTEM_STATUS_URL) return null;

  const cached = await redis.get(CACHE_KEY);
  if (cached !== null) return JSON.parse(cached) as SystemStatus | null;

  const status = await fetchSystemStatus(SYSTEM_STATUS_URL);
  await redis.set(
    CACHE_KEY,
    JSON.stringify(status),
    "EX",
    status ? CACHE_TTL_SECONDS : FAILURE_TTL_SECONDS
  );
  return status;
}
