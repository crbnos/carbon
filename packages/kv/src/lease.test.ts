import type Redis from "ioredis";
import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLease, releaseLease, renewLease, withLease } from "./lease";
import { withResilience } from "./resilient";

// The lease runs its real scripts against ioredis-mock, wrapped in the same
// fail-soft proxy the app uses. `down` swaps in a client whose every command
// rejects, as an unreachable Redis does.
const current = vi.hoisted(() => ({ client: null as unknown as Redis }));

vi.mock("./client", () => ({
  get default() {
    return current.client;
  }
}));

function unreachable(): Redis {
  const reject = () => Promise.reject(new Error("ECONNREFUSED"));
  return { on: () => undefined, eval: reject } as unknown as Redis;
}

// Real clock: a renewal every sixth of the lease leaves room for a loaded CI
// runner, and expiry waits sit well past the lease.
const KEY = "lease:test";
const LEASE_MS = 300;
const RENEW_MS = 50;
const PAST_LEASE_MS = LEASE_MS + 100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function acquiredOwner() {
  const result = await acquireLease(KEY, LEASE_MS);
  if (result.status !== "acquired") throw new Error("expected to acquire");
  return result.owner;
}

describe("lease", () => {
  beforeEach(async () => {
    const mock = new RedisMock();
    await mock.flushall();
    current.client = withResilience(mock as unknown as Redis);
  });

  it("lets exactly one caller hold it", async () => {
    await acquiredOwner();
    expect(await acquireLease(KEY, LEASE_MS)).toEqual({ status: "held" });
  });

  it("reports an unreachable Redis as unavailable, not as held", async () => {
    current.client = withResilience(unreachable());
    expect(await acquireLease(KEY, LEASE_MS)).toEqual({
      status: "unavailable"
    });
  });

  it("frees itself when the lease runs out", async () => {
    await acquiredOwner();
    await sleep(PAST_LEASE_MS);
    expect((await acquireLease(KEY, LEASE_MS)).status).toBe("acquired");
  });

  it("never lets a holder whose lease lapsed release or extend a newer holder's lease", async () => {
    const stale = await acquiredOwner();
    await sleep(PAST_LEASE_MS);
    const newer = await acquiredOwner();

    await releaseLease(KEY, stale);
    expect(await renewLease(KEY, stale, LEASE_MS)).toBe(false);
    expect((await acquireLease(KEY, LEASE_MS)).status).toBe("held");

    await releaseLease(KEY, newer);
    expect((await acquireLease(KEY, LEASE_MS)).status).toBe("acquired");
  });

  it("stays held while the work outlasts several leases, then releases", async () => {
    const owner = await acquiredOwner();
    let duringWork = "unset";

    await withLease(
      KEY,
      owner,
      { leaseMs: LEASE_MS, renewMs: RENEW_MS },
      async () => {
        await sleep(LEASE_MS * 3);
        duringWork = (await acquireLease(KEY, LEASE_MS)).status;
      }
    );

    expect(duringWork).toBe("held");
    expect((await acquireLease(KEY, LEASE_MS)).status).toBe("acquired");
  });

  it("releases when the work throws", async () => {
    const owner = await acquiredOwner();
    await expect(
      withLease(
        KEY,
        owner,
        { leaseMs: LEASE_MS, renewMs: RENEW_MS },
        async () => {
          throw new Error("work failed");
        }
      )
    ).rejects.toThrow("work failed");
    expect((await acquireLease(KEY, LEASE_MS)).status).toBe("acquired");
  });
});
