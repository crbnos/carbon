// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The module's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import { createServiceContext } from "@carbon/api/service-fn.server";
import { upsertSavedView } from "../app/modules/shared/shared.server";
import { filteringSupabase } from "./filtering-supabase-fake";

const unreachable = () => {
  throw new Error("must not be reached");
};

function saveView(id?: string) {
  const { client, writes } = filteringSupabase({
    tableView: id
      ? [{ id, companyId: "company-1", createdBy: "user-0", sortOrder: 1 }]
      : []
  });
  const ctx = createServiceContext({
    actor: { type: "user", role: "employee", userId: "user-1", permissions: {} },
    company: { id: "company-1", groupId: "group-1" },
    caller: client,
    system: unreachable,
    pg: unreachable,
    kv: unreachable
  });
  return {
    writes,
    result: upsertSavedView(ctx, {
      id,
      name: "Audit columns",
      table: "part",
      type: "Private",
      columnVisibility: { createdBy: false, updatedBy: true, name: true }
    })
  };
}

describe("upsertSavedView", () => {
  // Column ids that match audit field names must not be stamped with the user id.
  it.each([
    ["creates", undefined],
    ["updates", "view-1"]
  ])("%s a view keeping its createdBy/updatedBy column visibility", async (_, id) => {
    const { writes, result } = saveView(id);
    expect((await result).error).toBeNull();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.value.columnVisibility).toEqual({
      createdBy: false,
      updatedBy: true,
      name: true
    });
  });
});
