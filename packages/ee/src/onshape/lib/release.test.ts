import { describe, expect, it } from "vitest";
import type { OnshapeReleasePackage } from "./client";
import {
  readReleasePackageApprovers,
  readReleasePackageName,
  readReleasePackageNotes,
  readReleasePackageState
} from "./release";

// These readers decide what text a human sees on an auto-created change notice
// and on an item's notes. Matching the wrong property writes someone's side
// conversation into a reason for change; matching a localised display name
// makes the integration work in English and silently return nothing in German.
// Both failures are invisible until a customer reads the output, so the
// resolution order is pinned here rather than left to convention.

const NAME_ID = "594964b7040fc85d2b418138";
const NOTES_ID = "594964df040fc85d2b418144";
const COMMENT_ID = "594964df040fc85d2b418145";
const APPROVERS_ID = "59403fa4040fc83120937a90";

function pkg(overrides: Partial<OnshapeReleasePackage>): OnshapeReleasePackage {
  return { id: "rp-1", ...overrides } as OnshapeReleasePackage;
}

describe("readReleasePackageName", () => {
  it("prefers the property id over the top-level key", () => {
    expect(
      readReleasePackageName(
        pkg({
          name: "stale top level",
          properties: [{ propertyId: NAME_ID, value: "REL-001 Erstfreigabe" }]
        })
      )
    ).toBe("REL-001 Erstfreigabe");
  });

  it("falls back to the top-level key when properties are absent", () => {
    expect(readReleasePackageName(pkg({ name: "REL-002" }))).toBe("REL-002");
  });

  it("does NOT match on the localised display name", () => {
    // A company custom property labelled the same way in another locale must
    // not be mistaken for Onshape's stock field.
    expect(
      readReleasePackageName(
        pkg({ properties: [{ name: "Release name", value: "impostor" }] })
      )
    ).toBeNull();
  });

  it("treats an empty or whitespace value as absent", () => {
    expect(
      readReleasePackageName(
        pkg({ properties: [{ propertyId: NAME_ID, value: "   " }] })
      )
    ).toBeNull();
    expect(readReleasePackageName(pkg({ name: "" }))).toBeNull();
  });

  it("survives null, undefined and a non-object", () => {
    expect(readReleasePackageName(null)).toBeNull();
    expect(readReleasePackageName(undefined)).toBeNull();
  });
});

describe("readReleasePackageNotes", () => {
  it("reads the notes property, not the comment property", () => {
    expect(
      readReleasePackageNotes(
        pkg({
          properties: [
            { propertyId: COMMENT_ID, value: "side conversation" },
            { propertyId: NOTES_ID, value: "Initial release of the assembly." }
          ]
        })
      )
    ).toBe("Initial release of the assembly.");
  });

  it("never returns a comment when there are no notes", () => {
    expect(
      readReleasePackageNotes(
        pkg({ properties: [{ propertyId: COMMENT_ID, value: "just a note" }] })
      )
    ).toBeNull();
  });

  it("falls back to the top-level description", () => {
    expect(
      readReleasePackageNotes(pkg({ description: "from top level" }))
    ).toBe("from top level");
  });

  it("clamps to Onshape's own 10000-character cap", () => {
    const long = "x".repeat(12_000);
    expect(
      readReleasePackageNotes(
        pkg({ properties: [{ propertyId: NOTES_ID, value: long }] })
      )
    ).toHaveLength(10_000);
  });

  it("returns null when the releaser wrote none", () => {
    expect(readReleasePackageNotes(pkg({}))).toBeNull();
  });
});

describe("readReleasePackageState", () => {
  it("prefers workflow.state.name", () => {
    expect(
      readReleasePackageState(
        pkg({
          metadataState: "OBSOLETE",
          workflow: {
            state: { name: "RELEASED" },
            currentStateDisplayName: "Released"
          }
        })
      )
    ).toBe("RELEASED");
  });

  it("falls back to metadataState, then to the display name", () => {
    expect(readReleasePackageState(pkg({ metadataState: "RELEASED" }))).toBe(
      "RELEASED"
    );
    expect(
      readReleasePackageState(
        pkg({ workflow: { currentStateDisplayName: "Released" } })
      )
    ).toBe("Released");
  });
});

describe("readReleasePackageApprovers", () => {
  it("returns [] for the common no-approvers-configured case", () => {
    // The probed live package had exactly this: the property exists, the value
    // is an empty array. That is "nobody was asked", not "nobody approved".
    expect(
      readReleasePackageApprovers(
        pkg({ properties: [{ propertyId: APPROVERS_ID, value: [] }] })
      )
    ).toEqual([]);
  });

  it("returns [] when the property is missing entirely", () => {
    expect(readReleasePackageApprovers(pkg({}))).toEqual([]);
  });

  it("reads strings and object entries, preferring name then email then id", () => {
    expect(
      readReleasePackageApprovers(
        pkg({
          properties: [
            {
              propertyId: APPROVERS_ID,
              value: [
                "Plain String",
                { name: "Ada Lovelace", email: "ada@example.com" },
                { email: "grace@example.com" },
                { id: "user-3" },
                { unrelated: true }
              ]
            }
          ]
        })
      )
    ).toEqual(["Plain String", "Ada Lovelace", "grace@example.com", "user-3"]);
  });

  it("returns [] when the value is not an array", () => {
    expect(
      readReleasePackageApprovers(
        pkg({ properties: [{ propertyId: APPROVERS_ID, value: "nope" }] })
      )
    ).toEqual([]);
  });
});
