import { t } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import { readPath, toOutputPaths, toOutputTypes } from "./outputs";
import type { PieceOutputSchema } from "./types";

/** Verbatim from `@activepieces/piece-google-calendar@0.10.3`'s
 * `google_calendar_get_events.outputSchema`. Copied rather than imported so the
 * mapping is pinned against a known shape — a piece upgrade that changes it should
 * fail this test loudly, which is the whole point of the version pin. */
const GET_EVENTS: PieceOutputSchema = {
  fields: [
    { key: "status", label: "Status Code" },
    { key: "summary", label: "Calendar Summary", value: "body.summary" },
    { key: "timeZone", label: "Time Zone", value: "body.timeZone" },
    {
      key: "updated",
      label: "Updated",
      value: "body.updated",
      format: "datetime"
    },
    {
      key: "items",
      label: "Events",
      value: "body.items",
      labelKey: "summary",
      listItems: [
        { key: "summary", label: "Title" },
        { key: "id", label: "Event ID" },
        { key: "htmlLink", label: "Event Link", format: "url" },
        {
          key: "startDateTime",
          label: "Start",
          value: "start.dateTime",
          format: "datetime"
        },
        {
          key: "organizerEmail",
          label: "Organizer Email",
          value: "organizer.email",
          format: "email"
        }
      ]
    }
  ]
};

/** From `create_google_calendar_event` — the `children` (nested object) case. */
const CREATE_EVENT: PieceOutputSchema = {
  fields: [
    { key: "summary", label: "Title" },
    { key: "htmlLink", label: "Event Link", format: "url" },
    {
      key: "start",
      label: "Start",
      children: [
        { key: "dateTime", label: "Start Time", format: "datetime" },
        { key: "timeZone", label: "Time Zone" }
      ]
    }
  ]
};

describe("toOutputTypes", () => {
  it("maps an array field to a list of records", () => {
    const types = toOutputTypes(GET_EVENTS);
    expect(types.items).toEqual(
      t.list({
        kind: "record",
        fields: {
          summary: t.string,
          id: t.string,
          htmlLink: t.string,
          startDateTime: t.date,
          organizerEmail: t.string
        }
      })
    );
  });

  it("maps children to a nested record", () => {
    const types = toOutputTypes(CREATE_EVENT);
    expect(types.start).toEqual(
      t.record({ dateTime: t.date, timeZone: t.string })
    );
  });

  // `format` is a display hint upstream, so this is OUR reading of it. url/email/
  // image/filesize are all text — only these three change the type.
  it("reads only datetime, number and boolean as non-text", () => {
    const types = toOutputTypes({
      fields: [
        { key: "a", label: "A", format: "datetime" },
        { key: "b", label: "B", format: "number" },
        { key: "c", label: "C", format: "boolean" },
        { key: "d", label: "D", format: "url" },
        { key: "e", label: "E", format: "email" },
        { key: "f", label: "F", format: "filesize" },
        { key: "g", label: "G" }
      ]
    });
    expect(types).toEqual({
      a: t.date,
      b: t.number,
      c: t.boolean,
      d: t.string,
      e: t.string,
      f: t.string,
      g: t.string
    });
  });

  // The vendor is declaring the keys cannot be enumerated. Inventing a field name
  // would be exactly the lie this mapper exists to avoid.
  it("omits a dynamicKey field rather than guessing its shape", () => {
    const types = toOutputTypes({
      fields: [
        { key: "row", label: "Row" },
        { key: "values", label: "Values", dynamicKey: true }
      ]
    });
    expect(types).toEqual({ row: t.string });
    expect("values" in types).toBe(false);
  });

  // `list.of` accepts only a scalar, so an array inside an array is unrepresentable.
  // Dropping the inner one keeps the outer list usable instead of refusing the action.
  it("drops an array nested inside an array", () => {
    const types = toOutputTypes({
      fields: [
        {
          key: "events",
          label: "Events",
          listItems: [
            { key: "id", label: "Id" },
            {
              key: "attendees",
              label: "Attendees",
              listItems: [{ key: "email", label: "Email" }]
            }
          ]
        }
      ]
    });
    expect(types.events).toEqual(
      t.list({ kind: "record", fields: { id: t.string } })
    );
  });

  it("omits a container whose every field is unmappable", () => {
    const types = toOutputTypes({
      fields: [
        {
          key: "opaque",
          label: "Opaque",
          children: [{ key: "k", label: "K", dynamicKey: true }]
        }
      ]
    });
    expect(types).toEqual({});
  });
});

describe("toOutputPaths", () => {
  it("records the dotted path for a remapped field and defaults to the key", () => {
    const paths = toOutputPaths(GET_EVENTS);
    expect(paths.summary?.path).toEqual(["body", "summary"]);
    // `status` has no `value`, so it sits at the top of the response envelope.
    expect(paths.status?.path).toEqual(["status"]);
  });

  it("records per-element paths for a list, including nested reads", () => {
    const paths = toOutputPaths(GET_EVENTS);
    expect(paths.items?.path).toEqual(["body", "items"]);
    expect(paths.items?.items).toEqual({
      summary: ["summary"],
      id: ["id"],
      htmlLink: ["htmlLink"],
      startDateTime: ["start", "dateTime"],
      organizerEmail: ["organizer", "email"]
    });
  });

  // The two must agree exactly: a path for a field the type map dropped would put
  // untyped data into a step's output.
  it("emits exactly the keys toOutputTypes emits", () => {
    for (const schema of [GET_EVENTS, CREATE_EVENT]) {
      expect(Object.keys(toOutputPaths(schema)).sort()).toEqual(
        Object.keys(toOutputTypes(schema)).sort()
      );
    }
  });

  it("carries no path for a dropped dynamicKey field", () => {
    const paths = toOutputPaths({
      fields: [
        { key: "row", label: "Row" },
        { key: "values", label: "Values", dynamicKey: true }
      ]
    });
    expect(Object.keys(paths)).toEqual(["row"]);
  });
});

describe("readPath", () => {
  const response = { body: { items: [{ id: "1" }], summary: "Work" } };

  it("reads a nested value", () => {
    expect(readPath(response, ["body", "summary"])).toBe("Work");
  });

  it("returns undefined rather than throwing on a missing branch", () => {
    expect(readPath(response, ["body", "nope", "deeper"])).toBeUndefined();
    expect(readPath(null, ["a"])).toBeUndefined();
    expect(readPath("text", ["a"])).toBeUndefined();
  });

  it("returns the whole response for an empty path", () => {
    expect(readPath(response, [])).toBe(response);
  });
});
