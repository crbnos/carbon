// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { resolveInboundAssignee } from "./assignee";

describe("resolveInboundAssignee", () => {
  it("clears the assignee when the issue is unassigned", () => {
    expect(
      resolveInboundAssignee({ issueHasAssignee: false, matchedUserId: null })
    ).toBeNull();
  });

  it("sets the matched Carbon user", () => {
    expect(
      resolveInboundAssignee({ issueHasAssignee: true, matchedUserId: "u1" })
    ).toBe("u1");
  });

  it("leaves the assignee unchanged when no employee matches", () => {
    expect(
      resolveInboundAssignee({ issueHasAssignee: true, matchedUserId: null })
    ).toBeUndefined();
  });
});
