// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

vi.mock("@carbon/content/glossary", () => ({
  terms: {},
  glossaryEntries: () => []
}));

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray | string, ...values: unknown[]) =>
    Array.isArray(strings)
      ? strings.reduce(
          (acc, s, i) => acc + s + (i < values.length ? String(values[i]) : ""),
          ""
        )
      : strings
}));

import { resolveUserSelectIds } from "./users.service";

function query(result: { data: unknown; error: unknown }, filters: unknown[]) {
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push(["eq", column, value]);
      return builder;
    },
    in: (column: string, value: unknown) => {
      filters.push(["in", column, value]);
      return builder;
    },
    then: (
      resolve: (value: { data: unknown; error: unknown }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject)
  };
  return builder;
}

describe("resolveUserSelectIds", () => {
  it("loads profiles from this company's group members, including a deactivated user", async () => {
    const memberFilters: unknown[] = [];
    const userFilters: unknown[] = [];
    const client = {
      from(table: string) {
        if (table === "groupMembers") {
          return query(
            {
              error: null,
              data: [
                { memberUserId: "ada" },
                { memberUserId: "ada" },
                { memberUserId: "gone" }
              ]
            },
            memberFilters
          );
        }
        if (table === "user") {
          return query(
            {
              error: null,
              data: [
                {
                  id: "ada",
                  firstName: "Ada",
                  lastName: "Lovelace",
                  fullName: "Ada Lovelace",
                  email: "ada@example.com",
                  avatarUrl: null
                },
                {
                  id: "gone",
                  firstName: "Grace",
                  lastName: "Hopper",
                  fullName: "Grace Hopper",
                  email: "grace@example.com",
                  avatarUrl: null
                }
              ]
            },
            userFilters
          );
        }
        return query({ error: null, data: [] }, []);
      }
    };

    const { users } = await resolveUserSelectIds(client as never, "co", [
      "ada",
      "gone",
      "other"
    ]);

    expect(memberFilters).toEqual([
      ["eq", "companyId", "co"],
      ["in", "memberUserId", ["ada", "gone", "other"]]
    ]);
    expect(userFilters).toEqual([["in", "id", ["ada", "gone"]]]);
    expect(users.data).toEqual([
      {
        id: "ada",
        firstName: "Ada",
        lastName: "Lovelace",
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        avatarUrl: null
      },
      {
        id: "gone",
        firstName: "Grace",
        lastName: "Hopper",
        fullName: "Grace Hopper",
        email: "grace@example.com",
        avatarUrl: null
      }
    ]);
  });

  it("returns the membership error and does not read user", async () => {
    const seen: string[] = [];
    const client = {
      from(table: string) {
        seen.push(table);
        if (table === "groupMembers") {
          return query({ data: null, error: { message: "nope" } }, []);
        }
        return query({ data: [], error: null }, []);
      }
    };

    const { users } = await resolveUserSelectIds(client as never, "co", [
      "ada"
    ]);

    expect(users.error).toEqual({ message: "nope" });
    expect(users.data).toBeNull();
    expect(seen).not.toContain("user");
  });
});
