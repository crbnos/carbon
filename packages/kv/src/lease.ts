// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { randomBytes } from "node:crypto";
import redis from "./client";

/**
 * Owner-bound Redis lease: a dead holder stops renewing and the key lapses;
 * renew and release check the owner first. Acquire answers 1 or 0, so `null`
 * from the fail-soft client means Redis is unavailable, never held.
 */
export type LeaseAcquisition =
  | { status: "acquired"; owner: string }
  | { status: "held" }
  | { status: "unavailable" };

const ACQUIRE = `if redis.call("set", KEYS[1], ARGV[1], "PX", ARGV[2], "NX") then return 1 else return 0 end`;
const RENEW_IF_OWNER = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end`;
const RELEASE_IF_OWNER = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

export async function acquireLease(
  key: string,
  leaseMs: number
): Promise<LeaseAcquisition> {
  const owner = randomBytes(16).toString("base64url");
  const result = await redis.eval(ACQUIRE, 1, key, owner, String(leaseMs));
  if (result === 1) return { status: "acquired", owner };
  if (result === 0) return { status: "held" };
  return { status: "unavailable" };
}

/** False when the lease is no longer this owner's. */
export async function renewLease(
  key: string,
  owner: string,
  leaseMs: number
): Promise<boolean> {
  const result = await redis.eval(
    RENEW_IF_OWNER,
    1,
    key,
    owner,
    String(leaseMs)
  );
  return result === 1;
}

export async function releaseLease(key: string, owner: string): Promise<void> {
  await redis.eval(RELEASE_IF_OWNER, 1, key, owner);
}

/** Renewal failures are ignored: the owner check makes a lapsed lease safe. */
export async function withLease<T>(
  key: string,
  owner: string,
  { leaseMs, renewMs }: { leaseMs: number; renewMs: number },
  work: () => Promise<T>
): Promise<T> {
  const renewal = setInterval(() => {
    renewLease(key, owner, leaseMs).catch(() => undefined);
  }, renewMs);
  try {
    return await work();
  } finally {
    clearInterval(renewal);
    await releaseLease(key, owner).catch(() => undefined);
  }
}
