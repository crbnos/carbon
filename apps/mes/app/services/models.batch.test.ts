import { describe, expect, it } from "vitest";
import { completeJobOperationBatchValidator } from "./models";

// The Complete Batch form submits variable-length per-member quantities as a
// nested array (ValidatedForm), with quantity/scrap coerced from form strings via
// zfd.numeric. The validator must parse that shape into a typed array the
// batch-operations edge fn "complete" path consumes. See
// .ai/specs/2026-08-21-job-operation-batching.md.
describe("completeJobOperationBatchValidator", () => {
  it("parses per-member quantities and optional scrap", () => {
    const result = completeJobOperationBatchValidator.safeParse({
      batchId: "bat_1",
      members: [
        { jobOperationId: "op_1", quantity: 5 },
        { jobOperationId: "op_2", quantity: 20, scrapQuantity: 2 },
        { jobOperationId: "op_3", quantity: 10 }
      ]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.batchId).toBe("bat_1");
      expect(result.data.members).toHaveLength(3);
      expect(result.data.members[1]).toEqual({
        jobOperationId: "op_2",
        quantity: 20,
        scrapQuantity: 2
      });
    }
  });

  it("coerces numeric strings from the form (zfd.numeric)", () => {
    const result = completeJobOperationBatchValidator.safeParse({
      batchId: "bat_1",
      members: [{ jobOperationId: "op_1", quantity: "7", scrapQuantity: "1" }]
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.members[0]).toEqual({
        jobOperationId: "op_1",
        quantity: 7,
        scrapQuantity: 1
      });
    }
  });

  it("rejects an empty members array", () => {
    const result = completeJobOperationBatchValidator.safeParse({
      batchId: "bat_1",
      members: []
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing batchId", () => {
    const result = completeJobOperationBatchValidator.safeParse({
      members: [{ jobOperationId: "op_1", quantity: 5 }]
    });
    expect(result.success).toBe(false);
  });

  it("rejects a negative quantity", () => {
    const result = completeJobOperationBatchValidator.safeParse({
      batchId: "bat_1",
      members: [{ jobOperationId: "op_1", quantity: -1 }]
    });
    expect(result.success).toBe(false);
  });
});
