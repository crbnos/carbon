// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  onshapeOwnedFieldConflicts,
  withoutOnshapeOwnedFields
} from "./items.models";

const bracket = {
  readableId: "BRK-100",
  name: "Bracket",
  description: "Machined bracket"
};

describe("onshapeOwnedFieldConflicts", () => {
  it("passes an edit that leaves the owned fields as they are", () => {
    expect(
      onshapeOwnedFieldConflicts([bracket], {
        name: "Bracket",
        description: "Machined bracket"
      })
    ).toEqual([]);
  });

  it("names the item an edit would change", () => {
    expect(
      onshapeOwnedFieldConflicts([bracket], { description: "Cast bracket" })
    ).toEqual([bracket]);
  });

  it("treats an empty value and a missing one as the same", () => {
    const blank = { ...bracket, description: null };
    expect(onshapeOwnedFieldConflicts([blank], { description: "" })).toEqual(
      []
    );
  });

  it("counts clearing a value as a change", () => {
    expect(
      onshapeOwnedFieldConflicts([bracket], { description: null })
    ).toEqual([bracket]);
  });

  it("ignores a field the caller is not writing", () => {
    expect(
      onshapeOwnedFieldConflicts([bracket], {
        name: "Bracket",
        description: undefined
      })
    ).toEqual([]);
  });

  it("checks every item of a bulk edit", () => {
    const plate = { readableId: "PLT-200", name: "Plate", description: null };
    expect(
      onshapeOwnedFieldConflicts([bracket, plate], { name: "Plate" })
    ).toEqual([bracket]);
  });
});

describe("withoutOnshapeOwnedFields", () => {
  it("leaves the owned keys out rather than setting them to undefined", () => {
    const write = withoutOnshapeOwnedFields({
      name: "Bracket",
      description: undefined,
      replenishmentSystem: "Make",
      active: true
    });
    expect(Object.keys(write)).toEqual(["replenishmentSystem", "active"]);
  });
});
