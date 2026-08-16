import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  POSTHOG_API_HOST: "https://us.i.posthog.com",
  POSTHOG_PROJECT_PUBLIC_KEY: "phc_test",
  CONTROLLED_ENVIRONMENT: false
}));

vi.mock("@carbon/env", () => env);
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));

const { captureWorkEvent, trackWorkEvent } = await import("./capture");

function lastRequest() {
  const mock = vi.mocked(globalThis.fetch);
  const [url, init] = mock.mock.calls.at(-1)!;
  return {
    url: String(url),
    body: JSON.parse(String((init as RequestInit).body))
  };
}

describe("captureWorkEvent", () => {
  beforeEach(() => {
    env.POSTHOG_API_HOST = "https://us.i.posthog.com";
    env.POSTHOG_PROJECT_PUBLIC_KEY = "phc_test";
    env.CONTROLLED_ENVIRONMENT = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok", { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const released = {
    companyId: "co_1",
    userId: "user_1",
    jobId: "job_1",
    priorStatus: "Draft",
    source: "erp" as const
  };

  it("posts to the same path posthog-js ingests through", async () => {
    await captureWorkEvent("job_released", released);
    expect(lastRequest().url).toBe("https://us.i.posthog.com/e/");
  });

  it("preserves a base path, so a reverse-proxied host still resolves", async () => {
    // new URL("/e/", "https://proxy/ingest") would silently drop "/ingest" and
    // send every event to a 404 that capture can never report.
    env.POSTHOG_API_HOST = "https://proxy.example.com/ingest";
    await captureWorkEvent("job_released", released);
    expect(lastRequest().url).toBe("https://proxy.example.com/ingest/e/");
  });

  it("does not double the separator when the host has a trailing slash", async () => {
    env.POSTHOG_API_HOST = "https://us.i.posthog.com/";
    await captureWorkEvent("job_released", released);
    expect(lastRequest().url).toBe("https://us.i.posthog.com/e/");
  });

  it("sends the event name, the project key and the actor as distinct_id", async () => {
    await captureWorkEvent("job_released", released);
    const { body } = lastRequest();
    expect(body.event).toBe("job_released");
    expect(body.api_key).toBe("phc_test");
    expect(body.distinct_id).toBe("user_1");
  });

  it("attributes the event to the company group", async () => {
    await captureWorkEvent("job_released", released);
    expect(lastRequest().body.properties.$groups).toEqual({
      company: "co_1"
    });
  });

  it("tags the module so adoption can be grouped by area", async () => {
    await captureWorkEvent("job_released", released);
    const { properties } = lastRequest().body;
    expect(properties.module).toBe("production");
    expect(properties.work_event).toBe(true);
  });

  it("carries a stable uuid, so a retry of one occurrence collapses", async () => {
    const first = await captureWorkEvent("job_released", released);
    const second = await captureWorkEvent("job_released", released);
    expect(first).toEqual(second);
    expect(first.sent && first.eventId).toBeTruthy();
  });

  it("gives a different uuid to a different job", async () => {
    const first = await captureWorkEvent("job_released", released);
    const second = await captureWorkEvent("job_released", {
      ...released,
      jobId: "job_2"
    });
    expect(first).not.toEqual(second);
  });

  // Both of these are regressions. Keyed on the document alone, the second
  // event of a lifecycle carries the same uuid as the first and is discarded
  // downstream — so the order that reached an approver was counted and the one
  // that actually committed money was not.
  it("separates the two stages of one purchase order", async () => {
    const base = {
      companyId: "co_1",
      userId: "user_1",
      purchaseOrderId: "po_1"
    };
    const gated = await captureWorkEvent(
      "purchase_order_finalized",
      { ...base, stage: "gated" },
      { discriminator: "gated" }
    );
    const committed = await captureWorkEvent(
      "purchase_order_finalized",
      { ...base, stage: "committed" },
      { discriminator: "committed" }
    );
    expect(gated.sent && committed.sent).toBe(true);
    expect((gated as { eventId: string }).eventId).not.toEqual(
      (committed as { eventId: string }).eventId
    );
  });

  it("still collapses a repeat of the same stage", async () => {
    const payload = {
      companyId: "co_1",
      userId: "user_1",
      purchaseOrderId: "po_1",
      stage: "committed" as const
    };
    const first = await captureWorkEvent("purchase_order_finalized", payload, {
      discriminator: "committed"
    });
    const again = await captureWorkEvent("purchase_order_finalized", payload, {
      discriminator: "committed"
    });
    expect(first).toEqual(again);
  });

  it("separates a picking list that goes Partial and then Completed", async () => {
    const base = {
      companyId: "co_1",
      userId: "user_1",
      pickingListId: "pl_1",
      source: "mes" as const
    };
    const partial = await captureWorkEvent(
      "picking_list_completed",
      { ...base, finalStatus: "Partial" },
      { discriminator: "Partial" }
    );
    const completed = await captureWorkEvent(
      "picking_list_completed",
      { ...base, finalStatus: "Completed" },
      { discriminator: "Completed" }
    );
    expect((partial as { eventId: string }).eventId).not.toEqual(
      (completed as { eventId: string }).eventId
    );
  });

  it("separates two postings against the same operation", async () => {
    const base = {
      companyId: "co_1",
      userId: "user_1",
      jobOperationId: "op_1",
      quantity: 5,
      source: "mes" as const
    };
    const first = await captureWorkEvent("production_quantity_reported", {
      ...base,
      productionQuantityId: "pq_1"
    });
    const second = await captureWorkEvent("production_quantity_reported", {
      ...base,
      productionQuantityId: "pq_2"
    });
    expect(first).not.toEqual(second);
  });

  it("keeps companyId out of the payload spread but present as a property", async () => {
    await captureWorkEvent("job_released", released);
    const { properties } = lastRequest().body;
    expect(properties.companyId).toBe("co_1");
    // userId is carried by distinct_id, not duplicated into properties.
    expect(properties.userId).toBeUndefined();
  });

  describe("when there is no actor", () => {
    const portal = {
      companyId: "co_1",
      userId: null,
      quoteId: "quote_1",
      salesOrderId: "so_1",
      acceptedBy: "portal" as const
    };

    it("falls back to a company-scoped distinct_id", async () => {
      await captureWorkEvent("quote_accepted", portal);
      expect(lastRequest().body.distinct_id).toBe("company:co_1");
    });

    it("turns off person processing, per PostHog's guidance on catch-all ids", async () => {
      await captureWorkEvent("quote_accepted", portal);
      expect(lastRequest().body.properties.$process_person_profile).toBe(false);
    });
  });

  describe("gating", () => {
    it("sends nothing when no api host is configured", async () => {
      env.POSTHOG_API_HOST = "";
      const result = await captureWorkEvent("job_released", released);
      expect(result).toEqual({ sent: false, reason: "disabled" });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("sends nothing when no project key is configured", async () => {
      env.POSTHOG_PROJECT_PUBLIC_KEY = "";
      const result = await captureWorkEvent("job_released", released);
      expect(result).toEqual({ sent: false, reason: "disabled" });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("sends nothing from a controlled (ITAR) environment", async () => {
      env.CONTROLLED_ENVIRONMENT = true;
      const result = await captureWorkEvent("job_released", released);
      expect(result).toEqual({
        sent: false,
        reason: "controlled_environment"
      });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  describe("failure is never the caller's problem", () => {
    it("resolves rather than throwing when PostHog rejects the event", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("nope", { status: 400 }))
      );
      await expect(captureWorkEvent("job_released", released)).resolves.toEqual(
        { sent: false, reason: "failed" }
      );
    });

    it("resolves rather than throwing when the network fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        })
      );
      await expect(captureWorkEvent("job_released", released)).resolves.toEqual(
        { sent: false, reason: "failed" }
      );
    });

    it("does not leave an unhandled rejection when fired and forgotten", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("ECONNREFUSED");
        })
      );
      expect(() => trackWorkEvent("job_released", released)).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
    });
  });
});
