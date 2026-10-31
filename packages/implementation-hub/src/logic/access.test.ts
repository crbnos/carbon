// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { changesImplementationHub1, hubAccess } from "./access";

describe("hubAccess", () => {
  it("lets everyone in once the company is enrolled", () => {
    expect(hubAccess(true, false)).toBe("enrolled");
    expect(hubAccess(true, true)).toBe("enrolled");
  });

  it("lets only Carbon staff into a company that is not enrolled", () => {
    expect(hubAccess(false, true)).toBe("staffOnly");
    expect(hubAccess(false, false)).toBe("none");
  });
});

describe("changesImplementationHub1", () => {
  it("lets page files, assignments and the priority set through before a switch", () => {
    expect(changesImplementationHub1("setMemberPage")).toBe(false);
    expect(changesImplementationHub1("deleteMemberPage")).toBe(false);
    expect(changesImplementationHub1("setAssignee")).toBe(false);
    expect(changesImplementationHub1("setPriority")).toBe(false);
  });

  it("holds back every write Implementation Hub 1.0 reads", () => {
    for (const intent of [
      "setCheck",
      "setChecks",
      "setField",
      "clearField",
      "addRow",
      "updateRow",
      "answerQuestion",
      "deleteRow",
      "setExclusions",
      "setTier",
      "setStatus",
      "setContacts",
      "verifyGate",
      "unverifyGate",
      "applyHandover"
    ] as const) {
      expect(changesImplementationHub1(intent)).toBe(true);
    }
  });
});
