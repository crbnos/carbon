import { describe, expect, it } from "vitest";
import {
  buildOptionLookup,
  matchCsvValue,
  toMatchableOption
} from "./enumMatch";

describe("buildOptionLookup / matchCsvValue", () => {
  it("matches by label (case- and whitespace-insensitive)", () => {
    const lookup = buildOptionLookup([{ label: "TW Metals", value: "sup-1" }]);
    expect(matchCsvValue(lookup, "  tw metals ")).toBe("sup-1");
  });

  it("matches by an alias (e.g. readableId) as well as the label", () => {
    const lookup = buildOptionLookup([
      { label: "TW Metals", value: "sup-1", aliases: ["SUP000001"] }
    ]);
    expect(matchCsvValue(lookup, "TW Metals")).toBe("sup-1");
    expect(matchCsvValue(lookup, "sup000001")).toBe("sup-1");
  });

  it("returns undefined when nothing matches", () => {
    const lookup = buildOptionLookup([
      { label: "TW Metals", value: "sup-1", aliases: ["SUP000001"] }
    ]);
    expect(matchCsvValue(lookup, "Unknown Co")).toBeUndefined();
  });

  it("ignores empty / whitespace-only keys", () => {
    const lookup = buildOptionLookup([
      { label: "Acme", value: "sup-2", aliases: ["", "   "] }
    ]);
    expect(matchCsvValue(lookup, "acme")).toBe("sup-2");
    expect(matchCsvValue(lookup, "")).toBeUndefined();
  });

  it("keeps the first option on key collision (deterministic)", () => {
    const lookup = buildOptionLookup([
      { label: "Acme", value: "first" },
      { label: "ACME", value: "second" }
    ]);
    expect(matchCsvValue(lookup, "acme")).toBe("first");
  });

  it("keeps the earlier option when an alias collides with a later option's label", () => {
    const lookup = buildOptionLookup([
      { label: "Alpha", value: "a", aliases: ["shared"] },
      { label: "shared", value: "b" }
    ]);
    expect(matchCsvValue(lookup, "shared")).toBe("a");
  });
});

describe("toMatchableOption", () => {
  it("employees match by email only (name is not a match key)", () => {
    const option = toMatchableOption(
      { id: "e1", name: "Jane Doe", email: "jane@co.com" },
      false
    );
    expect(option).toEqual({ label: "jane@co.com", value: "e1" });
  });

  it("supplier with readable IDs hidden: label is name, readableId is an alias", () => {
    const option = toMatchableOption(
      { id: "s1", name: "TW Metals", readableId: "SUP000001" },
      false
    );
    expect(option).toEqual({
      label: "TW Metals",
      value: "s1",
      aliases: ["SUP000001"]
    });
  });

  it("supplier with readable IDs shown: label is readableId, name is an alias", () => {
    const option = toMatchableOption(
      { id: "s1", name: "TW Metals", readableId: "SUP000001" },
      true
    );
    expect(option).toEqual({
      label: "SUP000001",
      value: "s1",
      aliases: ["TW Metals"]
    });
  });

  it("name-only lookup: label is name, no aliases", () => {
    const option = toMatchableOption({ id: "t1", name: "Raw Material" }, false);
    expect(option).toEqual({ label: "Raw Material", value: "t1", aliases: [] });
  });
});
