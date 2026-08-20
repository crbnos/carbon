import { requirePermissions } from "@carbon/auth/auth.server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import {
  recalculateJobRequirements,
  triggerJobSchedule
} from "~/modules/production/production.service";
import { action } from "./operations.update";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("~/modules/production/production.service", () => ({
  recalculateJobRequirements: vi.fn(),
  triggerJobSchedule: vi.fn()
}));

type DatabaseError = { message: string } | null;
type QueryResult<T> = {
  data: T | null;
  error: DatabaseError;
};

type SourceOperation = {
  id: string;
  jobId: string;
  processId: string;
  status: string;
  companyId: string;
};

type ParentJob = {
  id: string;
  companyId: string;
  locationId: string;
  status: string;
};

type DestinationWorkCenter = {
  id: string;
  companyId: string;
  active: boolean;
  locationId: string | null;
};

type ProcessCompatibility = {
  workCenterId: string;
};

type UpdatedOperation = {
  id: string;
};

function createQueryChain<T>(
  label: string,
  result: QueryResult<T>,
  events: string[]
) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn((columns: string) => {
    events.push(`${label}:select:${columns}`);
    return chain;
  });
  chain.update = vi.fn((_payload: unknown) => {
    events.push(`${label}:update`);
    return chain;
  });
  chain.eq = vi.fn((column: string, value: unknown) => {
    events.push(`${label}:eq:${column}:${String(value)}`);
    return chain;
  });
  chain.not = vi.fn((column: string, operator: string, value: unknown) => {
    events.push(`${label}:not:${column}:${operator}:${String(value)}`);
    return chain;
  });
  chain.maybeSingle = vi.fn(async () => {
    events.push(`${label}:maybeSingle`);
    return result;
  });
  return chain;
}

function createActionMocks() {
  const events: string[] = [];
  const results = {
    source: {
      data: {
        id: "operation-1",
        jobId: "job-1",
        processId: "process-1",
        status: "Ready",
        companyId: "company-1"
      },
      error: null
    } as QueryResult<SourceOperation>,
    parent: {
      data: {
        id: "job-1",
        companyId: "company-1",
        locationId: "location-1",
        status: "Ready"
      },
      error: null
    } as QueryResult<ParentJob>,
    destination: {
      data: {
        id: "work-center-2",
        companyId: "company-1",
        active: true,
        locationId: "location-1"
      },
      error: null
    } as QueryResult<DestinationWorkCenter>,
    compatibility: {
      data: { workCenterId: "work-center-2" },
      error: null
    } as QueryResult<ProcessCompatibility>,
    mutation: {
      data: { id: "operation-1" },
      error: null
    } as QueryResult<UpdatedOperation>
  };

  const chains = {
    source: createQueryChain("source", results.source, events),
    parent: createQueryChain("parent", results.parent, events),
    destination: createQueryChain("destination", results.destination, events),
    compatibility: createQueryChain(
      "compatibility",
      results.compatibility,
      events
    ),
    mutation: createQueryChain("mutation", results.mutation, events)
  };
  const jobOperationChains = [chains.source, chains.mutation];
  const client = {
    from: vi.fn((table: string) => {
      events.push(`from:${table}`);
      if (table === "jobOperation") {
        const chain = jobOperationChains.shift();
        if (!chain) throw new Error("Unexpected jobOperation query");
        return chain;
      }
      if (table === "job") return chains.parent;
      if (table === "workCenter") return chains.destination;
      if (table === "workCenterProcess") return chains.compatibility;
      throw new Error(`Unexpected table: ${table}`);
    })
  };

  return { chains, client, events, results };
}

type ActionMocks = ReturnType<typeof createActionMocks>;
let mocks: ActionMocks;

function updateRequest(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("http://localhost/x/schedule/operations/update", {
    method: "POST",
    body
  });
}

async function runAction(fields: Record<string, string>) {
  return action({
    request: updateRequest(fields),
    params: {},
    context: {}
  } as any);
}

const baseFields = {
  id: "operation-1",
  columnId: "work-center-2",
  priority: "-3.5"
};

function expectNoMutation() {
  expect(mocks.chains.mutation.update).not.toHaveBeenCalled();
  expect(mocks.events).not.toContain("mutation:update");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks = createActionMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client: mocks.client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
});

afterEach(() => {
  expect(triggerJobSchedule).not.toHaveBeenCalled();
  expect(recalculateJobRequirements).not.toHaveBeenCalled();
});

