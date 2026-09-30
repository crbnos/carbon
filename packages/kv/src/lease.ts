import { randomBytes } from "node:crypto";
import redis from "./client";

/**
 * An owner-bound Redis lease: one holder at a time, renewed while the holder
 * works, released only by its owner.
 *
 * The lease is short and renewed, so a holder that dies stops renewing and the
 * key lapses within one lease instead of blocking everyone for a long TTL.
 * Renewal and release compare the stored owner first, so a holder whose lease
 * lapsed can never extend or delete the lease a later caller took.
 *
 * The client is fail-soft (a down Redis resolves `null`), so acquisition runs
 * as a script that answers 1 or 0: `null` then only ever means Redis is
 * unavailable, never "someone else holds it". Callers decide what to do
 * without a lock.
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

/** Extend the lease. False when it is no longer this owner's. */
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

/**
 * Run `work` while holding the lease, renewing it every `renewMs` and releasing
 * it afterwards. Renewal failures are ignored: the worst case is the lease
 * lapsing, which the owner check makes safe.
 */
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
