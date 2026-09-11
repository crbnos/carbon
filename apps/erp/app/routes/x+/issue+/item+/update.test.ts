import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "./update";

// @carbon/glossary's terms.ts evaluates Lingui `msg` macros at module load,
// which vitest doesn't transform; the route graph pulls it in transitively.
vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));
vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn(async () => ({}))
}));
vi.mock("~/modules/quality", () => ({
  isIssueLocked: (status: string | null) => status === "Closed"
}));
vi.mock("~/modules/quality/quality.models", () => ({
  disposition: ["Pending", "Scrap", "Use As Is"]
}));

type Row = { id: string; quantity: number };

// A minimal stateful stand-in for the Supabase query builder: the update
// applies only when every eq() filter matches the stored row, like Postgres.
function fakeClient(opts: {
  row: Row;
  status?: string;
  linkCount?: number;
  inspectionCount?: number;
}) {
  const from = vi.fn((table: string) => {
    const filters: Record<string, unknown> = {};
    let patch: Partial<Row> | null = null;

    const resolve = () => {
      if (table === "nonConformanceItemTrackedEntity") {
        return { count: opts.linkCount ?? 0, error: null };
      }
      if (table === "nonConformanceInspection") {
        return { count: opts.inspectionCount ?? 0, error: null };
      }
      if (patch) {
        const matches = Object.entries(filters).every(
          ([column, value]) =>
            column === "companyId" ||
            String(opts.row[column as keyof Row]) === String(value)
        );
        if (!matches) return { data: [], error: null };
        Object.assign(opts.row, { quantity: patch.quantity });
        return { data: [{ id: opts.row.id }], error: null };
      }
      return { data: null, error: null };
    };

    const builder: any = {
      select: vi.fn(() => builder),
      update: vi.fn((value: Partial<Row>) => {
        patch = value;
        return builder;
      }),
      eq: vi.fn((column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      }),
      single: vi.fn(async () => ({
        data: {
          nonConformanceId: "nc-1",
          nonConformance: { status: opts.status ?? "In Progress" }
        },
        error: null
      })),
      then: (onFulfilled: (value: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled)
    };
    return builder;
  });
  return { from };
}

function quantityRequest(value: string, expectedQuantity: string) {
  const body = new FormData();
  body.set("id", "nci-1");
  body.set("field", "quantity");
  body.set("value", value);
  body.set("expectedQuantity", expectedQuantity);
  return new Request("http://localhost/x/issue/item/update", {
    method: "POST",
    body
  });
}

async function run(client: ReturnType<typeof fakeClient>, request: Request) {
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
  return (await action({ request, params: {}, context: {} } as any)) as {
    error: { message: string } | null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("issue item update — quantity", () => {
  it("saves when the stored quantity matches the expected quantity", async () => {
    const row = { id: "nci-1", quantity: 0 };
    const result = await run(fakeClient({ row }), quantityRequest("5", "0"));

    expect(result.error).toBeNull();
    expect(row.quantity).toBe(5);
  });

  it("refuses an older save that completes after a newer one", async () => {
    const row = { id: "nci-1", quantity: 0 };
    const client = fakeClient({ row });

    // Both saves were sent while the row held 0; the newer one lands first.
    const newer = await run(client, quantityRequest("7", "0"));
    const older = await run(client, quantityRequest("5", "0"));

    expect(newer.error).toBeNull();
    expect(older.error?.message).toMatch(/changed since the page loaded/);
    expect(row.quantity).toBe(7);
  });

  it("refuses a row with linked tracked entities", async () => {
    const row = { id: "nci-1", quantity: 1 };
    const result = await run(
      fakeClient({ row, linkCount: 1 }),
      quantityRequest("4", "1")
    );

    expect(result.error?.message).toMatch(/linked tracked entities/);
    expect(row.quantity).toBe(1);
  });

  it("refuses an inspection-originated issue", async () => {
    const row = { id: "nci-1", quantity: 5 };
    const result = await run(
      fakeClient({ row, inspectionCount: 1 }),
      quantityRequest("7", "5")
    );

    expect(result.error?.message).toMatch(/inspection lot/);
    expect(row.quantity).toBe(5);
  });

  it("refuses a missing expected quantity", async () => {
    const row = { id: "nci-1", quantity: 0 };
    const body = new FormData();
    body.set("id", "nci-1");
    body.set("field", "quantity");
    body.set("value", "5");
    const request = new Request("http://localhost/x/issue/item/update", {
      method: "POST",
      body
    });
    const result = await run(fakeClient({ row }), request);

    expect(result.error?.message).toBe("Invalid expected quantity");
    expect(row.quantity).toBe(0);
  });
});
