// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { holdsGate } from "@carbon/database/access";
import { describe, expect, it } from "vitest";
import { projectReportPermissions } from "../app/modules/projects/projects.models";

const view = (...pages: string[]) =>
  Object.fromEntries(
    pages.map((page) => [
      page,
      { view: ["c1"], create: [], update: [], delete: [] }
    ])
  ) as never;

// Cost by CLIN rolls up contracts, which either contracts list opens.
describe("the Cost by CLIN report's gate", () => {
  const gate = projectReportPermissions["cost-by-clin"];

  it.each(["sales.serviceContracts", "sales.projectContracts"])(
    "admits Project Reports with %s",
    (contracts) => {
      expect(holdsGate(view("projects.reports", contracts), gate, "c1")).toBe(
        true
      );
    }
  );

  it("refuses Project Reports without a contracts page", () => {
    expect(holdsGate(view("projects.reports"), gate, "c1")).toBe(false);
  });

  it("refuses a contracts page without Project Reports", () => {
    expect(holdsGate(view("sales.projectContracts"), gate, "c1")).toBe(false);
  });
});
