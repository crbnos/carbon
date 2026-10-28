// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { Edition } from "@carbon/utils";
import { describe, expect, it } from "vitest";
import { isIntegrationComingSoon, isListedUserId } from "./plan";

const internalOnly = { id: "cad", internalOnly: true };
const customer = "buyer@example.com";

describe("isIntegrationComingSoon", () => {
  it("withholds an internal-only integration from a customer on Cloud", () => {
    expect(
      isIntegrationComingSoon(internalOnly, {
        edition: Edition.Cloud,
        email: customer,
        hasEarlyAccess: false
      })
    ).toBe(true);
  });

  it("offers it to Carbon staff on Cloud, whatever the casing", () => {
    for (const email of [
      "staff@carbon.ms",
      "Staff@Carbon.MS",
      "a@carbon.us.org"
    ]) {
      expect(
        isIntegrationComingSoon(internalOnly, {
          edition: Edition.Cloud,
          email,
          hasEarlyAccess: false
        })
      ).toBe(false);
    }
  });

  it("withholds it when the email is unknown", () => {
    expect(
      isIntegrationComingSoon(internalOnly, {
        edition: Edition.Cloud,
        email: null,
        hasEarlyAccess: false
      })
    ).toBe(true);
  });

  it("does not gate a self-hosted edition", () => {
    for (const edition of [
      Edition.Enterprise,
      Edition.Community,
      Edition.Test
    ]) {
      expect(
        isIntegrationComingSoon(internalOnly, {
          edition,
          email: customer,
          hasEarlyAccess: false
        })
      ).toBe(false);
    }
  });

  it("does not gate an integration that is not internal-only", () => {
    expect(
      isIntegrationComingSoon(
        { id: "cad" },
        {
          edition: Edition.Cloud,
          email: customer,
          hasEarlyAccess: false
        }
      )
    ).toBe(false);
  });

  it("offers it to a customer with early access on Cloud", () => {
    expect(
      isIntegrationComingSoon(internalOnly, {
        edition: Edition.Cloud,
        email: customer,
        hasEarlyAccess: true
      })
    ).toBe(false);
  });
});

describe("isListedUserId", () => {
  const list = "user-a, user-b ,user-c";

  it("finds an id anywhere in the list, ignoring spaces", () => {
    for (const id of ["user-a", "user-b", "user-c"]) {
      expect(isListedUserId(list, id)).toBe(true);
    }
  });

  it("ignores quotes left around the value", () => {
    expect(isListedUserId('"user-a,user-b"', "user-a")).toBe(true);
    expect(isListedUserId('"user-a,user-b"', "user-b")).toBe(true);
    expect(isListedUserId("'user-a'", "user-a")).toBe(true);
    expect(isListedUserId('" user-a "', "user-a")).toBe(true);
    expect(isListedUserId('"user-a" , " user-b"', "user-b")).toBe(true);
  });

  it("matches whole ids only", () => {
    expect(isListedUserId(list, "user")).toBe(false);
    expect(isListedUserId(list, "user-a, user-b")).toBe(false);
  });

  it("matches nothing for an empty list or an empty id", () => {
    expect(isListedUserId(undefined, "user-a")).toBe(false);
    expect(isListedUserId("", "user-a")).toBe(false);
    expect(isListedUserId("user-a,,", "")).toBe(false);
    expect(isListedUserId("user-a", null)).toBe(false);
  });
});
