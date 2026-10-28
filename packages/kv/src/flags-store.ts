// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { FlagsStore } from "@carbon/env/flags.server";
import redis from "./client";
import { acquireLease, releaseLease } from "./lease";

// One hash per flags source (`scope` hashes the endpoint, the headers and the
// flagd-core version): the
// document every ERP and MES process of the instance shares. The provider
// caps the document at 1 MB.
const key = (scope: string) => `flags:${scope}`;

// Every 200 and 304 refreshes it, so only a scope nothing reads any more (an
// old token, a changed endpoint, a deleted worktree) runs out.
const DOCUMENT_TTL_SECONDS = 24 * 60 * 60;

// Long enough for one fetch from the source (5 s timeout) and the write.
const REFRESH_LEASE_MS = 10_000;

/**
 * The Redis `FlagsStore` for `initFlags` (`@carbon/env/flags.server`). Reads
 * answer null on a miss and when Redis is down (the client fails soft);
 * `tryLease` answers "unavailable" when Redis is down, and the provider then
 * fetches the source itself.
 */
export const redisFlagsStore: FlagsStore = {
  async readMeta(scope) {
    const [etag, fetchedAt] = (await redis.hmget(
      key(scope),
      "etag",
      "fetchedAt"
    )) ?? [null, null];
    if (!etag || !fetchedAt) return null;
    return { etag, fetchedAt: Number(fetchedAt) };
  },

  async readBody(scope) {
    return redis.hget(key(scope), "body");
  },

  async write(scope, value) {
    const fields: Record<string, string> = {
      fetchedAt: String(value.fetchedAt)
    };
    if (value.body !== undefined) fields.body = value.body;
    if (value.etag !== undefined) fields.etag = value.etag;
    await redis.hset(key(scope), fields);
    await redis.expire(key(scope), DOCUMENT_TTL_SECONDS);
  },

  async tryLease(scope) {
    const leaseKey = `${key(scope)}:refresh`;
    const lease = await acquireLease(leaseKey, REFRESH_LEASE_MS);
    if (lease.status !== "acquired") return lease;
    return {
      status: "acquired",
      release: () => releaseLease(leaseKey, lease.owner)
    };
  }
};
