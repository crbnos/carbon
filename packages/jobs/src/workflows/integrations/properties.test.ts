import type { RuntimeValue } from "@carbon/workflows";
import { describe, expect, it } from "vitest";
import {
  toPropsValue,
  toValueType,
  UnmappablePropertyError
} from "./properties";
import { getPieceAction } from "./registry";
import type { PieceProperty } from "./types";

const map = (property: PieceProperty, name = "field") =>
  toValueType(
    "google-calendar",
    "create_google_calendar_event",
    name,
    property
  );

describe("toValueType", () => {
  it("maps the text, number, boolean, date and list kinds", () => {
    expect(map({ type: "SHORT_TEXT", required: true }).type).toEqual({
      kind: "primitive",
      of: "string"
    });
    expect(map({ type: "LONG_TEXT" }).type).toEqual({
      kind: "primitive",
      of: "string"
    });
    expect(map({ type: "NUMBER" }).type).toEqual({
      kind: "primitive",
      of: "number"
    });
    expect(map({ type: "CHECKBOX" }).type).toEqual({
      kind: "primitive",
      of: "boolean"
    });
    expect(map({ type: "DATE_TIME" }).type).toEqual({
      kind: "primitive",
      of: "date"
    });
    expect(map({ type: "ARRAY" }).type).toEqual({
      kind: "list",
      of: { kind: "primitive", of: "string" }
    });
  });

  it("carries the real send_notifications choices off the installed piece", async () => {
    const action = await getPieceAction(
      "google-calendar",
      "create_google_calendar_event"
    );
    const mapped = map(action.props.send_notifications!, "send_notifications");
    expect(mapped.choices).toEqual(["all", "externalOnly", "none"]);
    expect(mapped.options).toBeUndefined();
  });

  it("points a vendor-backed dropdown at the property provider", async () => {
    const action = await getPieceAction(
      "google-calendar",
      "create_google_calendar_event"
    );
    const mapped = map(action.props.calendar_id!, "calendar_id");
    expect(mapped.options).toEqual({
      provider: "integration.property",
      params: {
        piece: "google-calendar",
        action: "create_google_calendar_event",
        prop: "calendar_id"
      },
      dependsOn: ["connectionId"]
    });
    expect(mapped.choices).toBeUndefined();
    expect(mapped.required).toBe(true);
  });

  it("maps a static multi-select to a list of text with its choices", async () => {
    const action = await getPieceAction(
      "google-calendar",
      "google_calendar_get_events"
    );
    const mapped = toValueType(
      "google-calendar",
      "google_calendar_get_events",
      "event_types",
      action.props.event_types!
    );
    expect(mapped.type).toEqual({
      kind: "list",
      of: { kind: "primitive", of: "string" }
    });
    expect(mapped.choices?.length).toBeGreaterThan(0);
  });

  it("refuses a kind Carbon cannot represent, naming all three", () => {
    try {
      map({ type: "OBJECT" }, "extra");
      expect.unreachable("OBJECT should not map");
    } catch (error) {
      expect(error).toBeInstanceOf(UnmappablePropertyError);
      const message = (error as Error).message;
      expect(message).toContain("google-calendar");
      expect(message).toContain("create_google_calendar_event");
      expect(message).toContain("extra");
    }
  });
});

describe("toPropsValue", () => {
  it("round-trips the create-event inputs and omits what is absent", async () => {
    const action = await getPieceAction(
      "google-calendar",
      "create_google_calendar_event"
    );
    const inputs: Record<string, RuntimeValue> = {
      calendar_id: { kind: "primitive", of: "string", value: "primary" },
      title: { kind: "primitive", of: "string", value: "Kickoff" },
      start_date_time: {
        kind: "primitive",
        of: "date",
        value: "2026-09-01T10:00:00Z"
      },
      attendees: {
        kind: "list",
        of: { kind: "primitive", of: "string" },
        items: [{ kind: "primitive", of: "string", value: "ops@acme.com" }]
      },
      create_meet_link: { kind: "primitive", of: "boolean", value: true },
      // Not a prop of this action — must not reach the piece.
      connectionId: { kind: "primitive", of: "string", value: "icn_1" },
      // Present but empty: pieces branch on undefined, so this is omitted.
      location: { kind: "primitive", of: "string", value: null }
    };

    expect(toPropsValue(action.props, inputs)).toEqual({
      calendar_id: "primary",
      title: "Kickoff",
      start_date_time: "2026-09-01T10:00:00Z",
      attendees: ["ops@acme.com"],
      create_meet_link: true
    });
  });
});
