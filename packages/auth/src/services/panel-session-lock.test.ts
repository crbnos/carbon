import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acquirePanelRefreshLock,
  PANEL_REFRESH_LOCK_LEASE_MS,
  PANEL_REFRESH_LOCK_RENEW_MS,
  releasePanelRefreshLock,
  renewPanelRefreshLock,
  withPanelRefreshLock
} from "./panel-session.server";

// An in-memory Redis with the three things the lock uses: SET PX NX, and the
// two owner-checked scripts (told apart by the command they end in). Expiry
// follows Date.now, which the fake timers drive.
const fake = vi.hoisted(() => {
  const store = new Map<string, { value: string; expiresAt: number }>();
  const live = (key: string) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return null;
    }
    return entry;
  };
  return { store, live };
});

vi.mock("@carbon/kv", () => ({
  redis: {
    set: async (
      key: string,
      value: string,
      px: string,
      ms: number,
      nx: string
    ) => {
      if (px !== "PX" || nx !== "NX") throw new Error("unexpected SET form");
      if (fake.live(key)) return null;
      fake.store.set(key, { value, expiresAt: Date.now() + ms });
      return "OK";
    },
    eval: async (
      script: string,
      _keys: number,
      key: string,
      owner: string,
      ms?: string
    ) => {
      const entry = fake.live(key);
      if (!entry || entry.value !== owner) return 0;
      if (script.includes('"del"')) {
        fake.store.delete(key);
        return 1;
      }
      entry.expiresAt = Date.now() + Number(ms);
      return 1;
    }
  }
}));

const TOKEN = "cps_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("panel session refresh lock", () => {
  beforeEach(() => {
    fake.store.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets exactly one caller hold the lock", async () => {
    const first = await acquirePanelRefreshLock(TOKEN);
    expect(first).toBeTruthy();
    expect(await acquirePanelRefreshLock(TOKEN)).toBeNull();
  });

  it("frees itself when the lease runs out, so another caller can take it", async () => {
    expect(await acquirePanelRefreshLock(TOKEN)).toBeTruthy();
    vi.advanceTimersByTime(PANEL_REFRESH_LOCK_LEASE_MS + 1);
    expect(await acquirePanelRefreshLock(TOKEN)).toBeTruthy();
  });

  it("never lets a holder whose lease lapsed release a newer holder's lock", async () => {
    const stale = await acquirePanelRefreshLock(TOKEN);
    vi.advanceTimersByTime(PANEL_REFRESH_LOCK_LEASE_MS + 1);
    const current = await acquirePanelRefreshLock(TOKEN);
    expect(current).toBeTruthy();

    await releasePanelRefreshLock(TOKEN, stale as string);
    // Still held by `current`: a third caller cannot start a refresh.
    expect(await acquirePanelRefreshLock(TOKEN)).toBeNull();

    await releasePanelRefreshLock(TOKEN, current as string);
    expect(await acquirePanelRefreshLock(TOKEN)).toBeTruthy();
  });

  it("never lets a stale holder extend a newer holder's lease", async () => {
    const stale = await acquirePanelRefreshLock(TOKEN);
    vi.advanceTimersByTime(PANEL_REFRESH_LOCK_LEASE_MS + 1);
    const current = await acquirePanelRefreshLock(TOKEN);

    expect(await renewPanelRefreshLock(TOKEN, stale as string)).toBe(false);
    expect(await renewPanelRefreshLock(TOKEN, current as string)).toBe(true);
  });

  it("keeps the lease alive for as long as the work runs, then releases it", async () => {
    const owner = await acquirePanelRefreshLock(TOKEN);
    let heldDuringWork: string | null = "unset";

    await withPanelRefreshLock(TOKEN, owner as string, async () => {
      // A refresh slower than a whole lease: renewal must carry it.
      for (let elapsed = 0; elapsed < PANEL_REFRESH_LOCK_LEASE_MS * 3; ) {
        await vi.advanceTimersByTimeAsync(PANEL_REFRESH_LOCK_RENEW_MS);
        elapsed += PANEL_REFRESH_LOCK_RENEW_MS;
      }
      heldDuringWork = await acquirePanelRefreshLock(TOKEN);
    });

    expect(heldDuringWork).toBeNull();
    expect(await acquirePanelRefreshLock(TOKEN)).toBeTruthy();
  });

  it("releases the lock when the work throws", async () => {
    const owner = await acquirePanelRefreshLock(TOKEN);
    await expect(
      withPanelRefreshLock(TOKEN, owner as string, async () => {
        throw new Error("refresh failed");
      })
    ).rejects.toThrow("refresh failed");
    expect(await acquirePanelRefreshLock(TOKEN)).toBeTruthy();
  });
});