describe("Operations schedule update action", () => {
  it("validates source, job, destination and process before exactly one update", async () => {
    const result = await runAction(baseFields);

    expect(mocks.events).toEqual([
      "from:jobOperation",
      "source:select:id, jobId, processId, status, companyId",
      "source:eq:id:operation-1",
      "source:eq:companyId:company-1",
      "source:maybeSingle",
      "from:job",
      "parent:select:id, companyId, locationId, status",
      "parent:eq:id:job-1",
      "parent:eq:companyId:company-1",
      "parent:maybeSingle",
      "from:workCenter",
      "destination:select:id, companyId, active, locationId",
      "destination:eq:id:work-center-2",
      "destination:eq:companyId:company-1",
      "destination:maybeSingle",
      "from:workCenterProcess",
      "compatibility:select:workCenterId",
      "compatibility:eq:workCenterId:work-center-2",
      "compatibility:eq:processId:process-1",
      "compatibility:eq:companyId:company-1",
      "compatibility:maybeSingle",
      "from:jobOperation",
      "mutation:update",
      "mutation:eq:id:operation-1",
      "mutation:eq:companyId:company-1",
      "mutation:eq:jobId:job-1",
      "mutation:eq:processId:process-1",
      "mutation:not:status:in:(Done,Canceled)",
      "mutation:select:id",
      "mutation:maybeSingle"
    ]);
    expect(mocks.chains.mutation.update).toHaveBeenCalledOnce();
    expect(mocks.chains.mutation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        workCenterId: "work-center-2",
        priority: -3.5,
        updatedBy: "user-1",
        updatedAt: expect.any(String)
      })
    );
    expect(triggerJobSchedule).not.toHaveBeenCalled();
    expect(recalculateJobRequirements).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it("accepts finite negative priorities", async () => {
    await runAction({ ...baseFields, priority: "-100" });
    expect(mocks.chains.mutation.update).toHaveBeenCalledWith(
      expect.objectContaining({ priority: -100 })
    );
  });

  it("accepts surrounding whitespace around a finite number", async () => {
    const result = await runAction({ ...baseFields, priority: " 4.25 " });

    expect(result).toEqual({ success: true });
    expect(mocks.chains.mutation.update).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 4.25 })
    );
  });

  it.each([
    " ",
    "\t",
    "\n"
  ])("rejects whitespace-only priority %j before any database call", async (priority) => {
    const result = await runAction({ ...baseFields, priority });

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("rejects missing priority before any database call", async () => {
    const { priority: _priority, ...fields } = baseFields;
    const result = await runAction(fields);

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it.each([
    "",
    "Infinity",
    "-Infinity",
    "NaN"
  ])("rejects invalid priority %j before any database call", async (priority) => {
    const result = await runAction({ ...baseFields, priority });

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expectNoMutation();
  });

  it("performs no update when the source operation is missing", async () => {
    mocks.results.source.data = null;

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Invalid scheduling request"
    });
    expectNoMutation();
  });

  it("performs no update when the parent job is missing", async () => {
    mocks.results.parent.data = null;

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Invalid scheduling request"
    });
    expectNoMutation();
  });

  it.each([
    "Completed",
    "Closed",
    "Cancelled"
  ])("performs no update for a %s parent job", async (status) => {
    if (mocks.results.parent.data) mocks.results.parent.data.status = status;

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Invalid scheduling request"
    });
    expectNoMutation();
  });

  it.each([
    "Done",
    "Canceled"
  ])("performs no update for a %s operation", async (status) => {
    if (mocks.results.source.data) mocks.results.source.data.status = status;

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Invalid scheduling request"
    });
    expectNoMutation();
  });

  it("performs no update for a foreign-company destination", async () => {
    if (mocks.results.destination.data) {
      mocks.results.destination.data.companyId = "company-2";
    }

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Invalid scheduling request"
    });
    expectNoMutation();
  });

  it("performs no update when the destination is missing", async () => {
    mocks.results.destination.data = null;

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Invalid scheduling request"
    });
    expectNoMutation();
  });

  it("performs no update for an inactive destination", async () => {
    if (mocks.results.destination.data) {
      mocks.results.destination.data.active = false;
    }

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Invalid scheduling request"
    });
    expectNoMutation();
  });

  it("performs no update for a destination at another location", async () => {
    if (mocks.results.destination.data) {
      mocks.results.destination.data.locationId = "location-2";
    }

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Invalid scheduling request"
    });
    expectNoMutation();
  });

  it("performs no update for a process-incompatible destination", async () => {
    mocks.results.compatibility.data = null;

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Invalid scheduling request"
    });
    expectNoMutation();
  });

  it("returns the update database error", async () => {
    mocks.results.mutation.data = null;
    mocks.results.mutation.error = { message: "database failure" };

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "database failure"
    });
    expect(mocks.chains.mutation.update).toHaveBeenCalledOnce();
  });

  it("does not treat a zero-row update as success", async () => {
    mocks.results.mutation.data = null;

    await expect(runAction(baseFields)).resolves.toEqual({
      success: false,
      message: "Operation unavailable"
    });
    expect(mocks.chains.mutation.update).toHaveBeenCalledOnce();
  });
});
