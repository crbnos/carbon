import { beforeEach, describe, expect, it, vi } from "vitest";

// Behaviour of the companion tools ({module}.mcp.server.ts) that the ERP
// screens already enforce: the production-event GL posting, and the refusals
// that must fire before a write. Stubs sit at the real boundaries only — the
// Supabase client (HTTP), `getUserClaims` (redis / get_claims) — and at the
// Kysely-backed inspection engine, which a refused call must never reach.

const claims = vi.hoisted(() => ({
  current: {
    permissions: {} as Record<string, Record<string, string[]>>,
    role: "employee" as string | null
  }
}));

// The production module graph evaluates Lingui `msg` macros at load, which
// vitest does not transform.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@carbon/auth/users.server", () => ({
  getUserClaims: async () => claims.current
}));
vi.mock("@carbon/ee/rules.server", () => ({
  evaluateLinesForSurface: vi.fn(),
  isBlocked: vi.fn()
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => {
    throw new Error("Kysely must not be reached in these tests");
  }
}));
const engine = vi.hoisted(() => ({
  dispositionInspection: vi.fn(),
  upsertInspectionSample: vi.fn(),
  upsertInspectionMeasurement: vi.fn()
}));
vi.mock("~/modules/quality/quality.server", () => engine);
vi.mock("~/modules/settings/settings.server", () => ({
  upsertCustomField: vi.fn(async () => ({ data: null, error: null })),
  deleteCustomField: vi.fn(),
  updateCustomFieldsSortOrder: vi.fn()
}));

import { upsertProductionEvent } from "~/modules/production/production.mcp.server";
import { postProductionEvent } from "~/modules/production/production.service";
import { dispositionInspection } from "~/modules/quality/quality.mcp.server";
import { upsertCustomField } from "~/modules/settings/settings.mcp.server";
import { DataType } from "~/modules/shared/types";
import { SERVICE_RULE_ERROR_CODE } from "~/utils/supabase";

type InvokeResult = { data: unknown; error: unknown };

/** A client whose productionEvent write returns `saved`, and whose edge
 *  function call returns `posting`. */
function eventClient(saved: { id: string }, posting: InvokeResult) {
  const invoke = vi.fn(async () => posting);
  const chain = {
    insert: () => chain,
    update: () => chain,
    eq: () => chain,
    select: () => chain,
    single: async () => ({ data: saved, error: null })
  };
  return {
    invoke,
    client: {
      from: () => chain,
      functions: { invoke }
    } as never
  };
}

const eventBase = {
  jobOperationId: "op1",
  type: "Labor" as const,
  startTime: "2026-09-01T08:00:00Z",
  companyId: "c1"
};

beforeEach(() => {
  vi.clearAllMocks();
  claims.current = {
    permissions: {
      quality: { view: ["c1"], create: ["c1"], update: ["c1"], delete: [] }
    },
    role: "employee"
  };
});

describe("postProductionEvent", () => {
  it("returns the edge function's refusal reason", async () => {
    const { client } = eventClient(
      { id: "pe1" },
      { data: { success: false, reason: "no labor rate" }, error: null }
    );
    expect(
      await postProductionEvent(client, {
        productionEventId: "pe1",
        companyId: "c1",
        userId: "u1"
      })
    ).toEqual({ data: null, error: { message: "no labor rate" } });
  });

  it("returns the transport error message", async () => {
    const { client } = eventClient(
      { id: "pe1" },
      { data: null, error: { message: "Insufficient permissions" } }
    );
    const result = await postProductionEvent(client, {
      productionEventId: "pe1",
      companyId: "c1",
      userId: "u1"
    });
    expect(result.error?.message).toBe("Insufficient permissions");
  });
});

describe("production_upsertProductionEvent", () => {
  it("posts a created event that has an endTime, as the event screen does", async () => {
    const { client, invoke } = eventClient(
      { id: "pe1" },
      { data: { success: true }, error: null }
    );
    const result = await upsertProductionEvent(client, {
      ...eventBase,
      endTime: "2026-09-01T10:00:00Z",
      createdBy: "u1"
    });
    expect(result).toEqual({ data: { id: "pe1" }, error: null });
    expect(invoke).toHaveBeenCalledWith("post-production-event", {
      body: { productionEventId: "pe1", userId: "u1", companyId: "c1" }
    });
  });

  it("does not post an open event (no endTime)", async () => {
    const { client, invoke } = eventClient(
      { id: "pe1" },
      { data: { success: true }, error: null }
    );
    await upsertProductionEvent(client, { ...eventBase, createdBy: "u1" });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the saved event and reports that no journal entry was posted", async () => {
    const { client } = eventClient(
      { id: "pe1" },
      { data: { success: false, reason: "period closed" }, error: null }
    );
    const result = await upsertProductionEvent(client, {
      ...eventBase,
      id: "pe1",
      endTime: "2026-09-01T10:00:00Z",
      updatedBy: "u1"
    });
    expect(result.data).toEqual({ id: "pe1" });
    expect(result.error).toEqual({
      code: SERVICE_RULE_ERROR_CODE,
      message:
        "Production event updated, but no journal entry was posted: period closed"
    });
  });
});

describe("quality_dispositionInspection", () => {
  it("refuses Reject: its write-off and NCR orchestration is route-only", async () => {
    const result = await dispositionInspection("c1", "u1", {
      id: "insp1",
      decision: "Reject" as never
    });
    expect(result.error?.code).toBe(SERVICE_RULE_ERROR_CODE);
    expect(engine.dispositionInspection).not.toHaveBeenCalled();
  });

  it("re-applies the route's quality update gate before the engine runs", async () => {
    claims.current = {
      permissions: {
        quality: { view: ["c1"], create: [], update: [], delete: [] }
      },
      role: "employee"
    };
    await expect(
      dispositionInspection("c1", "u1", { id: "insp1", decision: "Accept" })
    ).rejects.toThrow("(quality update)");
    expect(engine.dispositionInspection).not.toHaveBeenCalled();
  });

  it("passes the receipt-only source restriction the accept route passes", async () => {
    engine.dispositionInspection.mockResolvedValue({
      data: { id: "insp1", status: "Passed", writeOff: null },
      error: null
    });
    await dispositionInspection("c1", "u1", { id: "insp1", decision: "Accept" });
    expect(engine.dispositionInspection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "insp1",
        decision: "Accept",
        companyId: "c1",
        dispositionedBy: "u1",
        requireSource: "Receipt"
      })
    );
  });
});

describe("settings_upsertCustomField", () => {
  it("refuses a List field without options, as the settings form does", async () => {
    const result = await upsertCustomField({} as never, {
      name: "Finish",
      table: "part",
      dataTypeId: DataType.List,
      listOptions: [],
      required: false,
      companyId: "c1",
      createdBy: "u1"
    });
    expect(result.error).toEqual({
      code: SERVICE_RULE_ERROR_CODE,
      message: "A List custom field needs at least one option."
    });
  });
});
