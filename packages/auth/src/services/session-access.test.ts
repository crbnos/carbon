// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { type SessionClaims, sessionAccess } from "./session-access";

const COMPANY = "cmp_1";
const JOBS_FULL = { "production.jobs": "Full" } as const;

const claims = (
  role: SessionClaims["role"],
  jobs: string[] = []
): SessionClaims => ({
  role,
  permissions: {
    "production.jobs": {
      view: jobs.includes("view") ? [COMPANY] : [],
      create: jobs.includes("create") ? [COMPANY] : [],
      update: jobs.includes("update") ? [COMPANY] : [],
      delete: jobs.includes("delete") ? [COMPANY] : []
    }
  }
});

const manager = claims("employee", ["view", "create", "update", "delete"]);
const operator = claims("employee", ["view", "update"]);

describe("sessionAccess", () => {
  it("checks the session user when no operator is pinned in", () => {
    expect(sessionAccess(COMPANY, JOBS_FULL, {}, manager, null)).toEqual({
      claims: manager,
      refusedBy: null
    });
    expect(sessionAccess(COMPANY, JOBS_FULL, {}, operator, null)).toEqual({
      claims: operator,
      refusedBy: operator
    });
  });

  it("lets the pinned operator's grants decide on a console terminal", () => {
    // A manager's terminal does not lend its grants to the operator.
    expect(sessionAccess(COMPANY, JOBS_FULL, {}, manager, operator)).toEqual({
      claims: operator,
      refusedBy: operator
    });
    // A pinned manager acts with their own grants on an operator's terminal.
    expect(sessionAccess(COMPANY, JOBS_FULL, {}, operator, manager)).toEqual({
      claims: manager,
      refusedBy: null
    });
  });

  it("refuses when the terminal's session user is no longer an employee", () => {
    const gone = claims(null);
    expect(sessionAccess(COMPANY, {}, {}, gone, manager)).toEqual({
      claims: manager,
      refusedBy: gone
    });
  });
});
