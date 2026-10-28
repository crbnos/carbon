// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { t } from "@carbon/ee/workflows";
import { describe, expect, it } from "vitest";
import { describeOutputs, readField } from "./outputs";
import type { PieceOutputSchema } from "./types";

/** Verbatim from `@activepieces/piece-google-calendar@0.10.3`'s
 * `google_calendar_get_events.outputSchema`. Copied rather than imported so the
 * mapping is pinned against a known shape — a piece upgrade that changes it should
 * fail this test loudly, which is the whole point of the version pin. */
/** The type half of `describeOutputs`, which is what the catalog emits. */
function typesOf(schema: PieceOutputSchema) {
  return Object.fromEntries(
    Object.entries(describeOutputs(schema)).map(([name, { type }]) => [
      name,
      type
    ])
  );
}

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

describe("describeOutputs types", () => {
  it("maps an array field to a list of records", () => {
    const types = typesOf(GET_EVENTS);
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
    const types = typesOf(CREATE_EVENT);
    expect(types.start).toEqual(
      t.record({ dateTime: t.date, timeZone: t.string })
    );
  });

  // `format` is a display hint upstream, so this is OUR reading of it. url/email/
  // image/filesize are all text — only these three change the type.
  it("reads only datetime, number and boolean as non-text", () => {
    const types = typesOf({
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
    const types = typesOf({
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
    const types = typesOf({
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
    const types = typesOf({
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

describe("readField", () => {
  const field = (name: string) => {
    const found = describeOutputs(GET_EVENTS)[name];
    if (found === undefined) throw new Error(`no output ${name}`);
    return found.field;
  };
  const response = {
    status: 200,
    body: {
      summary: "Work",
      items: [
        {
          summary: "Standup",
          start: { dateTime: "2026-08-31T09:00:00Z" },
          organizer: { email: "sam@example.com" }
        }
      ]
    }
  };

  it("reads a remapped field, and the key when there is no remap", () => {
    expect(readField(field("summary"), response)).toBe("Work");
    expect(readField(field("status"), response)).toBe(200);
  });

  it("rebuilds each list element keyed as its type names it", () => {
    expect(readField(field("items"), response)).toEqual([
      {
        summary: "Standup",
        id: undefined,
        htmlLink: undefined,
        startDateTime: "2026-08-31T09:00:00Z",
        organizerEmail: "sam@example.com"
      }
    ]);
  });

  // Remaps used to be honoured one level deep only: a `children` field read its
  // fields by key, so a remapped child was always null.
  it("honours a remap at any depth", () => {
    const outputs = describeOutputs({
      fields: [
        {
          key: "event",
          label: "Event",
          value: "body.event",
          children: [
            { key: "startsAt", label: "Starts", value: "start.dateTime" },
            {
              key: "organizer",
              label: "Organizer",
              children: [{ key: "mail", label: "Mail", value: "email" }]
            }
          ]
        }
      ]
    });
    const event = outputs.event;
    if (event === undefined) throw new Error("no event output");
    expect(
      readField(event.field, {
        body: {
          event: {
            start: { dateTime: "2026-08-31T09:00:00Z" },
            organizer: { email: "sam@example.com" }
          }
        }
      })
    ).toEqual({
      startsAt: "2026-08-31T09:00:00Z",
      organizer: { mail: "sam@example.com" }
    });
  });

  it("returns undefined rather than throwing on a missing branch", () => {
    expect(readField(field("summary"), null)).toBeUndefined();
    expect(readField(field("summary"), "text")).toBeUndefined();
    expect(readField(field("summary"), { body: 1 })).toBeUndefined();
  });

  it("carries no output for a dropped dynamicKey field", () => {
    const paths = describeOutputs({
      fields: [
        { key: "row", label: "Row" },
        { key: "values", label: "Values", dynamicKey: true }
      ]
    });
    expect(Object.keys(paths)).toEqual(["row"]);
  });
});
