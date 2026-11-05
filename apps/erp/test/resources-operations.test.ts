// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  // Postings are database work with their own database tests; here they
  // answer `invoke`, and what they are sent is the contract.
  const stubbed = new Set(["issue", "post-maintenance-event"]);
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
          )) as typeof actual.invokePosting
  };
});
vi.mock("@carbon/jobs", () => ({ trigger }));
// The location timezone cache.
vi.mock("@carbon/kv", () => ({ redis: { del: vi.fn() } }));

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
  updateLocation,
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
 * test names for it (rows, or `{ data, error }`); a query that writes nothing
 * answers from `<table>:read` when the test names one. Each write is recorded
 * with its payload; nothing else is checked.
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
    let wrote = false;
    for (const method of [
      "select",
      "eq",
      "neq",
      "in",
      "match",
      "limit",
      "order"
    ]) {
      chain[method] = () => chain;
    }
    for (const op of ["insert", "update", "upsert", "delete"]) {
      chain[op] = (payload?: unknown) => {
        wrote = true;
        writes.push({ op, table, payload });
        return chain;
      };
    }
    const result = () =>
      answer(!wrote && `${table}:read` in answers ? `${table}:read` : table);
    chain.single = chain.maybeSingle = () => Promise.resolve(result());
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve);
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
      data: { id: "ev-1", warning: expect.any(String) },
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
      // no process holds the name yet; the insert returns the new one
      "process:read": null,
      process: { id: "proc-1" },
      ability: { data: null, error: { message: "boom" } }
    });

    const result = await createProcess(ctx, {
      name: "Welding",
      processType: "Outside Processing",
      requiresAbility: true
    });

    expect(result.error?.category).toBe("internal");
    expect(writes.map((w) => [w.op, w.table, w.payload])).toContainEqual([
      "update",
      "process",
      { requiresAbility: false }
    ]);
  });
});

describe("process names", () => {
  // A taken name is the user's to fix, on the form, not a failed save.
  it("refuses a name another process holds, before writing", async () => {
    const { ctx, writes } = contextWith({ process: { id: "proc-0" } });

    const result = await createProcess(ctx, {
      name: "Welding",
      processType: "Process",
      requiresAbility: false
    });

    expect(result.error?.category).toBe("conflict");
    expect(writes).toEqual([]);
  });

  // Another request saved the same name between the check and the insert.
  it("refuses a name the database rejects as a duplicate", async () => {
    const { ctx } = contextWith({
      "process:read": null,
      process: { data: null, error: { code: "23505", message: "duplicate" } }
    });

    const result = await createProcess(ctx, {
      name: "Welding",
      processType: "Process",
      requiresAbility: false
    });

    expect(result.error?.category).toBe("conflict");
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

    expect(result.error?.category).toBe("rule");
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

    expect(result.error?.category).toBe("validation");
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
});

describe("a training's guide or video", () => {
  it.each([
    ["guidePath", "company-1/training/tr-1/upload/guide.pdf"] as const,
    ["videoUrl", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"] as const
  ])("changes %s only while the training is Draft", async (field, value) => {
    // The update is scoped to Draft trainings: none matched.
    const { ctx } = contextWith({ training: [] });
    const result = await updateTrainingField(ctx, { ids: ["tr-1"], field, value });
    expect(result.error?.category).toBe("rule");
  });
});

describe("a location's timezone", () => {
  const location = {
    id: "loc-1",
    name: "Plant",
    addressLine1: "1 Main St",
    city: "Chicago",
    postalCode: "60601",
    countryCode: "US",
    timezone: "America/New_York"
  };

  // Shifts are local times, so the whole plan moves with the timezone.
  it("re-plans the location when the timezone changes", async () => {
    const { ctx } = contextWith({ location: { timezone: "America/Chicago" } });

    const result = await updateLocation(ctx, location);

    expect(result).toEqual({ data: { id: "loc-1" }, error: null });
    expect(scheduleNotices()).toEqual([
      [
        "schedule-inputs-changed",
        expect.objectContaining({ kind: "location", entityId: "loc-1" })
      ]
    ]);
  });

  it("tells no scheduler when only other fields change", async () => {
    const { ctx } = contextWith({ location: { timezone: "America/New_York" } });

    await updateLocation(ctx, location);

    expect(scheduleNotices()).toEqual([]);
  });
});
