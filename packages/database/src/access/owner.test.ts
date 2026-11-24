// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { ownershipTransferRefusal, ownsCompany } from "./owner";

describe("ownsCompany", () => {
  it("is the group's owner only", () => {
    expect(ownsCompany("usr_owner", "usr_owner")).toBe(true);
    expect(ownsCompany("usr_owner", "usr_admin")).toBe(false);
  });

  it("is nobody when the group has no owner or the caller is no user", () => {
    expect(ownsCompany(null, null)).toBe(false);
    expect(ownsCompany(undefined, undefined)).toBe(false);
    expect(ownsCompany("", "")).toBe(false);
    expect(ownsCompany("usr_owner", null)).toBe(false);
  });
});

describe("ownershipTransferRefusal", () => {
  const transfer = {
    ownerId: "usr_owner",
    callerId: "usr_owner",
    newOwnerId: "usr_next",
    newOwnerIsGroupEmployee: true
  };

  it("lets the owner hand the group to an employee of it", () => {
    expect(ownershipTransferRefusal(transfer)).toBeNull();
  });

  it("refuses anyone but the owner, whatever they hold", () => {
    expect(
      ownershipTransferRefusal({ ...transfer, callerId: "usr_admin" })
    ).toBe("notOwner");
    expect(ownershipTransferRefusal({ ...transfer, ownerId: null })).toBe(
      "notOwner"
    );
  });

  it("refuses a transfer to the owner themself", () => {
    expect(
      ownershipTransferRefusal({ ...transfer, newOwnerId: "usr_owner" })
    ).toBe("sameOwner");
  });

  it("refuses a new owner who is not an active employee in the group", () => {
    expect(
      ownershipTransferRefusal({ ...transfer, newOwnerIsGroupEmployee: false })
    ).toBe("notEmployee");
  });
});
