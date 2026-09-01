import { MAX_LIST_ITEMS } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { projectOutputs } from "./project";
import type { PieceOutputSchema } from "./types";

/** The `get_events` shape: a remapped list, with per-element remapped reads. */
const GET_EVENTS: PieceOutputSchema = {
  fields: [
    { key: "status", label: "Status Code", format: "number" },
    { key: "summary", label: "Calendar Summary", value: "body.summary" },
    {
      key: "items",
      label: "Events",
      value: "body.items",
      listItems: [
        { key: "summary", label: "Title" },
        {
          key: "startDateTime",
          label: "Start",
          value: "start.dateTime",
          format: "datetime"
        },
        {
          key: "organizerEmail",
          label: "Organizer",
          value: "organizer.email",
          format: "email"
        }
      ]
    }
  ]
};

/** What `run()` actually resolves to: the HTTP envelope, not a bare body. */
function response(items: unknown[]) {
  return { status: 200, body: { summary: "Machine shop", items } };
}

const ONE_EVENT = {
  summary: "Standup",
  start: { dateTime: "2026-08-31T09:00:00.000Z" },
  organizer: { email: "sam@example.com" }
};

function items(outputs: Record<string, unknown>) {
  return (outputs.items as { items: unknown[] }).items;
}

describe("projectOutputs", () => {
  it("reads envelope, body and per-element remapped paths", () => {
    const outputs = projectOutputs(GET_EVENTS, response([ONE_EVENT]));

    expect(outputs.status).toEqual({
      kind: "primitive",
      of: "number",
      value: 200
    });
    expect(outputs.summary).toEqual({
      kind: "primitive",
      of: "string",
      value: "Machine shop"
    });

    const [first] = items(outputs) as { fields: Record<string, unknown> }[];
    expect(first?.fields.summary).toEqual({
      kind: "primitive",
      of: "string",
      value: "Standup"
    });
    expect(first?.fields.organizerEmail).toEqual({
      kind: "primitive",
      of: "string",
      value: "sam@example.com"
    });
    expect(first?.fields.startDateTime).toEqual({
      kind: "primitive",
      of: "date",
      value: "2026-08-31T09:00:00.000Z"
    });
  });

  it("counts the returned items", () => {
    expect(
      projectOutputs(GET_EVENTS, response([ONE_EVENT, ONE_EVENT])).count
    ).toEqual({ kind: "primitive", of: "number", value: 2 });
  });

  // The condition node has no "is empty" operator on a list, so this number is the
  // only way an author can branch on "did anything come back?".
  it("counts an empty list as zero", () => {
    expect(projectOutputs(GET_EVENTS, response([])).count).toEqual({
      kind: "primitive",
      of: "number",
      value: 0
    });
  });

  it("counts a single-object response as one", () => {
    const outputs = projectOutputs(
      { fields: [{ key: "id", label: "Id" }] },
      { id: "evt_1" }
    );
    expect(outputs.count).toEqual({
      kind: "primitive",
      of: "number",
      value: 1
    });
  });

  // The schema is the vendor's and nothing validates it — every one of these would
  // be a failed workflow step if projection insisted the response match.
  describe("when the response disagrees with the schema", () => {
    it("nulls a field the vendor omitted", () => {
      const outputs = projectOutputs(
        GET_EVENTS,
        response([{ summary: "Standup" }])
      );
      const [first] = items(outputs) as { fields: Record<string, unknown> }[];
      expect(first?.fields.organizerEmail).toEqual({
        kind: "primitive",
        of: "null",
        value: null
      });
    });

    it("nulls a field of the wrong type instead of passing it through", () => {
      const outputs = projectOutputs(
        GET_EVENTS,
        response([{ ...ONE_EVENT, start: { dateTime: "not a date" } }])
      );
      const [first] = items(outputs) as { fields: Record<string, unknown> }[];
      expect(first?.fields.startDateTime).toEqual({
        kind: "primitive",
        of: "null",
        value: null
      });
    });

    it("treats a missing list as empty rather than throwing", () => {
      const outputs = projectOutputs(GET_EVENTS, { status: 200 });
      expect(items(outputs)).toEqual([]);
      expect(outputs.count).toEqual({
        kind: "primitive",
        of: "number",
        value: 0
      });
    });

    it("treats a non-array where a list was declared as empty", () => {
      const outputs = projectOutputs(GET_EVENTS, response("nope" as never));
      expect(items(outputs)).toEqual([]);
    });

    it("survives a response of an entirely unexpected shape", () => {
      for (const raw of [null, undefined, "text", 42, []]) {
        const outputs = projectOutputs(GET_EVENTS, raw);
        expect(outputs.count).toBeDefined();
        expect(items(outputs)).toEqual([]);
      }
    });
  });

  it("caps a long list at MAX_LIST_ITEMS", () => {
    const many = Array.from({ length: MAX_LIST_ITEMS + 40 }, () => ONE_EVENT);
    const outputs = projectOutputs(GET_EVENTS, response(many));
    expect(items(outputs)).toHaveLength(MAX_LIST_ITEMS);
    // `count` reports what the VENDOR returned, not what survived the cap — an
    // author checking "more than 100?" needs the real number.
    expect(outputs.count).toEqual({
      kind: "primitive",
      of: "number",
      value: MAX_LIST_ITEMS + 40
    });
  });

  it("still reports a count when the action declares no schema", () => {
    expect(projectOutputs(undefined, { anything: true }).count).toBeDefined();
  });

  it("sorts the items chronologically before the cap when asked", () => {
    // Google's events.list groups a recurring series' instances into one block;
    // unsorted, the cap cut whole event types instead of the far future.
    const many = [
      { summary: "Demo Day", start: { dateTime: "2026-09-04T14:00:00Z" } },
      { summary: "Demo Day", start: { dateTime: "2026-09-11T14:00:00Z" } },
      { summary: "Standup", start: { dateTime: "2026-09-07T09:00:00Z" } },
      { summary: "No start", start: {} }
    ];
    const outputs = projectOutputs(GET_EVENTS, response(many), {
      sortItemsBy: "startDateTime"
    });
    const rows = items(outputs);
    expect(
      rows.map(
        (row) => (row as { fields: Record<string, unknown> }).fields.summary
      )
    ).toBeDefined();
    const starts = rows.map(
      (row) =>
        (row as { fields: Record<string, { value: unknown }> }).fields
          .startDateTime?.value ?? null
    );
    expect(starts.slice(0, 3)).toEqual([
      "2026-09-04T14:00:00.000Z",
      "2026-09-07T09:00:00.000Z",
      "2026-09-11T14:00:00.000Z"
    ]);
    // The row with no start sinks to the end rather than leading the list.
    expect(starts[3]).toBeNull();
  });

  it("counts the biggest declared list, not whichever came first in the schema", () => {
    // An empty list declared ahead of the real one reported zero purely on key
    // order — the author's "did anything come back?" answered wrong.
    const schema: PieceOutputSchema = {
      fields: [
        {
          key: "warnings",
          label: "Warnings",
          listItems: [{ key: "m", label: "M" }]
        },
        { key: "items", label: "Events", listItems: [{ key: "m", label: "M" }] }
      ]
    };
    const outputs = projectOutputs(schema, {
      warnings: [],
      items: [{ m: "a" }, { m: "b" }]
    });
    expect(outputs.count).toEqual({
      kind: "primitive",
      of: "number",
      value: 2
    });
  });

  it("counts nothing when the response could not be shaped at all", () => {
    // The catch-all reported 1, so a projection failure read as "one item came
    // back" to every downstream step. A getter that throws is the only way to
    // reach it — `readPath` itself degrades rather than raising.
    const hostile = {
      get body() {
        throw new Error("vendor sent something unreadable");
      }
    };
    const outputs = projectOutputs(GET_EVENTS, hostile);
    expect(outputs.count).toEqual({
      kind: "primitive",
      of: "number",
      value: 0
    });
  });
});
