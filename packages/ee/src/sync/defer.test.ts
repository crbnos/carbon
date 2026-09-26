import { describe, expect, it, vi } from "vitest";
import {
  AWAITING_MAPPING_CODE,
  isAwaitingMapping,
  requireMappingOrDefer
} from "./defer";

function mappingService(remoteId: string | null) {
  return { getExternalId: vi.fn().mockResolvedValue(remoteId) };
}

describe("requireMappingOrDefer", () => {
  it("returns the remote id when the dependency is already mapped", async () => {
    const service = mappingService("ramp-po-1");

    const result = await requireMappingOrDefer({
      mappingService: service,
      dependency: {
        integrationId: "ramp",
        entityType: "purchaseOrder",
        carbonId: "po_1"
      },
      waitingFor: "item receipt RE000001"
    });

    expect(result).toEqual({ kind: "resolved", remoteId: "ramp-po-1" });
    expect(service.getExternalId).toHaveBeenCalledWith(
      "purchaseOrder",
      "po_1",
      "ramp"
    );
  });

  it("defers with an actionable reason when it is not", async () => {
    const result = await requireMappingOrDefer({
      mappingService: mappingService(null),
      dependency: {
        integrationId: "rillet",
        entityType: "vendor",
        carbonId: "sup_1"
      },
      waitingFor: "bill AP000001"
    });

    expect(result.kind).toBe("deferred");
    if (result.kind !== "deferred") return;

    // The reason has to name all three: what is waiting, what it waits on, and
    // WHICH system must produce it — a bill can wait on a vendor in either the
    // spend platform or the accounting provider, and they are different fixes.
    expect(result.reason).toContain(AWAITING_MAPPING_CODE);
    expect(result.reason).toContain("bill AP000001");
    expect(result.reason).toContain("vendor sup_1");
    expect(result.reason).toContain("rillet");
    expect(isAwaitingMapping(result.reason)).toBe(true);
  });

  it("never pushes the dependency itself", async () => {
    // The whole point: no synchronous cross-engine call. The only thing this may
    // do is READ a mapping — anything else would make the spend push inherit
    // another provider's latency, failure modes and retry policy.
    const service = mappingService(null);

    await requireMappingOrDefer({
      mappingService: service,
      dependency: {
        integrationId: "rillet",
        entityType: "vendor",
        carbonId: "sup_1"
      },
      waitingFor: "bill AP000001"
    });

    expect(Object.keys(service)).toEqual(["getExternalId"]);
    expect(service.getExternalId).toHaveBeenCalledOnce();
  });

  it("does not mistake an unrelated skip reason for a deferral", () => {
    expect(isAwaitingMapping("purchase invoice is Draft")).toBe(false);
    expect(isAwaitingMapping(null)).toBe(false);
  });
});
