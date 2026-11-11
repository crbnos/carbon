// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { beforeEach, expect, it, vi } from "vitest";
import { loader } from "./search";

vi.mock("@carbon/auth/auth.server", () => ({ authorize: vi.fn() }));
vi.mock("@carbon/auth/client.server", () => ({
  getCarbonServiceRole: vi.fn()
}));

const rpc = vi.fn();

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({
    data: [{ id: 1, entityType: "quote" }],
    error: null
  });
  vi.mocked(getCarbonServiceRole).mockReturnValue({ rpc } as never);
});

const viewOf = (...pages: string[]) =>
  Object.fromEntries(
    pages.map((page) => [
      page,
      { view: ["company-1"], create: [], update: [], delete: [] }
    ])
  );

/** The entity types the route asks the index for, given the caller's claims. */
async function searchedTypes(
  permissions: Record<string, unknown>,
  type?: string
): Promise<string[] | undefined> {
  vi.mocked(authorize).mockResolvedValue({
    companyId: "company-1",
    permissions
  } as unknown as Awaited<ReturnType<typeof authorize>>);
  const params = new URLSearchParams({ q: "Q-0001" });
  if (type) params.set("type", type);
  await loader({
    request: new Request(`http://localhost/api/search?${params}`)
  } as never);
  return rpc.mock.calls[0]?.[1]?.p_entity_types;
}

it("gives a Sales Quotes viewer quote results", async () => {
  const types = await searchedTypes(viewOf("sales.quotes"));
  expect(types).toContain("quote");
  expect(types).toEqual(
    expect.arrayContaining(["customer", "salesOrder", "salesRfq"])
  );
  expect(types).not.toContain("purchaseOrder");
  expect(types).not.toContain("item");
});

it("gives no Sales results to a person with no Sales page", async () => {
  const types = await searchedTypes(viewOf("purchasing.purchaseOrders"));
  expect(types).toContain("purchaseOrder");
  expect(types).not.toContain("quote");
  expect(types).not.toContain("customer");
});

it("does not search at all without a page that owns a searched table", async () => {
  expect(await searchedTypes({})).toBeUndefined();
});

it("searches items on View of any item page", async () => {
  expect(await searchedTypes(viewOf("parts.tools"))).toContain("item");
});

it("narrows to the type filter only when that type is allowed", async () => {
  expect(await searchedTypes(viewOf("sales.quotes"), "quote")).toEqual([
    "quote"
  ]);
  rpc.mockClear();
  expect(
    await searchedTypes(viewOf("sales.quotes"), "purchaseOrder")
  ).toBeUndefined();
});
