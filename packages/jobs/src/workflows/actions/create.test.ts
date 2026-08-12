import { entityValue, primitiveValue } from "@carbon/workflows";
import { describe, expect, it, vi } from "vitest";
import { runCreateAction } from "./create";
import type { DispatchContext, DispatchResult } from "./dispatcher";

const context = {
  client: {},
  companyId: "cmp_1",
  companyGroupId: "grp_1",
  userId: "usr_owner"
} as unknown as DispatchContext;

const inputs = {
  itemId: entityValue("item", "item_1"),
  quantity: primitiveValue("number", 5),
  dueDate: primitiveValue("date", "2026-08-01T00:00:00.000Z")
};

function dispatcher(result: DispatchResult) {
  return vi.fn(async () => result);
}

async function create(result: DispatchResult) {
  const dispatch = dispatcher(result);
  const outcome = await runCreateAction({
    dispatch,
    context,
    call: "production_upsertJob",
    entity: "job",
    inputs
  });
  return { outcome, dispatch };
}

describe("runCreateAction", () => {
  it("hands the plain values to the dispatcher and returns the new record", async () => {
    const { outcome, dispatch } = await create({
      success: true,
      data: { data: { id: "job_1", jobId: "JOB000001" }, error: null }
    });

    expect(dispatch).toHaveBeenCalledWith("production_upsertJob", context, {
      itemId: "item_1",
      quantity: 5,
      dueDate: "2026-08-01T00:00:00.000Z"
    });
    expect(outcome).toEqual({
      ok: true,
      outputs: { record: { kind: "entity", of: "job", id: "job_1" } },
      summary: "Created job_1."
    });
  });

  it("surfaces a dispatcher that refused", async () => {
    const { outcome } = await create({
      success: false,
      error: "Tool disabled: production_upsertJob is not available via MCP."
    });

    expect(outcome).toEqual({
      ok: false,
      error: "Tool disabled: production_upsertJob is not available via MCP."
    });
  });

  it("surfaces an error carried inside the returned envelope", async () => {
    const { outcome } = await create({
      success: true,
      data: { data: null, error: { message: "duplicate key value" } }
    });

    expect(outcome).toEqual({ ok: false, error: "duplicate key value" });
  });

  it("refuses a success with no id rather than a dangling output", async () => {
    const { outcome } = await create({
      success: true,
      data: { data: null, error: null }
    });

    expect(outcome).toEqual({
      ok: false,
      error: "The record was created but could not be read back."
    });
  });
});
