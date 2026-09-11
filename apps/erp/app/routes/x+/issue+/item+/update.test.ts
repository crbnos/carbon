import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
// The locked compare-and-set lives in updateIssueItemQuantity and is covered
// by quality-disposition.server.test.ts; this file covers the route's parsing.
vi.mock("~/modules/quality/quality-disposition.server", () => ({
  updateIssueItemQuantity: vi.fn(async () => ({
    data: { id: "nci-1" },
    error: null
  }))
}));

import { updateIssueItemQuantity } from "~/modules/quality/quality-disposition.server";
import { action } from "./update";

// The item lookup the route runs before its field switch; `parentRow` null
// simulates a missing (or other-company) item.
let parentRow: { nonConformance: { status: string } } | null;
const update = vi.fn();
const client = {
  from: () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      update: (value: unknown) => {
        update(value);
        return chain;
      },
      single: async () =>
        parentRow
          ? { data: parentRow, error: null }
          : { data: null, error: { message: "No rows found" } },
      then: (onFulfilled: (value: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled)
    };
    return chain;
  }
};

function quantityRequest(fields: Record<string, string>) {
  const body = new FormData();
  body.set("id", "nci-1");
  body.set("field", "quantity");
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return new Request("http://localhost/x/issue/item/update", {
    method: "POST",
    body
  });
}

async function run(request: Request) {
  return (await action({ request, params: {}, context: {} } as any)) as {
    error: { message: string } | null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  parentRow = { nonConformance: { status: "In Progress" } };
  vi.mocked(requirePermissions).mockResolvedValue({
    client,
    companyId: "company-1",
    userId: "user-1"
  } as any);
});

describe("issue item update — quantity", () => {
  it("passes the parsed quantity and expected quantity to the locked update", async () => {
    const result = await run(
      quantityRequest({ value: "2.5", expectedQuantity: "0" })
    );

    expect(result.error).toBeNull();
    expect(updateIssueItemQuantity).toHaveBeenCalledWith({
      id: "nci-1",
      companyId: "company-1",
      userId: "user-1",
      quantity: 2.5,
      expectedQuantity: 0
    });
  });

  it.each(["-3", "", "abc"])("refuses the quantity %j", async (value) => {
    const result = await run(quantityRequest({ value, expectedQuantity: "0" }));

    expect(result.error?.message).toBe("Quantity must be zero or more");
    expect(updateIssueItemQuantity).not.toHaveBeenCalled();
  });

  it("refuses a missing expected quantity", async () => {
    const result = await run(quantityRequest({ value: "5" }));

    expect(result.error?.message).toBe("Invalid expected quantity");
    expect(updateIssueItemQuantity).not.toHaveBeenCalled();
  });

  it("refuses a missing item before the field switch", async () => {
    parentRow = null;
    const body = new FormData();
    body.set("id", "nci-missing");
    body.set("field", "disposition");
    body.set("value", "Scrap");
    const result = await run(
      new Request("http://localhost/x/issue/item/update", {
        method: "POST",
        body
      })
    );

    expect(result.error?.message).toBe("Issue item not found");
    expect(update).not.toHaveBeenCalled();
  });
});
