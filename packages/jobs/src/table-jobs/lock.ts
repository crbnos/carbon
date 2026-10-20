// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redis } from "@carbon/kv";
import {
  MAX_RUNNING_TABLE_JOBS,
  TABLE_JOB_LOCK_TTL_SECONDS,
  TABLE_JOB_SLOTS_KEY,
  type TableJobKind,
  tableJobLockKey
} from "./handlers";

/**
 * The per-company lock of a table job, one key per company and job kind. The
 * value is the job's id, so a job only ever deletes or extends its own lock:
 * a lock that expired and was taken by the next job belongs to that job.
 *
 * Taking the lock also takes one of the `MAX_RUNNING_TABLE_JOBS` slots
 * shared by every company (`TABLE_JOB_SLOTS_KEY`); with none free it refuses.
 *
 * Each operation is one Lua script, so the read and the write are atomic.
 * `@carbon/kv` answers `null` for any command while Redis is down, which every
 * caller treats as "no lock": the route starts the job anyway (Inngest's
 * per-company concurrency still runs them one at a time).
 */

/** The part of an ioredis client the lock uses. */
export type LockClient = {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
};

// The company lock (SET NX EX) and a slot, or `{0, ttl}` while another job of
// the company holds the lock, or `{2, 0}` while every slot is taken. Slots of
// crashed jobs expire by their score.
const TAKE_SCRIPT = `local now = tonumber(redis.call("TIME")[1])
if redis.call("EXISTS", KEYS[1]) == 1 then
  return {0, redis.call("TTL", KEYS[1])}
end
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
if redis.call("ZCARD", KEYS[2]) >= tonumber(ARGV[3]) then
  return {2, 0}
end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("ZADD", KEYS[2], now + tonumber(ARGV[2]), ARGV[1])
return {1, 0}`;

// Compare-and-delete: only the holder deletes the key. The slot goes either way.
const RELEASE_SCRIPT = `redis.call("ZREM", KEYS[2], ARGV[1])
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

// Compare-and-expire: only the holder sets the TTL back, and its slot's.
const EXTEND_SCRIPT = `if redis.call("GET", KEYS[1]) == ARGV[1] then
  local now = tonumber(redis.call("TIME")[1])
  redis.call("ZADD", KEYS[2], "XX", now + tonumber(ARGV[2]), ARGV[1])
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return 0`;

/**
 * What taking the lock answered.
 *
 * - `acquired`: the lock is ours.
 * - `busy`: another job of the company holds it; it expires in
 *   `retryAfterSeconds` at the latest.
 * - `full`: `MAX_RUNNING_TABLE_JOBS` jobs are running across all companies.
 * - `unavailable`: Redis did not answer. The job starts anyway.
 */
export type TableJobLock =
  | { status: "acquired" }
  | { status: "busy"; retryAfterSeconds: number }
  | { status: "full" }
  | { status: "unavailable" };

/** Reads the take script's reply: `[1, 0]`, `[0, ttl]`, `[2, 0]`, or null. */
export function decideTableJobLock(reply: unknown): TableJobLock {
  if (!Array.isArray(reply) || reply.length < 2) {
    return { status: "unavailable" };
  }
  const [taken, ttl] = reply as [unknown, unknown];
  if (Number(taken) === 1) return { status: "acquired" };
  if (Number(taken) === 2) return { status: "full" };
  const seconds = Number(ttl);
  // TTL is -2 when the key vanished between the two calls and -1 without an
  // expiry; neither should promise a wait that is not real.
  return {
    status: "busy",
    retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  };
}

export async function takeTableJobLock(
  kind: TableJobKind,
  companyId: string,
  jobId: string,
  client: LockClient = redis
): Promise<TableJobLock> {
  const reply = await client.eval(
    TAKE_SCRIPT,
    2,
    tableJobLockKey(kind, companyId),
    TABLE_JOB_SLOTS_KEY,
    jobId,
    TABLE_JOB_LOCK_TTL_SECONDS,
    MAX_RUNNING_TABLE_JOBS
  );
  return decideTableJobLock(reply);
}

/** Deletes the lock while it still holds `jobId`, and frees the job's slot. */
export async function releaseTableJobLock(
  kind: TableJobKind,
  companyId: string,
  jobId: string,
  client: LockClient = redis
): Promise<void> {
  await client.eval(
    RELEASE_SCRIPT,
    2,
    tableJobLockKey(kind, companyId),
    TABLE_JOB_SLOTS_KEY,
    jobId
  );
}

/** Sets the lock's TTL back to `TABLE_JOB_LOCK_TTL_SECONDS` while it still holds `jobId`:
 *  a long run must not lose its lock to the next request. */
export async function extendTableJobLock(
  kind: TableJobKind,
  companyId: string,
  jobId: string,
  client: LockClient = redis
): Promise<void> {
  await client.eval(
    EXTEND_SCRIPT,
    2,
    tableJobLockKey(kind, companyId),
    TABLE_JOB_SLOTS_KEY,
    jobId,
    TABLE_JOB_LOCK_TTL_SECONDS
  );
}
