// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { restoreLoadsColumn, restoreLoadsTable } from "./schema";

describe("restoreLoadsColumn", () => {
  it.each(["tokenHash", "tokenPreview"])(
    "never brings back the SCIM %s from a backup, so a revoked token stays revoked",
    (column) => {
      expect(
        restoreLoadsColumn("scimConnection", column, { stripSecrets: true })
      ).toBe(false);
    }
  );

  it("keeps the SCIM token when reverting to the snapshot a restore just took", () => {
    expect(
      restoreLoadsColumn("scimConnection", "tokenHash", { stripSecrets: false })
    ).toBe(true);
  });

  it("loads every other SCIM column, so the identity provider's ids survive", () => {
    expect(
      restoreLoadsColumn("scimConnection", "defaultEmployeeTypeId", {
        stripSecrets: true
      })
    ).toBe(true);
  });
});

describe("restoreLoadsTable", () => {
  it.each(["scimConnection", "scimUser", "scimGroup", "scimGroupMember"])(
    "leaves %s empty when the backup is another company's",
    (table) => {
      expect(restoreLoadsTable(table, { foreign: true })).toBe(false);
    }
  );

  it("loads the SCIM tables from the company's own backup", () => {
    expect(restoreLoadsTable("scimUser", { foreign: false })).toBe(true);
  });

  it("loads every other table into another company", () => {
    expect(restoreLoadsTable("item", { foreign: true })).toBe(true);
  });
});
