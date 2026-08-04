import type { Database } from "@carbon/database";
import { createWorkflowCatalog, entityValue } from "@carbon/workflows";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkflowServices } from "./services";

vi.mock("./create", () => ({
  runCreateAction: vi.fn(async () => ({ ok: true, outputs: {} }))
}));
vi.mock("./notify", () => ({
  runNotifyAction: vi.fn(async () => ({ ok: true, outputs: {} }))
}));
vi.mock("./update", () => ({
  runUpdateAction: vi.fn(async () => ({ ok: true, outputs: {} }))
}));
vi.mock("./webhook", () => ({
  runWebhookAction: vi.fn(async () => ({ ok: true, outputs: {} }))
}));
vi.mock("./operations", () => ({
  runOperation: vi.fn(async () => ({ ok: true, value: null }))
}));
vi.mock("./search", () => ({
  runSearch: vi.fn(async () => ({ ok: true, value: null }))
}));
vi.mock("./dispatcher", () => ({ getWorkflowDispatch: vi.fn() }));

const { runCreateAction } = await import("./create");
const { runNotifyAction } = await import("./notify");
const { runUpdateAction } = await import("./update");
const { runWebhookAction } = await import("./webhook");
const { runOperation } = await import("./operations");
const { runSearch } = await import("./search");
const { getWorkflowDispatch } = await import("./dispatcher");

const client = {} as SupabaseClient<Database>;
const dispatch = vi.fn();

function services() {
  return createWorkflowServices({
    client,
    catalog: createWorkflowCatalog(),
    companyId: "co1",
    companyGroupId: "cg1",
    ownerId: "u1",
    runId: "run1",
    workflowId: "wf1"
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWorkflowDispatch).mockReturnValue(dispatch);
});

describe("runAction routing", () => {
  it("sends notify to the notify action", async () => {
    await services().runAction("notify", {});
    expect(runNotifyAction).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: "co1",
        runId: "run1"
      })
    );
    expect(runUpdateAction).not.toHaveBeenCalled();
  });

  it("sends webhook to the webhook action", async () => {
    await services().runAction("webhook", {});
    expect(runWebhookAction).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "co1", workflowId: "wf1" })
    );
  });

  it("sends an update id to the update action, with its entity", async () => {
    const inputs = { job: entityValue("job", "j1") };
    await services().runAction("job.update", inputs);
    expect(runUpdateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: "job",
        companyId: "co1",
        ownerId: "u1",
        inputs
      })
    );
    expect(runCreateAction).not.toHaveBeenCalled();
  });

  it("sends a create id to the create action, with the tool it calls", async () => {
    await services().runAction("job.create", {});
    expect(runCreateAction).toHaveBeenCalledWith(
      expect.objectContaining({
        call: "production_insertJob",
        entity: "job",
        dispatch,
        context: {
          client,
          companyId: "co1",
          companyGroupId: "cg1",
          userId: "u1"
        }
      })
    );
  });

  it("refuses a create when no dispatcher was installed", async () => {
    vi.mocked(getWorkflowDispatch).mockReturnValue(undefined);
    expect(await services().runAction("job.create", {})).toEqual({
      ok: false,
      error: "This step is not available in this environment."
    });
    expect(runCreateAction).not.toHaveBeenCalled();
  });

  // The regression this file exists for: routing off the id's shape would send
  // this to the update executor, where it would write to a table nobody declared.
  it("refuses an unknown id that merely looks like an update", async () => {
    expect(await services().runAction("madeUp.update", {})).toEqual({
      ok: false,
      error: "This step is no longer available."
    });
    expect(runUpdateAction).not.toHaveBeenCalled();
    expect(runCreateAction).not.toHaveBeenCalled();
  });

  it("refuses an id the catalog has never heard of", async () => {
    expect(await services().runAction("nonsense", {})).toEqual({
      ok: false,
      error: "This step is no longer available."
    });
  });
});

describe("the other two services", () => {
  it("passes an operation through with the company", async () => {
    const inputs = { job: entityValue("job", "j1") };
    await services().runOperation("job.operationCount", inputs);
    expect(runOperation).toHaveBeenCalledWith({
      client,
      companyId: "co1",
      operationId: "job.operationCount",
      inputs
    });
  });

  it("passes a search through with the company", async () => {
    await services().search({ entity: "job", returns: "one", criteria: [] });
    expect(runSearch).toHaveBeenCalledWith({
      client,
      companyId: "co1",
      entity: "job",
      returns: "one",
      criteria: []
    });
  });
});
