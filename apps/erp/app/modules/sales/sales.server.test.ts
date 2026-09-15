import { beforeEach, describe, expect, it, vi } from "vitest";

const getItemOrderabilityIssue = vi.fn();

vi.mock("~/modules/items/items.server", () => ({
  getItemOrderabilityIssue: (...args: unknown[]) =>
    getItemOrderabilityIssue(...args)
}));
vi.mock("~/services/database.server", () => ({
  getDatabaseClient: () => ({})
}));

const { getQuoteLineItemIssue } = await import("./sales.server");

// Answers the "already on this quote" read and records its filters.
function fakeClient(
  result: { data: { id: string } | null; error: { message: string } | null } = {
    data: null,
    error: null
  }
) {
  const filters: [string, unknown][] = [];
  const from = vi.fn(() => {
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      limit: () => builder,
      maybeSingle: async () => result
    };
    return builder;
  });
  return { client: { from } as never, from, filters };
}

const args = { companyId: "company-1", quoteId: "quote-1", itemId: "item-1" };

describe("getQuoteLineItemIssue", () => {
  beforeEach(() => {
    getItemOrderabilityIssue.mockReset();
  });

  it("refuses an item that cannot be ordered, saying it cannot be quoted", async () => {
    getItemOrderabilityIssue.mockResolvedValue("P000001 is inactive.");
    const { client } = fakeClient();

    expect(await getQuoteLineItemIssue(client, args)).toBe(
      "P000001 is inactive. It cannot be quoted."
    );
    expect(getItemOrderabilityIssue).toHaveBeenCalledWith(client, {
      itemId: "item-1",
      companyId: "company-1"
    });
  });

  it("passes an item that can be ordered", async () => {
    getItemOrderabilityIssue.mockResolvedValue(null);
    const { client } = fakeClient();

    expect(await getQuoteLineItemIssue(client, args)).toBeNull();
  });

  // An item deactivated after it was quoted must not strand the line.
  it("exempts the item the edited line already points at, without reading anything", async () => {
    const { client, from } = fakeClient();

    expect(
      await getQuoteLineItemIssue(client, { ...args, currentItemId: "item-1" })
    ).toBeNull();
    expect(from).not.toHaveBeenCalled();
    expect(getItemOrderabilityIssue).not.toHaveBeenCalled();
  });

  it("still checks an edited line that is being pointed at a different item", async () => {
    getItemOrderabilityIssue.mockResolvedValue("P000002 is inactive.");
    const { client } = fakeClient();

    expect(
      await getQuoteLineItemIssue(client, { ...args, currentItemId: "item-0" })
    ).toBe("P000002 is inactive. It cannot be quoted.");
  });

  // A quote converted from a sales RFQ carries placeholder parts that stay
  // inactive until the quote is ordered.
  it("exempts an item another line of the same quote already uses", async () => {
    const { client, filters } = fakeClient({
      data: { id: "line-9" },
      error: null
    });

    expect(await getQuoteLineItemIssue(client, args)).toBeNull();
    expect(filters).toEqual([
      ["quoteId", "quote-1"],
      ["itemId", "item-1"],
      ["companyId", "company-1"]
    ]);
    expect(getItemOrderabilityIssue).not.toHaveBeenCalled();
  });

  // A failed read proves nothing about the quote, so it grants no exemption.
  it("does not exempt the item when the quote read fails", async () => {
    getItemOrderabilityIssue.mockResolvedValue("P000001 is inactive.");
    const { client } = fakeClient({
      data: null,
      error: { message: "boom" }
    });

    expect(await getQuoteLineItemIssue(client, args)).toBe(
      "P000001 is inactive. It cannot be quoted."
    );
  });
});
