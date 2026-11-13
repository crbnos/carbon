// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The write itself (user row and type move in one transaction, refused as a
// whole) is `writeAccessGrants`' `{ keep: true }`, covered by
// test/database/ee/access-grants.ee.test.ts.

import { createServiceContext } from "@carbon/api/service-fn.server";
import type { ExpandedClaims } from "@carbon/database/access";
import { describe, expect, it } from "vitest";
import { convertConsoleOperatorPermission } from "./users.models";
import { convertConsoleOperator } from "./users.server";

const COMPANY = "cmp_1";

const edit = (page: string) => ({
  [page]: { view: [COMPANY], create: [COMPANY], update: [COMPANY], delete: [] }
});

const unavailable = (name: string): never =>
  new Proxy({} as never, {
    get() {
      throw new Error(`A refused call reaches no ${name}`);
    }
  });

const contextHolding = (pages: string[]) =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "usr_actor",
      role: "employee",
      permissions: Object.assign({}, ...pages.map(edit)) as ExpandedClaims
    },
    company: { id: COMPANY, groupId: "grp_1" },
    caller: unavailable("caller client"),
    system: () => unavailable("service-role client"),
    pg: () => unavailable("database"),
    kv: () => unavailable("kv")
  });

const input = {
  operatorId: "usr_operator",
  email: "new.user@example.com",
  employeeType: "et_prod"
};

describe("convertConsoleOperator", () => {
  // Converting creates a sign-in account and picks its employee type: that is
  // the Accounts page's power, not the Operators page's.
  it("refuses Operators Edit without Accounts Edit, before touching anything", async () => {
    const ctx = createServiceContext({
      actor: {
        type: "user",
        userId: "usr_actor",
        role: "employee",
        permissions: edit("users.operators") as ExpandedClaims
      },
      company: { id: COMPANY, groupId: "grp_1" },
      caller: unavailable("caller client"),
      system: () => unavailable("service-role client"),
      pg: () => unavailable("database"),
      kv: () => unavailable("kv")
    });
    const result = await convertConsoleOperator(ctx, {
      operatorId: "usr_operator",
      email: "new.user@example.com",
      employeeType: "et_prod"
    });
    expect(result.error?.category).toBe("forbidden");
  });

  // The route and the "Convert to Full User" item check the same constant.
  it("admits exactly convertConsoleOperatorPermission: every page of it, and no fewer", async () => {
    const pages = Object.keys(convertConsoleOperatorPermission);
    expect(pages.length).toBeGreaterThan(1);
    const all = await convertConsoleOperator(contextHolding(pages), input);
    expect(all.error?.category).not.toBe("forbidden");
    for (const missing of pages) {
      const result = await convertConsoleOperator(
        contextHolding(pages.filter((page) => page !== missing)),
        input
      );
      expect(result.error?.category).toBe("forbidden");
    }
  });
});
