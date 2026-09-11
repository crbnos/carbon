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

const client = {
  from: () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      single: async () => ({
        data: { nonConformance: { status: "In Progress" } },
        error: null
      })
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
});
