import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLineageSubgraph } from "~/modules/inventory/lineage.server";
import { requireCompanyRecord } from "~/modules/shared/shared.server";
import { loader } from "./traceability.expand";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));
vi.mock("~/modules/inventory/lineage.server", () => ({
  fetchLineageSubgraph: vi.fn(async () => ({ entities: [], activities: [] }))
}));
vi.mock("~/modules/shared/shared.server", () => ({
  requireCompanyRecord: vi.fn(async () => undefined)
}));

const client = { from: vi.fn(), rpc: vi.fn() };

function load(query: string) {
  return loader({
    request: new Request(`http://localhost/api/traceability/expand?${query}`)
  } as any);
}

describe("traceability expand loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermissions).mockResolvedValue({
      client,
      companyId: "company-1"
    } as any);
  });

  it("proves the entity is the caller's company's before traversing", async () => {
    const response = await load("trackedEntityId=entity-1&depth=2");

    expect(response.status).toBe(200);
    expect(requireCompanyRecord).toHaveBeenCalledWith(
      client,
      "trackedEntity",
      "company-1",
      { id: "entity-1" }
    );
    expect(fetchLineageSubgraph).toHaveBeenCalledWith(
      client,
      "entity-1",
      "company-1",
      2,
      "both"
    );
  });

  it("stops before any traversal when the entity is another company's", async () => {
    vi.mocked(requireCompanyRecord).mockRejectedValueOnce(
      new Response("Not found", { status: 404 })
    );

    await expect(load("trackedEntityId=foreign-entity")).rejects.toMatchObject({
      status: 404
    });
    expect(fetchLineageSubgraph).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("returns 400 without a trackedEntityId", async () => {
    const response = await load("depth=1");

    expect(response.status).toBe(400);
    expect(requireCompanyRecord).not.toHaveBeenCalled();
    expect(fetchLineageSubgraph).not.toHaveBeenCalled();
  });
});
