// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import {
  applyGroupPatch,
  applyUserPatch,
  ENTERPRISE_USER_SCHEMA,
  PATCH_OP_SCHEMA,
  parsePaging,
  parseScimBoolean,
  parseScimFilter,
  readGroupResource,
  readUserResource,
  type ScimGroupState,
  type ScimUserState,
  scimError,
  toScimUser,
  USER_SCHEMA
} from "./scim-protocol";

const jane: ScimUserState = {
  userName: "jane@acme.com",
  externalId: "00u1",
  email: "jane@acme.com",
  givenName: "Jane",
  familyName: "Doe",
  active: true
};

function patch(...Operations: unknown[]) {
  return { schemas: [PATCH_OP_SCHEMA], Operations };
}

describe("parseScimFilter", () => {
  it("reads Okta's userName filter", () => {
    expect(parseScimFilter('userName eq "jane@acme.com"')).toEqual({
      ok: true,
      value: [{ attribute: "userName", value: "jane@acme.com" }]
    });
  });

  it("reads clauses joined by and, in any keyword case", () => {
    expect(parseScimFilter('externalId EQ "00u1" AND userName eq "x"')).toEqual(
      {
        ok: true,
        value: [
          { attribute: "externalId", value: "00u1" },
          { attribute: "userName", value: "x" }
        ]
      }
    );
  });

  it("unescapes quotes and strips the schema prefix", () => {
    expect(
      parseScimFilter(`${USER_SCHEMA}:displayName eq "Say \\"hi\\""`)
    ).toEqual({
      ok: true,
      value: [{ attribute: "displayName", value: 'Say "hi"' }]
    });
  });

  it("treats an empty filter as no clause", () => {
    expect(parseScimFilter(null)).toEqual({ ok: true, value: [] });
    expect(parseScimFilter("  ")).toEqual({ ok: true, value: [] });
  });

  it("refuses an operator other than eq", () => {
    const result = parseScimFilter('userName co "jane"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.scimType).toBe("invalidFilter");
  });

  it("refuses or", () => {
    expect(parseScimFilter('userName eq "a" or userName eq "b"').ok).toBe(
      false
    );
  });
});

describe("parsePaging", () => {
  it("defaults to the first 100", () => {
    expect(parsePaging(new URL("https://x/scim/v2/Users"))).toEqual({
      startIndex: 1,
      count: 100
    });
  });

  it("clamps count and startIndex", () => {
    expect(
      parsePaging(new URL("https://x/scim/v2/Users?startIndex=0&count=5000"))
    ).toEqual({ startIndex: 1, count: 200 });
  });
});

describe("parseScimBoolean", () => {
  it("reads booleans and Entra's strings", () => {
    expect(parseScimBoolean(false)).toBe(false);
    expect(parseScimBoolean("False")).toBe(false);
    expect(parseScimBoolean("TRUE")).toBe(true);
    expect(parseScimBoolean("no")).toBeNull();
  });
});

describe("readUserResource", () => {
  it("reads Okta's create body (primary email, placeholder password)", () => {
    const result = readUserResource({
      schemas: [USER_SCHEMA],
      userName: "jane@acme.com",
      name: { givenName: "Jane", familyName: "Doe" },
      emails: [{ primary: true, value: "Jane@Acme.com", type: "work" }],
      displayName: "Jane Doe",
      externalId: "00u1",
      password: "ignored",
      groups: [],
      active: true
    });
    expect(result).toEqual({ ok: true, value: jane });
  });

  it("reads Okta AIW's PUT that deactivates", () => {
    const result = readUserResource({
      schemas: [USER_SCHEMA],
      id: "scimu_1",
      userName: "jane@acme.com",
      name: { givenName: "Jane", familyName: "Doe" },
      emails: [{ primary: true, value: "jane@acme.com", type: "work" }],
      active: false
    });
    expect(result.ok && result.value.active).toBe(false);
  });

  it("falls back to the work email, then to userName", () => {
    const work = readUserResource({
      userName: "jdoe",
      emails: [
        { value: "home@example.com", type: "home" },
        { value: "jane@acme.com", type: "work" }
      ]
    });
    expect(work.ok && work.value.email).toBe("jane@acme.com");

    const fromUserName = readUserResource({ userName: "jane@acme.com" });
    expect(fromUserName.ok && fromUserName.value.email).toBe("jane@acme.com");
  });

  it("splits displayName when name is missing", () => {
    const result = readUserResource({
      userName: "jane@acme.com",
      displayName: "Jane van Doe"
    });
    expect(result.ok && result.value).toMatchObject({
      givenName: "Jane",
      familyName: "van Doe"
    });
  });

  it("refuses a user with no email", () => {
    const result = readUserResource({ userName: "jdoe" });
    expect(result.ok).toBe(false);
  });

  it("refuses a missing userName", () => {
    expect(readUserResource({ emails: [{ value: "a@b.co" }] }).ok).toBe(false);
  });
});

describe("applyUserPatch", () => {
  it("applies Okta's no-path deactivate", () => {
    const result = applyUserPatch(
      jane,
      patch({ op: "replace", value: { active: false } })
    );
    expect(result).toEqual({ ok: true, value: { ...jane, active: false } });
  });

  it("applies Entra's default Replace with a string boolean", () => {
    const result = applyUserPatch(
      jane,
      patch({ op: "Replace", path: "active", value: "False" })
    );
    expect(result.ok && result.value.active).toBe(false);
  });

  it("applies Entra's flag shape: one no-path replace with dotted keys", () => {
    const result = applyUserPatch(
      jane,
      patch(
        {
          op: "replace",
          value: {
            displayName: "Jane Smith",
            "name.givenName": "Janet",
            "name.familyName": "Smith",
            [`${ENTERPRISE_USER_SCHEMA}:employeeNumber`]: "42"
          }
        },
        {
          op: "replace",
          path: 'emails[type eq "work"].value',
          value: "janet@acme.com"
        }
      )
    );
    expect(result).toEqual({
      ok: true,
      value: {
        ...jane,
        givenName: "Janet",
        familyName: "Smith",
        email: "janet@acme.com"
      }
    });
  });

  it("applies a nested name object and Add ops", () => {
    const result = applyUserPatch(
      jane,
      patch(
        { op: "Add", path: "name", value: { givenName: "J" } },
        { op: "Add", path: "externalId", value: "00u2" }
      )
    );
    expect(result.ok && result.value).toMatchObject({
      givenName: "J",
      familyName: "Doe",
      externalId: "00u2"
    });
  });

  it("ignores attributes Carbon has no column for", () => {
    const result = applyUserPatch(
      jane,
      patch(
        { op: "replace", path: "title", value: "Buyer" },
        { op: "add", path: "phoneNumbers", value: [{ value: "1" }] },
        {
          op: "replace",
          path: `${ENTERPRISE_USER_SCHEMA}:department`,
          value: "Ops"
        }
      )
    );
    expect(result).toEqual({ ok: true, value: jane });
  });

  it("refuses an unknown op", () => {
    const result = applyUserPatch(
      jane,
      patch({ op: "move", path: "active", value: false })
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a body with no Operations", () => {
    expect(applyUserPatch(jane, { schemas: [PATCH_OP_SCHEMA] }).ok).toBe(false);
  });

  it("refuses removing userName", () => {
    expect(
      applyUserPatch(jane, patch({ op: "remove", path: "userName" })).ok
    ).toBe(false);
  });
});

describe("groups", () => {
  const buyers: ScimGroupState = {
    displayName: "Buyers",
    externalId: null,
    memberIds: ["a", "b"]
  };

  it("reads a create body with members", () => {
    expect(
      readGroupResource({
        displayName: "Buyers",
        members: [{ value: "a", display: "A" }, { value: "a" }, { value: "b" }]
      })
    ).toEqual({ ok: true, value: buyers });
  });

  it("adds members", () => {
    const result = applyGroupPatch(
      buyers,
      patch({
        op: "Add",
        path: "members",
        value: [{ $ref: null, value: "c" }, { value: "a" }]
      })
    );
    expect(result.ok && result.value.memberIds).toEqual(["a", "b", "c"]);
  });

  it("removes a member by filter path (Entra flag shape)", () => {
    const result = applyGroupPatch(
      buyers,
      patch({ op: "remove", path: 'members[value eq "a"]' })
    );
    expect(result.ok && result.value.memberIds).toEqual(["b"]);
  });

  it("removes members by value array (Entra default)", () => {
    const result = applyGroupPatch(
      buyers,
      patch({ op: "Remove", path: "members", value: [{ value: "b" }] })
    );
    expect(result.ok && result.value.memberIds).toEqual(["a"]);
  });

  it("replaces members", () => {
    const result = applyGroupPatch(
      buyers,
      patch({ op: "replace", path: "members", value: [{ value: "z" }] })
    );
    expect(result.ok && result.value.memberIds).toEqual(["z"]);
  });

  it("renames with Okta's no-path value object", () => {
    const result = applyGroupPatch(
      buyers,
      patch({ op: "replace", value: { id: "g1", displayName: "Purchasing" } })
    );
    expect(result.ok && result.value.displayName).toBe("Purchasing");
  });

  it("refuses an add on a filtered members path", () => {
    expect(
      applyGroupPatch(
        buyers,
        patch({ op: "add", path: 'members[value eq "a"]', value: "x" })
      ).ok
    ).toBe(false);
  });
});

describe("responses", () => {
  it("answers errors as SCIM JSON", async () => {
    const response = scimError(409, "taken", "uniqueness");
    expect(response.status).toBe(409);
    expect(response.headers.get("Content-Type")).toBe("application/scim+json");
    expect(await response.json()).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "409",
      detail: "taken",
      scimType: "uniqueness"
    });
  });

  it("renders a user with its location", () => {
    const user = toScimUser(
      {
        id: "scimu_1",
        ...jane,
        createdAt: "2026-10-30T10:00:00+00:00",
        updatedAt: null
      },
      "https://erp.example.com/scim/v2"
    );
    expect(user).toMatchObject({
      id: "scimu_1",
      userName: "jane@acme.com",
      active: true,
      emails: [{ value: "jane@acme.com", type: "work", primary: true }],
      meta: {
        resourceType: "User",
        location: "https://erp.example.com/scim/v2/Users/scimu_1",
        lastModified: "2026-10-30T10:00:00+00:00"
      }
    });
  });
});
