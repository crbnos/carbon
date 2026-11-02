// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { canBulkActOnUser } from "./users.models";

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
