import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

import { triggerJobSchedule } from "~/modules/production/production.service";
import { action } from "./dates.update";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("@carbon/logger", () => ({
  getLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })
}));
vi.mock("~/modules/production/production.service", () => ({
  triggerJobSchedule: vi.fn()
}));

type QueryResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

function createActionMocks() {
  const events: string[] = [];
  const result: QueryResult = {
    data: { id: "job-1" },
    error: null
  };
  const query = {
    update: vi.fn((_payload: unknown) => {
      events.push("update");
      return query;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      events.push(`eq:${column}:${String(value)}`);
      return query;
    }),
    not: vi.fn((column: string, operator: string, value: unknown) => {
      events.push(`not:${column}:${operator}:${String(value)}`);
      return query;
    }),
    select: vi.fn((columns: string) => {
      events.push(`select:${columns}`);
      return query;
    }),
    maybeSingle: vi.fn(async () => {
      events.push("maybeSingle");
      return result;
    })
  };
  const client = {
    from: vi.fn((table: string) => {
      events.push(`from:${table}`);
      return query;
    })
  };

  return { client, events, query, result };
}

type ActionMocks = ReturnType<typeof createActionMocks>;
let mocks: ActionMocks;

function updateRequest(fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("http://localhost/x/schedule/dates/update", {
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
  id: "job-1",
  locationId: "location-1",
  columnId: "2026-08-09",
  priority: "-2.5"
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks = createActionMocks();
  vi.mocked(requirePermissions).mockResolvedValue({
    client: mocks.client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
  vi.mocked(triggerJobSchedule).mockImplementation(async () => {
    mocks.events.push("scheduler");
    return { success: true };
  });
});

describe("Dates schedule update action", () => {
  it("completes the scoped update before scheduling", async () => {
    const result = await runAction(baseFields);

    expect(mocks.client.from).toHaveBeenCalledWith("job");
    expect(mocks.query.update).toHaveBeenCalledWith(
      expect.objectContaining({
        dueDate: "2026-08-09",
        priority: -2.5,
        updatedBy: "user-1"
      })
    );
    expect(mocks.events).toEqual([
      "from:job",
      "update",
      "eq:id:job-1",
      "eq:companyId:company-1",
      "eq:locationId:location-1",
      "not:status:in:(Completed,Closed,Cancelled)",
      "select:id",
      "maybeSingle",
      "scheduler"
    ]);
    expect(result).toEqual({ success: true });
  });

  it.each([
    "unscheduled",
    "next-week",
    "next-month"
  ])("persists %s as a null due date", async (columnId) => {
    await runAction({ ...baseFields, columnId });
    expect(mocks.query.update).toHaveBeenCalledWith(
      expect.objectContaining({ dueDate: null })
    );
    expect(mocks.events.at(-1)).toBe("scheduler");
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "]
  ])("rejects a %s location before writing or scheduling", async (_name, locationId) => {
    const fields = { ...baseFields } as Record<string, string>;
    if (locationId === undefined) {
      delete fields.locationId;
    } else {
      fields.locationId = locationId;
    }

    const result = await runAction(fields);

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
    expect(triggerJobSchedule).not.toHaveBeenCalled();
  });

  it("rejects an invalid date column without writing or scheduling", async () => {
    const result = await runAction({ ...baseFields, columnId: "2026-02-29" });

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
    expect(triggerJobSchedule).not.toHaveBeenCalled();
  });

  it("accepts finite negative priorities", async () => {
    const result = await runAction({ ...baseFields, priority: "-100" });

    expect(result).toEqual({ success: true });
    expect(mocks.query.update).toHaveBeenCalledWith(
      expect.objectContaining({ priority: -100 })
    );
  });

  it("accepts surrounding whitespace around a finite number", async () => {
    const result = await runAction({ ...baseFields, priority: " 4.25 " });

    expect(result).toEqual({ success: true });
    expect(mocks.query.update).toHaveBeenCalledWith(
      expect.objectContaining({ priority: 4.25 })
    );
  });

  it.each([
    " ",
    "\t",
    "\n"
  ])("rejects whitespace-only priority %j before any database update", async (priority) => {
    const result = await runAction({ ...baseFields, priority });

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
    expect(triggerJobSchedule).not.toHaveBeenCalled();
  });

  it("rejects missing priority before any database update", async () => {
    const { priority: _priority, ...fields } = baseFields;
    const result = await runAction(fields);

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
  });

  it("rejects an empty priority before any database update", async () => {
    const result = await runAction({ ...baseFields, priority: "" });

    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
  });

  it.each([
    "Infinity",
    "-Infinity",
    "NaN"
  ])("rejects non-finite priority %s", async (priority) => {
    const result = await runAction({ ...baseFields, priority });
    expect(result).toEqual({ success: false, message: "Invalid form data" });
    expect(mocks.client.from).not.toHaveBeenCalled();
    expect(mocks.query.update).not.toHaveBeenCalled();
    expect(triggerJobSchedule).not.toHaveBeenCalled();
  });

  it("treats a location mismatch as a failed zero-row update", async () => {
    mocks.result.data = null;
    const result = await runAction({
      ...baseFields,
      locationId: "location-2"
    });

    expect(result).toEqual({
      success: false,
      message: "Job unavailable or locked"
    });
    expect(mocks.events).toEqual([
      "from:job",
      "update",
      "eq:id:job-1",
      "eq:companyId:company-1",
      "eq:locationId:location-2",
      "not:status:in:(Completed,Closed,Cancelled)",
      "select:id",
      "maybeSingle"
    ]);
    expect(triggerJobSchedule).not.toHaveBeenCalled();
  });

  it("does not schedule after a database error", async () => {
    mocks.result.data = null;
    mocks.result.error = { message: "database failure" };

    const result = await runAction(baseFields);

    expect(result).toEqual({ success: false, message: "database failure" });
    expect(mocks.events).toContain("maybeSingle");
    expect(mocks.events).not.toContain("scheduler");
    expect(triggerJobSchedule).not.toHaveBeenCalled();
  });

  it("keeps scheduler failures best-effort after one successful update", async () => {
    vi.mocked(triggerJobSchedule).mockRejectedValueOnce(
      new Error("Inngest down")
    );

    await expect(runAction(baseFields)).resolves.toEqual({ success: true });
    expect(mocks.events).not.toContain("scheduler");
    expect(triggerJobSchedule).toHaveBeenCalledOnce();
  });
});
