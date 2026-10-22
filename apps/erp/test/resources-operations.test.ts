// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

// The service's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() })
}));

const { invoke, trigger } = vi.hoisted(() => ({
  // The server functions (`issue`, `post-maintenance-event`).
  invoke: vi.fn(),
  // Inngest: scheduler notices, notifications, maintenance generation.
  trigger: vi.fn()
}));
vi.mock("../app/modules/shared/shared.service", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../app/modules/shared/shared.service")
    >();
  // The postings the server functions package ran are the boundary; every
  // other posting runs its (mocked) body as before.
  const stubbed = new Set([
    "issue",
    "create",
    "batch-operations",
    "post-inventory-adjustment",
    "post-maintenance-event",
    "post-picking",
    "post-production-event",
    "recalculate",
    "reschedule",
    "trigger-rework"
  ]);
  return {
    ...actual,
    invokePosting: ((from: never, name: string, input: never, ...rest: never[]) =>
      stubbed.has(name)
        ? invoke(name, input)
        : (actual.invokePosting as (...args: unknown[]) => unknown)(
            from,
            name,
            input,
            ...rest
          )) as typeof actual.invokePosting,
    invokeCreate: (_from: unknown, input: unknown) => invoke("create", input)
  };
});
vi.mock("@carbon/jobs", () => ({ trigger }));

import { createServiceContext } from "@carbon/api/service-fn.server";

// Load the service first: shared.service imports it, and a module first loaded
// while shared.service's mock is being built binds the unmocked one.
await import("../app/modules/resources/resources.service");
const {
  createMaintenanceEvent,
  createProcess,
  createTrainingAssignment,
  completeTrainingAssignment,
  issueMaintenancePart,
  updateMaintenanceDispatchField,
  updateTrainingField
} = await import("../app/modules/resources/resources.server");

const permissions = Object.fromEntries(
  ["resources", "people"].map((module) => [
    module,
    {
      view: ["company-1"],
      create: ["company-1"],
      update: ["company-1"],
      delete: ["company-1"]
    }
  ])
);

type Answer = { data: unknown; error: unknown };

/**
 * A Supabase client whose every query on a table answers with the result the
 * test names for it (rows, or `{ data, error }`). Each write is recorded with
 * its payload; nothing else is checked.
 */
function client(answers: Record<string, unknown>) {
  const writes: { op: string; table: string; payload?: unknown }[] = [];
  const answer = (key: string): Answer => {
    const value = answers[key];
    return value && typeof value === "object" && "error" in value
      ? (value as Answer)
      : { data: value ?? null, error: null };
  };
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "match", "limit", "order"]) {
      chain[method] = () => chain;
    }
    for (const op of ["insert", "update", "upsert", "delete"]) {
      chain[op] = (payload?: unknown) => {
        writes.push({ op, table, payload });
        return chain;
      };
    }
    chain.single = chain.maybeSingle = () => Promise.resolve(answer(table));
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(answer(table)).then(resolve);
    return chain;
  };
  const rpc = (name: string) => Promise.resolve(answer(`rpc:${name}`));
  return { from, rpc, writes };
}

function contextWith(answers: Record<string, unknown> = {}) {
  const db = client(answers);
  const ctx = createServiceContext({
    actor: { type: "user", userId: "user-1", permissions },
    company: { id: "company-1", groupId: "group-1" },
    caller: db as never,
    system: () => db as never,
    pg: () => ({}) as never,
    kv: () => ({}) as never
  });
  return { ctx, writes: db.writes };
}

const scheduleNotices = () =>
  trigger.mock.calls.filter(([event]) => event === "schedule-inputs-changed");

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ data: null, error: null });
});

