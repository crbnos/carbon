import { describe, expect, it } from "vitest";
import {
  bulkInviteResultForEmailDelivery,
  indexBulkInviteResultsByRowId
} from "./users.models";

describe("indexBulkInviteResultsByRowId", () => {
  it("keeps invitation results on the same row after a middle row is removed", () => {
    const results = [
      {
        rowId: "row-a",
        email: "a@example.com",
        success: true,
        message: "Invited"
      },
      {
        rowId: "row-b",
        email: "b@example.com",
        success: false,
        message: "Failed"
      },
      {
        rowId: "row-c",
        email: "c@example.com",
        success: true,
        message: "Invited"
      }
    ];

    const remainingRowIds = ["row-a", "row-c"];
    const byRowId = indexBulkInviteResultsByRowId(results);

    expect(remainingRowIds.map((rowId) => byRowId.get(rowId)?.email)).toEqual([
      "a@example.com",
      "c@example.com"
    ]);
    expect(byRowId.get("row-c")?.success).toBe(true);
  });
});

describe("bulkInviteResultForEmailDelivery", () => {
  it("does not mark an invitation successful when sendEmail fails", () => {
    const result = bulkInviteResultForEmailDelivery({
      rowId: "row-a",
      email: "a@example.com",
      delivered: false
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe("Created, but invite email failed to send");
  });
});
