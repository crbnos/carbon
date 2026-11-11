// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import type { ExpandedClaims } from "@carbon/database/access";
import { describe, expect, it } from "vitest";
import { pageClaims } from "../../../test/page-claims";
import {
  certifyItarEntity,
  deactivateUsers,
  resetConsoleOperatorPin
} from "./users.server";
import { canReAddDeactivatedEmployee } from "./users.service";

const COMPANY = "cmp_1";

describe("canReAddDeactivatedEmployee", () => {
  const level = (actions: Partial<Record<"create" | "update", string[]>>) => ({
    view: [],
    create: [],
    update: [],
    delete: [],
    ...actions
  });
  const accountsEdit = { "users.accounts": level({ update: [COMPANY] }) };
  const employeesCreate = { "people.employees": level({ create: [COMPANY] }) };

  it("allows an inviter with Edit on Accounts and Create on Employees", () => {
    expect(
      canReAddDeactivatedEmployee(
        { ...accountsEdit, ...employeesCreate },
        COMPANY
      )
    ).toBe(true);
  });

  it.each([
    ["Edit on Accounts alone", accountsEdit],
    ["Create on Employees alone", employeesCreate],
    [
      "Create, not Edit, on Accounts",
      { "users.accounts": level({ create: [COMPANY] }), ...employeesCreate }
    ],
    [
      "both, for another company",
      {
        "users.accounts": level({ update: ["cmp_2"] }),
        "people.employees": level({ create: ["cmp_2"] })
      }
    ],
    [
      "Edit on every other Users page",
      {
        "users.operators": level({ update: [COMPANY] }),
        "users.groups": level({ update: [COMPANY] }),
        "users.employeeTypes": level({ update: [COMPANY] }),
        ...employeesCreate
      }
    ],
    [
      "Create on every other People page",
      {
        ...accountsEdit,
        "people.timecards": level({ create: [COMPANY] }),
        "people.attributes": level({ create: [COMPANY] }),
        "people.departments": level({ create: [COMPANY] }),
        "people.holidays": level({ create: [COMPANY] }),
        "people.shifts": level({ create: [COMPANY] }),
        "people.payrollTotals": level({ create: [COMPANY] })
      }
    ],
    ["unreadable claims", null]
  ])("refuses an inviter with %s", (_label, permissions) => {
    expect(canReAddDeactivatedEmployee(permissions, COMPANY)).toBe(false);
  });
});

const unreachable = () => {
  throw new Error("must not be reached");
};

/** A user in COMPANY holding `permissions`; the caller client returns `user`. */
function userContext(
  permissions: ExpandedClaims,
  user: Record<string, unknown> | null = null
) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    single: async () =>
      user ? { data: user, error: null } : { data: null, error: {} }
  };
  return createServiceContext({
    actor: {
      type: "user",
      userId: "usr_admin",
      permissions: pageClaims(permissions),
      role: "employee"
    },
    company: { id: COMPANY, groupId: "grp_1" },
    caller: { from: () => chain } as never,
    system: unreachable as never,
    pg: unreachable as never,
    kv: unreachable as never
  });
}

describe("operation guards", () => {
  // A PIN signs in as that person anywhere on the floor, so anyone but a
  // console operator needs Edit on Settings → People as well.
  it("refuses resetting a non-operator's PIN with users Edit alone", async () => {
    const result = await resetConsoleOperatorPin(
      userContext(
        { users: { view: [], create: [], update: [COMPANY], delete: [] } },
        { id: "usr_1", isConsoleOperator: false }
      ),
      { operatorId: "usr_1" }
    );
    expect(result.error?.category).toBe("forbidden");
  });

  it("refuses deactivating the caller's own account", async () => {
    const result = await deactivateUsers(
      userContext({
        users: { view: [], create: [], update: [], delete: [COMPANY] }
      }),
      { userIds: ["usr_1", "usr_admin"] }
    );
    expect(result.error?.category).toBe("rule");
  });

  // An API key authenticates as the key, not a person: there is no signer.
  it("refuses an API key signing the ITAR Rider", async () => {
    const ctx = createServiceContext({
      actor: {
        type: "apiKey",
        createdBy: "usr_admin",
        permissions: pageClaims({
          users: { view: [], create: [], update: [COMPANY], delete: [] }
        })
      },
      company: { id: COMPANY, groupId: "grp_1" },
      caller: {} as never,
      system: unreachable as never,
      pg: unreachable as never,
      kv: unreachable as never
    });
    const result = await certifyItarEntity(ctx, {
      authorityToBind: true,
      acceptRider: true,
      fullLegalName: "Pat Doe",
      title: "CEO",
      complianceContact: "export@example.com"
    });
    expect(result.error?.category).toBe("forbidden");
  });
});
