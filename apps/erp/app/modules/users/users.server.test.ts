// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import {
  certifyItarEntity,
  deactivateUsers,
  resetConsoleOperatorPin
} from "./users.server";
import {
  canReAddDeactivatedEmployee,
  makePermissionsFromEmployeeType
} from "./users.service";

const COMPANY = "cmp_1";

describe("canReAddDeactivatedEmployee", () => {
  const grant = (users: string[], people: string[]) => ({
    users: { view: [], create: [COMPANY], update: users, delete: [] },
    people: { view: [], create: people, update: [], delete: [] }
  });

  it("allows an inviter with users update and people create", () => {
    expect(
      canReAddDeactivatedEmployee(grant([COMPANY], [COMPANY]), COMPANY)
    ).toBe(true);
  });

  it.each([
    ["users create alone", grant([], [])],
    ["no people create", grant([COMPANY], [])],
    ["no users update", grant([], [COMPANY])],
    ["both, for another company", grant(["cmp_2"], ["cmp_2"])],
    ["unreadable claims", null]
  ])("refuses an inviter with %s", (_label, permissions) => {
    expect(canReAddDeactivatedEmployee(permissions, COMPANY)).toBe(false);
  });
});

describe("makePermissionsFromEmployeeType", () => {
  it("keys each module's grants by module_action", () => {
    expect(
      makePermissionsFromEmployeeType({
        data: [
          {
            module: "Sales",
            view: [COMPANY],
            create: [COMPANY],
            update: [],
            delete: []
          }
        ]
      })
    ).toEqual({
      sales_view: [COMPANY],
      sales_create: [COMPANY],
      sales_update: [],
      sales_delete: []
    });
  });
});

const unreachable = () => {
  throw new Error("must not be reached");
};

/** A user in COMPANY holding `permissions`; the caller client returns `user`. */
function userContext(
  permissions: Record<string, Record<string, string[]>>,
  user: Record<string, unknown> | null = null
) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    single: async () =>
      user ? { data: user, error: null } : { data: null, error: {} }
  };
  return createServiceContext({
    actor: { type: "user", userId: "usr_admin", permissions },
    company: { id: COMPANY, groupId: "grp_1" },
    caller: { from: () => chain } as never,
    system: unreachable as never,
    pg: unreachable as never,
    kv: unreachable as never
  });
}

describe("operation guards", () => {
  // A PIN signs in as that person anywhere on the floor, so anyone but a
  // console operator needs settings update as well.
  it("refuses resetting a non-operator's PIN with users update alone", async () => {
    const result = await resetConsoleOperatorPin(
      userContext(
        { users: { update: [COMPANY] } },
        { id: "usr_1", isConsoleOperator: false }
      ),
      { operatorId: "usr_1" }
    );
    expect(result.error?.category).toBe("forbidden");
  });

  it("refuses deactivating the caller's own account", async () => {
    const result = await deactivateUsers(
      userContext({ users: { delete: [COMPANY] } }),
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
        scopes: {
          users: { view: [], create: [], update: [COMPANY], delete: [] }
        }
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
