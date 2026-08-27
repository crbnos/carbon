import { describe, expect, it, vi } from "vitest";
import type {
  CatalogIntegration,
  WorkflowCatalog
} from "../definition/catalog";
import type { IntegrationNode } from "../definition/schema";
import { t } from "../definition/types";
import { createRuntimeContext } from "./fixtures";
import { integrationExecutor } from "./integration";

const STEP: CatalogIntegration = {
  id: "integration.google-calendar.create_google_calendar_event",
  inputs: {
    connectionId: { type: t.string, required: true },
    title: { type: t.string, required: true }
  },
  outputs: { result: t.string },
  batchable: false,
  permission: { module: "workflows", action: "update" },
  piece: { name: "google-calendar", action: "create_google_calendar_event" }
};

const node = (
  data: Partial<IntegrationNode["data"]> = {}
): IntegrationNode => ({
  id: "step",
  name: "integration_0",
  type: "integration",
  position: { x: 0, y: 0 },
  data: {
    piece: "google-calendar",
    action: "create_google_calendar_event",
    inputs: {
      connectionId: { kind: "literal", type: t.string, value: "icn_1" },
      title: { kind: "literal", type: t.string, value: "Kickoff" }
    },
    ...data
  }
});

/** A catalog that answers for the one step above and nothing else. */
function catalogWith(step: CatalogIntegration | undefined): WorkflowCatalog {
  const base = createRuntimeContext().catalog;
  return {
    ...base,
    getIntegration: (id) => (id === STEP.id ? step : undefined)
  };
}

describe("integrationExecutor", () => {
  it("runs the piece its catalog entry names and reports the result", async () => {
    const runIntegration = vi.fn(async () => ({
      ok: true as const,
      outputs: {
        result: {
          kind: "primitive" as const,
          of: "string" as const,
          value: "{}"
        }
      }
    }));
    const ctx = createRuntimeContext({ services: { runIntegration } });

    const outcome = await integrationExecutor.execute(node(), {
      ...ctx,
      catalog: catalogWith(STEP)
    });

    // The piece comes off the catalog entry, never off the node's id.
    expect(runIntegration).toHaveBeenCalledWith(STEP.piece, {
      connectionId: { kind: "primitive", of: "string", value: "icn_1" },
      title: { kind: "primitive", of: "string", value: "Kickoff" }
    });
    expect(outcome.status).toBe("Succeeded");
  });

  it("skips rather than fails when the step is no longer offered", async () => {
    const ctx = createRuntimeContext();
    const outcome = await integrationExecutor.execute(node(), {
      ...ctx,
      catalog: catalogWith(undefined)
    });

    expect(outcome).toEqual({
      status: "Skipped",
      reason: "This integration step is no longer available."
    });
  });

  it("gates on the permission its catalog entry carries", () => {
    expect(integrationExecutor.permission(node(), catalogWith(STEP))).toEqual({
      module: "workflows",
      action: "update"
    });
    expect(
      integrationExecutor.permission(node(), catalogWith(undefined))
    ).toBeUndefined();
  });
});