describe("maintenance timecards", () => {
  const timecard = {
    maintenanceDispatchId: "md-1",
    employeeId: "user-2",
    workCenterId: "wc-1",
    startTime: "2026-10-01T08:00:00.000Z"
  };

  it("refuses a Completed dispatch, and writes and posts nothing", async () => {
    const { ctx, writes } = contextWith({
      maintenanceDispatch: { id: "md-1", status: "Completed" }
    });

    const result = await createMaintenanceEvent(ctx, timecard);

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("adds the timecard when its labor does not post, and says so", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "no period" } });
    const { ctx, writes } = contextWith({
      maintenanceDispatch: { id: "md-1", status: "In Progress" },
      maintenanceDispatchEvent: { id: "ev-1" },
      employee: { id: "user-2" },
      workCenter: { id: "wc-1" }
    });

    const result = await createMaintenanceEvent(ctx, timecard);

    expect(result).toEqual({
      data: {
        id: "ev-1",
        warning: "Timecard added, but its labor cost did not post"
      },
      error: null
    });
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual([
      "insert:maintenanceDispatchEvent"
    ]);
  });
});

describe("issuing a spare part to a dispatch", () => {
  const open = {
    maintenanceDispatch: { id: "md-1", status: "Open" },
    item: { id: "item-1" }
  };
  const part = { dispatchId: "md-1", itemId: "item-1", unitOfMeasureCode: "EA" };

  it("refuses nothing to issue", async () => {
    const { ctx } = contextWith(open);

    const none = await issueMaintenancePart(ctx, { ...part, quantity: 0 });
    const emptyBatch = await issueMaintenancePart(ctx, {
      ...part,
      children: [{ trackedEntityId: "te-1", quantity: 0 }]
    });

    expect(none.error?.category).toBe("validation");
    expect(emptyBatch.error?.category).toBe("validation");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("issues tracked entities as themselves, and anything else by quantity", async () => {
    const { ctx } = contextWith(open);
    const children = [
      { trackedEntityId: "te-1", quantity: 2 },
      { trackedEntityId: "te-2", quantity: 1 }
    ];

    await issueMaintenancePart(ctx, { ...part, children });
    await issueMaintenancePart(ctx, { ...part, quantity: 3 });

    expect(invoke.mock.calls.map(([, payload]) => payload)).toEqual([
      {
        type: "maintenanceDispatchTrackedEntities",
        maintenanceDispatchId: "md-1",
        itemId: "item-1",
        unitOfMeasureCode: "EA",
        children
      },
      {
        type: "maintenanceDispatchInventory",
        maintenanceDispatchId: "md-1",
        itemId: "item-1",
        unitOfMeasureCode: "EA",
        quantity: 3
      }
    ]);
  });
});

describe("setting a field on maintenance dispatches", () => {
  it("refuses when any of the dispatches is locked", async () => {
    const { ctx, writes } = contextWith({
      maintenanceDispatch: [
        { id: "md-1", status: "Open" },
        { id: "md-2", status: "Cancelled" }
      ]
    });

    const result = await updateMaintenanceDispatchField(ctx, {
      ids: ["md-1", "md-2"],
      field: "priority",
      value: "High"
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
  });

  it("completing stamps the end, frees offline work centers and posts the labor", async () => {
    const { ctx, writes } = contextWith({
      maintenanceDispatch: [
        {
          id: "md-1",
          status: "In Progress",
          takesWorkCenterOffline: true,
          workCenterId: "wc-1"
        },
        {
          id: "md-2",
          status: "In Progress",
          takesWorkCenterOffline: false,
          workCenterId: "wc-2"
        }
      ]
    });

    const result = await updateMaintenanceDispatchField(ctx, {
      ids: ["md-1", "md-2"],
      field: "status",
      value: "Completed"
    });

    expect(result.data).toEqual({ ids: ["md-1", "md-2"], warning: null });
    expect(writes[0]?.payload).toMatchObject({
      status: "Completed",
      actualEndTime: expect.any(String)
    });
    expect(scheduleNotices().map(([, notice]) => notice.entityId)).toEqual([
      "wc-1"
    ]);
    expect(invoke).toHaveBeenCalledWith("post-maintenance-event", {
      maintenanceDispatchIds: ["md-1", "md-2"]
    });
  });
});

describe("creating a process that requires an ability", () => {
  it("turns the requirement off again when the ability cannot be created", async () => {
    const { ctx, writes } = contextWith({
      process: { id: "proc-1" },
      ability: { data: null, error: { message: "boom" } }
    });

    const result = await createProcess(ctx, {
      name: "Welding",
      processType: "Outside Processing",
      requiresAbility: true
    });

    expect(result.error?.message).toBe("Failed to create process ability.");
    expect(writes.map((w) => [w.op, w.table, w.payload])).toContainEqual([
      "update",
      "process",
      { requiresAbility: false }
    ]);
  });
});

describe("training assignments", () => {
  it("refuses a second assignment of the same training", async () => {
    const { ctx, writes } = contextWith({
      training: { id: "tr-1" },
      trainingAssignment: [{ id: "ta-1" }]
    });

    const result = await createTrainingAssignment(ctx, {
      isExternal: false,
      trainingId: "tr-1",
      groupIds: ["group-a"]
    });

    expect(result.error?.category).toBe("rule");
    expect(writes).toEqual([]);
    expect(trigger).not.toHaveBeenCalled();
  });

  it("completes only for an employee the assignment targets", async () => {
    const { ctx, writes } = contextWith({
      trainingAssignment: {
        id: "ta-1",
        companyId: "company-1",
        groupIds: ["group-a"],
        trainingId: "tr-1",
        training: { status: "Active", frequency: "Once" }
      },
      "rpc:users_for_groups": ["user-3"]
    });

    const result = await completeTrainingAssignment(ctx, {
      trainingAssignmentId: "ta-1",
      employeeId: "user-2"
    });

    expect(result.error?.message).toBe(
      "This employee is not assigned this training"
    );
    expect(writes).toEqual([]);
  });
});

describe("a training's guide", () => {
  it("refuses a key outside the training's folder", async () => {
    const { ctx, writes } = contextWith();

    const result = await updateTrainingField(ctx, {
      ids: ["tr-1"],
      field: "guidePath",
      value: "company-2/training/tr-1/upload/guide.pdf"
    });

    expect(result.error?.category).toBe("validation");
    expect(writes).toEqual([]);
  });

  it("changes only while the training is Draft", async () => {
    const { ctx } = contextWith({ training: [] });

    const result = await updateTrainingField(ctx, {
      ids: ["tr-1"],
      field: "guidePath",
      value: "company-1/training/tr-1/upload/guide.pdf"
    });

    expect(result.error?.message).toBe(
      "The guide can only change while the training is Draft"
    );
  });

  it("clears the training's video", async () => {
    const { ctx, writes } = contextWith({ training: [{ id: "tr-1" }] });

    await updateTrainingField(ctx, {
      ids: ["tr-1"],
      field: "guidePath",
      value: "company-1/training/tr-1/upload/guide.pdf"
    });

    expect(writes[0]?.payload).toMatchObject({
      guidePath: "company-1/training/tr-1/upload/guide.pdf",
      videoUrl: null
    });
  });
});

describe("a training's video", () => {
  it("refuses a link that is not a YouTube video", async () => {
    const { ctx, writes } = contextWith();

    const result = await updateTrainingField(ctx, {
      ids: ["tr-1"],
      field: "videoUrl",
      value: "https://vimeo.com/123456789"
    });

    expect(result.error?.message).toBe("Enter a YouTube video link");
    expect(writes).toEqual([]);
  });

  it("stores the watch link and clears the PDF", async () => {
    const { ctx, writes } = contextWith({ training: [{ id: "tr-1" }] });

    const result = await updateTrainingField(ctx, {
      ids: ["tr-1"],
      field: "videoUrl",
      value: "https://youtu.be/dQw4w9WgXcQ?si=share"
    });

    expect(result.error).toBeNull();
    expect(writes[0]?.payload).toMatchObject({
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      guidePath: null
    });
  });

  it("changes only while the training is Draft", async () => {
    const { ctx } = contextWith({ training: [] });

    const result = await updateTrainingField(ctx, {
      ids: ["tr-1"],
      field: "videoUrl",
      value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    });

    expect(result.error?.message).toBe(
      "The video can only change while the training is Draft"
    );
  });
});
