import { AccountingAuthError } from "@carbon/ee/accounting";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
const redisMock = {
  incr: vi.fn(async (key: string) => {
    const next = Number(store.get(key) ?? 0) + 1;
    store.set(key, String(next));
    return next;
  }),
  expire: vi.fn(async () => 1),
  set: vi.fn(async (key: string, value: string) => {
    if (store.has(key)) return null;
    store.set(key, value);
    return "OK";
  }),
  del: vi.fn(async (...keys: string[]) => {
    for (const key of keys) store.delete(key);
    return keys.length;
  })
};
const triggerMock = vi.fn(async () => undefined);
const updateMock = vi.fn();

vi.mock("@carbon/kv", () => ({ redis: redisMock }));
vi.mock("@carbon/lib/trigger", () => ({ trigger: triggerMock }));
vi.mock("../../client", () => ({ inngest: {} }));

const {
  AUTH_FAILURE_DISABLE_THRESHOLD,
  recordIntegrationAuthFailure,
  runIsolatedCompanyStep
} = await import("./accounting-auth-failure");

const client = {
  from: () => ({
    update: (values: unknown) => {
      updateMock(values);
      return { eq: () => ({ eq: async () => ({ error: null }) }) };
    }
  })
} as never;

const target = {
  companyId: "co_1",
  providerId: "xero",
  updatedBy: "user_1"
};

// Runs the body immediately; a thrown error surfaces to the caller like an
// exhausted step does.
const step = {
  run: async (_id: string, fn: () => Promise<unknown>) => fn()
} as unknown as Parameters<typeof runIsolatedCompanyStep>[0]["step"];

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("recordIntegrationAuthFailure", () => {
  it("notifies once per day below the threshold", async () => {
    expect(
      await recordIntegrationAuthFailure(client, {
        ...target,
        recipientId: "user_1"
      })
    ).toBe("notified");
    expect(
      await recordIntegrationAuthFailure(client, {
        ...target,
        recipientId: "user_1"
      })
    ).toBe("muted");
    expect(triggerMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("deactivates the integration at the threshold and clears its caches", async () => {
    let outcome: string | undefined;
    for (let i = 0; i < AUTH_FAILURE_DISABLE_THRESHOLD; i++) {
      outcome = await recordIntegrationAuthFailure(client, {
        ...target,
        recipientId: "user_1"
      });
    }
    expect(outcome).toBe("deactivated");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ active: false })
    );
    expect(redisMock.del).toHaveBeenCalledWith(
      "integrations:co_1",
      "json:integrations:co_1",
      "integrations:co_1:xero:auth-failures"
    );
    // one "reconnect" notice on the first failure + one "disabled" notice
    expect(triggerMock).toHaveBeenCalledTimes(2);
  });
});

describe("runIsolatedCompanyStep", () => {
  it("returns authFailed without rethrowing on a dead grant", async () => {
    const result = await runIsolatedCompanyStep({
      step,
      client,
      id: "sweep",
      target,
      fn: async () => {
        throw new AccountingAuthError(
          "identity.xero.com",
          400,
          "invalid_grant"
        );
      }
    });
    expect(result).toMatchObject({
      authFailed: expect.stringContaining("invalid_grant")
    });
    expect(store.get("integrations:co_1:xero:auth-failures")).toBe("1");
  });

  it("returns error for any other exhausted failure so the loop continues", async () => {
    const result = await runIsolatedCompanyStep({
      step,
      client,
      id: "sweep",
      target,
      fn: async () => {
        throw new Error("boom");
      }
    });
    expect(result).toEqual({ error: "boom" });
  });

  it("resets the failure counter on success", async () => {
    store.set("integrations:co_1:xero:auth-failures", "5");
    const result = await runIsolatedCompanyStep({
      step,
      client,
      id: "sweep",
      target,
      fn: async () => ({ ok: true })
    });
    expect(result).toEqual({ ok: true });
    expect(store.has("integrations:co_1:xero:auth-failures")).toBe(false);
  });
});
