// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import metadata from "../app/routes/api+/mcp+/lib/tool-metadata.json";

// A create whose input requires the new row's `id` makes an API caller invent
// one, and a reused or copied id fails the insert. The table makes one; a form
// that needs its own key may still send it.

type Tool = { name: string; schema: { required?: string[] } };

// Creates where `id` is not the new row's key, so it must be sent.
const ID_IS_NOT_THE_NEW_ROW: Record<string, string> = {
  items_createPart: "the part number",
  items_createMaterial: "the material number",
  items_createTool: "the tool number",
  items_createConsumable: "the consumable number",
  people_insertEmployeeJob: "the employee's user",
  quality_createIssueAssociation: "the record linked to the issue",
  resources_createContractor: "the supplier contact the contractor is",
  resources_createPartner: "the supplier location the partner is"
};

const CREATE = /^[a-z]+_(create|insert|add)[A-Z]/;

describe("create operations", () => {
  it("leave the new row's id to the table", () => {
    const requireId = (metadata.tools as Tool[])
      .filter((tool) => CREATE.test(tool.name))
      .filter((tool) => tool.schema.required?.includes("id"))
      .map((tool) => tool.name)
      .filter((name) => !(name in ID_IS_NOT_THE_NEW_ROW));
    expect(requireId).toEqual([]);
  });
});
