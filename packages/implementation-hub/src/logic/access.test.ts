// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  changesImplementationHub1,
  checkStatesForCustomer,
  hubAccess,
  rowsForCustomer
} from "./access";

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

describe("rowsForCustomer", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "row_1",
    collection: "customization",
    payload: {
      title: "Label printer driver",
      kind: "integration",
      status: "agreed",
      detail: "Prints on the shop floor",
      requirementRowId: "row_9",
      targetDate: "2026-12-01",
      estimateDays: 4
    },
    sortOrder: 0,
    source: "handover",
    sourceRef: "Q12",
    ...overrides
  });

  it("drops a customization's type of work, estimate and served requirement", () => {
    expect(rowsForCustomer([row()])).toEqual([
      {
        id: "row_1",
        collection: "customization",
        payload: {
          title: "Label printer driver",
          status: "agreed",
          detail: "Prints on the shop floor",
          targetDate: "2026-12-01"
        },
        sortOrder: 0,
        source: null,
        sourceRef: null
      }
    ]);
  });

  it("keeps every other row's payload and drops only where it came from", () => {
    const question = row({
      collection: "question",
      payload: { title: "Base currency?", kind: "text", options: ["NOK"] }
    });
    expect(rowsForCustomer([question])).toEqual([
      { ...question, source: null, sourceRef: null }
    ]);
  });
});

describe("checkStatesForCustomer", () => {
  it("drops who ticked an item and keeps its verification", () => {
    expect(
      checkStatesForCustomer([
        {
          itemKey: "task:first-po",
          kind: "task",
          value: "done",
          source: "mcp",
          verifiedAt: "2026-11-11T10:00:00Z",
          verifiedBy: "user_1"
        }
      ])
    ).toEqual([
      {
        itemKey: "task:first-po",
        kind: "task",
        value: "done",
        source: null,
        verifiedAt: "2026-11-11T10:00:00Z",
        verifiedBy: "user_1"
      }
    ]);
  });
});
