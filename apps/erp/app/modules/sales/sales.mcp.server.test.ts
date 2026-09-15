import { beforeEach, describe, expect, it, vi } from "vitest";

// Pin the item rule the checked upsert adds over the bare service upsert. The
// MCP tool, the HTTP API and the CSV importer all write quote lines through it.

const mocks = vi.hoisted(() => ({
  getQuoteLineItemIssue: vi.fn(),
  upsertQuoteLineRow: vi.fn(),
  existingLine: {
    data: { itemId: "item-0" } as { itemId: string } | null,
    error: null as { message: string } | null
  },
  lineFilters: [] as [string, unknown][]
}));

const serviceRole = {
  from: () => {
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        mocks.lineFilters.push([column, value]);
        return builder;
      },
      maybeSingle: async () => mocks.existingLine
    };
    return builder;
  }
};

vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: () => serviceRole
}));
vi.mock("./sales.server", () => ({
  getQuoteLineItemIssue: mocks.getQuoteLineItemIssue
}));
vi.mock("./sales.service", () => ({
  upsertQuoteLine: mocks.upsertQuoteLineRow
}));

const { upsertQuoteLine } = await import("./sales.mcp.server");

const callerClient = { __caller: true } as never;

const line = {
  quoteId: "quote-1",
  itemId: "item-1",
  status: "Not Started" as const,
  methodType: "Make to Order" as const,
  description: "Bracket",
  unitOfMeasureCode: "EA",
  quantity: [1],
  taxPercent: 0
};

const insert = { ...line, companyId: "company-1", createdBy: "user-1" };
const update = {
  ...line,
  id: "line-1",
  companyId: "company-1",
  updatedBy: "user-1"
};

describe("checked upsertQuoteLine", () => {
  beforeEach(() => {
    mocks.getQuoteLineItemIssue.mockReset();
    mocks.upsertQuoteLineRow.mockReset();
    mocks.existingLine = { data: { itemId: "item-0" }, error: null };
    mocks.lineFilters = [];
  });

  it("refuses an insert whose item cannot be quoted, without writing", async () => {
    mocks.getQuoteLineItemIssue.mockResolvedValue(
      "P000001 is inactive. It cannot be quoted."
    );

    const result = await upsertQuoteLine(callerClient, insert as never);

    expect(result).toEqual({
      data: null,
      error: { message: "P000001 is inactive. It cannot be quoted." }
    });
    expect(mocks.getQuoteLineItemIssue).toHaveBeenCalledWith(serviceRole, {
      companyId: "company-1",
      quoteId: "quote-1",
      itemId: "item-1",
      currentItemId: null
    });
    expect(mocks.upsertQuoteLineRow).not.toHaveBeenCalled();
  });

  it("writes an insert that passes through the caller's client", async () => {
    mocks.getQuoteLineItemIssue.mockResolvedValue(null);
    const written = { data: { id: "line-2" }, error: null };
    mocks.upsertQuoteLineRow.mockResolvedValue(written);

    const result = await upsertQuoteLine(callerClient, insert as never);

    expect(result).toBe(written);
    expect(mocks.upsertQuoteLineRow).toHaveBeenCalledWith(callerClient, insert);
  });

  it("checks an update against the item the line already carries", async () => {
    mocks.getQuoteLineItemIssue.mockResolvedValue(null);
    mocks.upsertQuoteLineRow.mockResolvedValue({
      data: { id: "line-1" },
      error: null
    });

    await upsertQuoteLine(callerClient, update as never);

    expect(mocks.lineFilters).toEqual([
      ["id", "line-1"],
      ["companyId", "company-1"]
    ]);
    expect(mocks.getQuoteLineItemIssue).toHaveBeenCalledWith(serviceRole, {
      companyId: "company-1",
      quoteId: "quote-1",
      itemId: "item-1",
      currentItemId: "item-0"
    });
    expect(mocks.upsertQuoteLineRow).toHaveBeenCalledWith(callerClient, update);
  });

  it("refuses an update to a line the company does not have", async () => {
    mocks.existingLine = { data: null, error: null };

    const result = await upsertQuoteLine(callerClient, update as never);

    expect(result.error?.message).toBe("Failed to find quote line");
    expect(mocks.getQuoteLineItemIssue).not.toHaveBeenCalled();
    expect(mocks.upsertQuoteLineRow).not.toHaveBeenCalled();
  });

  // A failed read cannot be taken as "the item is unchanged".
  it("refuses an update when the line read fails", async () => {
    mocks.existingLine = { data: null, error: { message: "boom" } };

    const result = await upsertQuoteLine(callerClient, update as never);

    expect(result.error?.message).toBe(
      "This quote line could not be read. Try again."
    );
    expect(mocks.upsertQuoteLineRow).not.toHaveBeenCalled();
  });

  it("refuses a payload with no company to check against", async () => {
    const { companyId: _companyId, ...noCompany } = update;

    const result = await upsertQuoteLine(callerClient, noCompany as never);

    expect(result.error?.message).toBe(
      "A company is required to save a quote line."
    );
    expect(mocks.upsertQuoteLineRow).not.toHaveBeenCalled();
  });
});
