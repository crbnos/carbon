// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import {
  claimsFor,
  type ExpandedClaims,
  type Grant,
  type Level,
  levelOf,
  MODULES,
  PAGES
} from "@carbon/database/access";
import { describe, expect, it } from "vitest";
import { pageClaims } from "../../../test/page-claims";
import { nonOperatorPinResetPermission } from "./users.models";
import { certifyItarEntity, deactivateUsers } from "./users.server";
import { canReAddDeactivatedEmployee, pinResetRefusal } from "./users.service";

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

describe("pinResetRefusal", () => {
  const grant = (
    subject: Grant["subject"],
    module: string,
    page: string | null,
    level: Level
  ): Grant => ({ subject, module, page, level });
  const user = (grants: Grant[], admin = false) => ({
    type: "user" as const,
    userId: "usr_actor",
    role: "employee" as const,
    permissions: claimsFor({ role: "employee", admin, grants }, COMPANY)
      .permissions
  });
  const target = (
    type: { systemType: string | null; isConsoleOperator: boolean },
    grants: Grant[],
    admin = false
  ) => ({
    ...type,
    employeeTypeCompanyId: COMPANY,
    admin,
    levels: PAGES.map((page) => ({
      page: page.id,
      level: levelOf({ admin, grants }, page.id).level
    }))
  });
  const operatorType = {
    systemType: "Console Operator",
    isConsoleOperator: true
  };
  // The Console Operator type's grants (`CONSOLE_OPERATOR_GRANTS`, @carbon/ee).
  const operatorGrants = (subject: Grant["subject"]) => [
    grant(subject, "Production", null, "Edit"),
    grant(subject, "Inventory", null, "Edit"),
    grant(subject, "Quality", null, "Edit"),
    grant(subject, "Resources", null, "View"),
    grant(subject, "People", null, "View")
  ];
  const operatorsEdit = grant("role", "Users", "users.operators", "Edit");
  const accountsEdit = grant("role", "Users", "users.accounts", "Edit");
  const peopleEdit = grant("role", "Settings", "settings.people", "Edit");

  it("refuses a non-Admin resetting an Admin's PIN", () => {
    const admin = target(
      { systemType: "Admin", isConsoleOperator: false },
      [],
      true
    );
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit, accountsEdit, peopleEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: admin
      })
    ).toBe("Only an Admin can reset an Admin's PIN");
  });

  it("refuses a non-Admin holding Full on every module resetting an Admin's PIN", () => {
    const everything = MODULES.map((module) =>
      grant("role", module.enum, null, "Full")
    );
    expect(
      pinResetRefusal({
        actor: user(everything),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: target(
          { systemType: "Admin", isConsoleOperator: false },
          [],
          true
        )
      })
    ).toBe("Only an Admin can reset an Admin's PIN");
  });

  it("refuses Operators Edit alone resetting an operator moved to another type", () => {
    // Still flagged a console operator, but no longer the Console Operator
    // type, and holding nothing the actor lacks.
    const raised = target({ systemType: null, isConsoleOperator: true }, [
      grant("role", "Users", "users.operators", "View")
    ]);
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: raised
      })
    ).toMatch(/not a console operator/);
  });

  it("refuses Operators and People Edit without Accounts Edit resetting a non-operator", () => {
    const employee = target({ systemType: null, isConsoleOperator: false }, [
      grant("role", "Users", "users.operators", "View")
    ]);
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit, peopleEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: employee
      })
    ).toMatch(/not a console operator/);
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit, accountsEdit, peopleEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: employee
      })
    ).toBeNull();
  });

  // The Employees "Set Console PIN" item checks the same constant.
  it("admits a non-operator's reset with exactly nonOperatorPinResetPermission, and no fewer", () => {
    const gate = Object.entries(nonOperatorPinResetPermission).map(
      ([page, level]) =>
        grant(
          "role",
          MODULES.find((m) => m.id === page.split(".")[0])!.enum,
          page,
          level
        )
    );
    expect(gate.length).toBeGreaterThan(1);
    const employee = target({ systemType: null, isConsoleOperator: false }, []);
    const reset = (grants: Grant[]) =>
      pinResetRefusal({
        actor: user([operatorsEdit, ...grants]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: employee
      });
    expect(reset(gate)).toBeNull();
    for (const missing of gate) {
      expect(reset(gate.filter((g) => g !== missing))).toMatch(
        /not a console operator/
      );
    }
  });

  it("refuses resetting the PIN of someone holding more than the actor", () => {
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: target(operatorType, operatorGrants("role"))
      })
    ).toMatch(/more access than you/);
  });

  it("allows Operators Edit resetting a real console operator's PIN", () => {
    expect(
      pinResetRefusal({
        actor: user([operatorsEdit, ...operatorGrants("role")]),
        actorIsAdmin: false,
        companyId: COMPANY,
        target: target(operatorType, operatorGrants("role"))
      })
    ).toBeNull();
  });

  it("allows an Admin resetting anyone's PIN", () => {
    const admin = user([], true);
    for (const someone of [
      target({ systemType: "Admin", isConsoleOperator: false }, [], true),
      target({ systemType: null, isConsoleOperator: true }, [
        grant("person", "Accounting", null, "Full")
      ]),
      target(operatorType, operatorGrants("role"))
    ]) {
      expect(
        pinResetRefusal({
          actor: admin,
          actorIsAdmin: true,
          companyId: COMPANY,
          target: someone
        })
      ).toBeNull();
    }
  });
});
