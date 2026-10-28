// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { changesCompanyPlanHub, hubAccess } from "./access";

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

describe("changesCompanyPlanHub", () => {
  it("lets page files and assignments through before a switch", () => {
    expect(changesCompanyPlanHub("setMemberPage")).toBe(false);
    expect(changesCompanyPlanHub("deleteMemberPage")).toBe(false);
    expect(changesCompanyPlanHub("setAssignee")).toBe(false);
  });

  it("holds back every write the Company Plan hub reads", () => {
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
      expect(changesCompanyPlanHub(intent)).toBe(true);
    }
  });
});
