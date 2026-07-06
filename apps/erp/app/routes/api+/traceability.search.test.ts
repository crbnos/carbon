import { requirePermissions } from "@carbon/auth/auth.server";
import { describe, expect, it, vi } from "vitest";
import { loader } from "./traceability.search";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));

describe("traceability search loader", () => {
  it("returns tracked entity readableId without querying job readable ids", async () => {
    const entityQuery = createQuery([
      {
        id: "tracked-entity-1",
        readableId: "TRK-0001",
        attributes: { Job: "job-uuid-1" }
      }
    ]);
    const activityQuery = createQuery([]);
    const from = vi.fn((table: string) => {
      if (table === "trackedEntity") return entityQuery;
      if (table === "trackedActivity") return activityQuery;
      throw new Error(`Unexpected table query: ${table}`);
    });

    vi.mocked(requirePermissions).mockResolvedValue({
      client: { from },
      companyId: "company-1"
    } as any);

    const response = await loader({
      request: new Request(
        "http://localhost/api/traceability.search?q=TRK&kind=entity"
      )
    } as any);
    const body = await response.json();

    expect(body.entities).toEqual([
      {
        id: "tracked-entity-1",
        readableId: "TRK-0001",
        attributes: { Job: "job-uuid-1" }
      }
    ]);
    expect(body.entities[0]).not.toHaveProperty("jobId");
    expect(body.entities[0]).not.toHaveProperty("jobReadableId");
    expect(from).not.toHaveBeenCalledWith("job");
    expect(entityQuery.or).toHaveBeenCalledWith(
      "id.ilike.%TRK%,sourceDocumentReadableId.ilike.%TRK%,readableId.ilike.%TRK%"
    );
  });
});

function createQuery(data: unknown[]) {
  const result = Promise.resolve({ data });
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    or: vi.fn(() => result),
    then: result.then.bind(result)
  };

  return query;
}
