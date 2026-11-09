// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  bulkInviteResultForEmailDelivery,
  canBulkActOnUser,
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

const context = {
  actorId: "me",
  unrevokedInviteEmails: new Set(["pending@example.com"])
};

const user = (
  id: string,
  active: boolean | null,
  email: string | null = `${id}@example.com`
) => ({ id, active, email });

describe("canBulkActOnUser", () => {
  it("edits the permissions of active users only", () => {
    expect(canBulkActOnUser("permissions", user("a", true), context)).toBe(
      true
    );
    expect(canBulkActOnUser("permissions", user("b", false), context)).toBe(
      false
    );
  });

  it("deactivates active users other than the actor", () => {
    expect(canBulkActOnUser("deactivate", user("a", true), context)).toBe(true);
    expect(canBulkActOnUser("deactivate", user("me", true), context)).toBe(
      false
    );
    expect(canBulkActOnUser("deactivate", user("b", false), context)).toBe(
      false
    );
  });

  it("invites inactive users with an email and no unrevoked invite", () => {
    expect(canBulkActOnUser("invite", user("a", false), context)).toBe(true);
    expect(canBulkActOnUser("invite", user("a", true), context)).toBe(false);
    expect(canBulkActOnUser("invite", user("a", false, null), context)).toBe(
      false
    );
    expect(
      canBulkActOnUser(
        "invite",
        user("p", false, "pending@example.com"),
        context
      )
    ).toBe(false);
  });
});
