import type { AvailableVariable } from "@carbon/workflows";
import { createFixtureCatalog, t } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { variableMenuItems, variableTree } from "./variableMenu";

/** What a Google Calendar step now hands downstream. */
const EVENT = {
  kind: "record" as const,
  fields: {
    summary: t.string,
    startDateTime: t.date,
    organizer: { kind: "record" as const, fields: { email: t.string } }
  }
};

const catalog = createFixtureCatalog();

const variable = (
  type: typeof EVENT | ReturnType<typeof t.list>
): AvailableVariable => ({
  nodeId: "gcal",
  nodeName: "gcal",
  nodeType: "integration",
  output: "items",
  type,
  guaranteed: true
});

function leaves(type: Parameters<typeof variable>[0]) {
  return variableMenuItems([variable(type)], catalog).map((item) => item.leaf);
}

describe("record variables in the picker", () => {
  it("offers every field of an object, not just the object", () => {
    const found = leaves(EVENT);
    expect(found).toContain("summary");
    expect(found).toContain("startDateTime");
  });

  // Reaching `organizer.email` is the whole point — one hop short of it is useless.
  it("descends into a nested object", () => {
    expect(leaves(EVENT)).toContain("email");
  });

  // A record's fields are the vendor's own words. Translating them would invent a
  // name for data we do not own, exactly as customer custom fields are untranslated.
  it("labels fields by their own name, with no catalog lookup", () => {
    const items = variableMenuItems([variable(EVENT)], catalog);
    const organizerEmail = items.find((item) => item.leaf === "email");
    expect(organizerEmail?.label).toContain("organizer");
    expect(organizerEmail?.label).toContain("email");
  });

  it("does not offer a field the record does not declare", () => {
    expect(leaves(EVENT)).not.toContain("location");
  });

  // Objects are not text, so a template must never be able to hold one — the field
  // inside it is what the author meant.
  it("hides objects from a text-only picker but keeps their text fields", () => {
    const items = variableMenuItems([variable(EVENT)], catalog, {
      textOnly: true
    });
    const found = items.map((item) => item.leaf);
    expect(found).toContain("summary");
    expect(found).not.toContain("organizer");
  });

  // The tree groups by node first, then by output, so an object's fields sit two
  // levels in — that nesting is what lets the menu reveal one level at a time.
  it("builds a tree whose object nodes can be opened", () => {
    const [node] = variableTree([variable(EVENT)], catalog);
    const output = node?.children?.find((child) => child.label === "items");
    expect(output?.children?.map((child) => child.label)).toEqual([
      "summary",
      "startDateTime",
      "organizer"
    ]);
    const organizer = output?.children?.find(
      (child) => child.label === "organizer"
    );
    expect(organizer?.children?.map((child) => child.label)).toEqual(["email"]);
  });

  // A list of objects is what an integration step actually returns; its ELEMENT
  // fields are reached by a data node, not by dotting through the list itself.
  it("offers a list of objects as one value", () => {
    const found = leaves(t.list(EVENT as never));
    expect(found).toContain("items");
  });
});
