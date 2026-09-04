import type { ValueType } from "@carbon/workflows";
import { t, WORKFLOW_INTEGRATION_CATALOG } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { fieldsOf, groupOutputs, weightOf } from "./outputPreview";

const EVENT: ValueType = {
  kind: "record",
  fields: { summary: t.string, id: t.string, organizer: t.string }
};

describe("what the output-handle popover shows", () => {
  // "a list of objects" on its own is a dead end: the fields are the whole reason
  // an author opens this popover.
  it("names the fields inside an object and inside a list of objects", () => {
    expect(fieldsOf(EVENT)).toEqual(["summary", "id", "organizer"]);
    expect(fieldsOf(t.list(EVENT as never))).toEqual([
      "summary",
      "id",
      "organizer"
    ]);
  });

  it("has nothing to add for a plain value", () => {
    expect(fieldsOf(t.string)).toEqual([]);
    expect(fieldsOf(t.list(t.string as never))).toEqual([]);
    expect(fieldsOf(t.entity("part"))).toEqual([]);
  });

  // The row cap plus an alphabetical tiebreak would otherwise drop the payload and
  // keep the envelope.
  it("ranks the fetched payload above envelope detail", () => {
    expect(weightOf(t.list(EVENT as never))).toBeLessThan(weightOf(t.string));
    expect(weightOf(EVENT)).toBeLessThan(weightOf(t.string));
    expect(weightOf(t.list(t.string as never))).toBeLessThan(
      weightOf(t.string)
    );
  });

  it("puts a real integration step's items first, not its access role", () => {
    const step =
      WORKFLOW_INTEGRATION_CATALOG[
        "integration.google-calendar.google_calendar_get_events"
      ];
    const outputs = step?.outputs ?? {};
    const ranked = Object.keys(outputs)
      .sort()
      .sort(
        (a, b) => weightOf(outputs[a] as never) - weightOf(outputs[b] as never)
      );
    expect(ranked[0]).toBe("items");
  });

  // The bug this helper exists for: ranking the FLAT list and merging only
  // adjacent rows split one node into two sections with another node between them,
  // so the same heading appeared twice.
  it("gives each node exactly one section", () => {
    const groups = groupOutputs([
      { nodeName: "integration_0", output: "accessRole", type: t.string },
      {
        nodeName: "integration_0",
        output: "items",
        type: t.list(EVENT as never)
      },
      { nodeName: "integration_0", output: "status", type: t.string },
      { nodeName: "trigger_0", output: "record", type: t.entity("part") }
    ]);
    expect(groups.map((g) => g.nodeName)).toEqual([
      "integration_0",
      "trigger_0"
    ]);
    expect(new Set(groups.map((g) => g.nodeName)).size).toBe(groups.length);
  });

  it("keeps the picker's node order, ranking only within a node", () => {
    const groups = groupOutputs([
      { nodeName: "a", output: "text", type: t.string },
      { nodeName: "b", output: "text", type: t.string },
      { nodeName: "a", output: "items", type: t.list(EVENT as never) }
    ]);
    // `a` came first upstream and stays first, even though `b` has no payload.
    expect(groups.map((g) => g.nodeName)).toEqual(["a", "b"]);
    // Inside `a`, the fetched payload outranks the plain field.
    expect(groups[0]?.rows.map((r) => r.output)).toEqual(["items", "text"]);
  });

  it("loses nothing while regrouping", () => {
    const rows = [
      { nodeName: "a", output: "one", type: t.string },
      { nodeName: "b", output: "two", type: t.string },
      { nodeName: "a", output: "three", type: t.number }
    ];
    const total = groupOutputs(rows).reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(rows.length);
  });

  // Everything must still be reachable — ranking reorders, it never drops.
  it("keeps every output", () => {
    const types = [t.string, t.list(EVENT as never), t.number, EVENT];
    const ranked = [...types].sort((a, b) => weightOf(a) - weightOf(b));
    expect(ranked).toHaveLength(types.length);
  });
});
