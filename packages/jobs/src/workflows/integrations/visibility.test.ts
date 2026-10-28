// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { toPropsValue } from "./properties";
import type { PieceProperty } from "./types";
import { assertHiddenPropIsSatisfied, visibilityOf } from "./visibility";

const prop = (over: Partial<PieceProperty> = {}): PieceProperty => ({
  type: "SHORT_TEXT",
  required: false,
  ...over
});

describe("visibilityOf", () => {
  it("shows an ordinary optional prop", () => {
    expect(visibilityOf(prop(), undefined)).toEqual({ show: true });
  });

  it("shows a required prop the vendor gave no default", () => {
    expect(visibilityOf(prop({ required: true }), undefined)).toEqual({
      show: true
    });
  });

  // Nothing for a person to decide — but the value still has to be SENT. A piece's
  // `defaultValue` pre-fills its own form and is never applied at run time, so
  // hiding this prop without carrying the default handed the vendor `undefined`.
  it("hides a required prop that already has a default, and sends that default", () => {
    expect(
      visibilityOf(prop({ required: true, defaultValue: "all" }), undefined)
    ).toEqual({ show: false, value: "all" });
  });

  // An OPTIONAL prop with a default is still a real choice — the author may want
  // the non-default. Only the required-and-defaulted case is pure ceremony.
  it("still shows an optional prop that has a default", () => {
    expect(visibilityOf(prop({ defaultValue: "all" }), undefined)).toEqual({
      show: true
    });
  });

  it("hides a dropdown with only one possible answer, and sends that answer", () => {
    const single = prop({
      type: "STATIC_DROPDOWN",
      options: { options: [{ label: "Only", value: "only" }] }
    });
    // Hiding it without the value made a REQUIRED prop of this shape fail catalog
    // generation outright, for a case the code already knows the answer to.
    expect(visibilityOf(single, undefined)).toEqual({
      show: false,
      value: "only"
    });

    const two = prop({
      type: "STATIC_DROPDOWN",
      options: {
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" }
        ]
      }
    });
    expect(visibilityOf(two, undefined)).toEqual({ show: true });
  });

  it("carries an override's pinned value", () => {
    expect(
      visibilityOf(prop({ type: "CHECKBOX" }), { hidden: true, value: true })
    ).toEqual({ show: false, value: true });
  });

  // An override that does not say `hidden` must not accidentally hide anything.
  it("ignores an override that hides nothing", () => {
    expect(visibilityOf(prop(), { value: true })).toEqual({ show: true });
  });
});

describe("assertHiddenPropIsSatisfied", () => {
  const ok =
    (
      property: PieceProperty,
      visibility: Parameters<typeof assertHiddenPropIsSatisfied>[4]
    ) =>
    () =>
      assertHiddenPropIsSatisfied("p", "a", "n", property, visibility);

  // The failure this guard exists for: hide a required field, send nothing for it,
  // and the vendor call goes out incomplete — failing in front of a customer.
  it("refuses a required prop hidden with nothing to send", () => {
    expect(ok(prop({ required: true }), { show: false })).toThrow(
      /required but hidden/
    );
  });

  it("accepts a required prop satisfied by a pinned value", () => {
    expect(
      ok(prop({ required: true }), { show: false, value: true })
    ).not.toThrow();
  });

  // A default is NOT self-applying, so it satisfies this only once it is carried
  // as the value to send. Hidden, required, and nothing to send is still refused
  // even when the vendor declared a default — that combination is what reached a
  // customer as an unreadable crash inside the piece.
  it("accepts a required prop whose default is carried as the value", () => {
    expect(
      ok(prop({ required: true, defaultValue: "all" }), {
        show: false,
        value: "all"
      })
    ).not.toThrow();
  });

  it("refuses a required prop hidden with nothing to send, default or not", () => {
    expect(
      ok(prop({ required: true, defaultValue: "all" }), { show: false })
    ).toThrow(/required but hidden/);
  });

  it("accepts a hidden optional prop with nothing to send", () => {
    expect(ok(prop(), { show: false })).not.toThrow();
  });

  it("never complains about a visible prop", () => {
    expect(ok(prop({ required: true }), { show: true })).not.toThrow();
  });
});

describe("toPropsValue pins", () => {
  const bool = (value: boolean) => ({
    kind: "primitive" as const,
    of: "boolean" as const,
    value
  });

  it("reads the real allowlist entry", () => {
    expect(
      toPropsValue(
        "google-calendar",
        "google_calendar_get_events",
        { singleEvents: prop({ type: "CHECKBOX" }) },
        {}
      )
    ).toEqual({ singleEvents: true });
  });

  it("pins gmail's draft flag off even though the prop is omitted from the form", () => {
    expect(
      toPropsValue(
        "gmail",
        "gmail_send_email",
        {
          draft: prop({ type: "CHECKBOX", required: true, defaultValue: true })
        },
        {}
      )
    ).toEqual({ draft: false });
  });

  it("is empty for an action or piece with no overrides", () => {
    const props = { search: prop() };
    expect(
      toPropsValue("google-calendar", "create_google_calendar_event", props, {})
    ).toEqual({});
    expect(toPropsValue("nope", "nope", props, {})).toEqual({});
  });

  /**
   * The exact shape that failed a real run. Google Calendar's get-events declares
   * `event_types` required WITH a default, so we hid it — and sent nothing. The
   * piece does `event_types.length` straight off `propsValue` and died with
   * "Cannot read properties of undefined (reading 'length')", naming a field the
   * author had never seen.
   */
  it("sends a hidden required prop's vendor default, not undefined", () => {
    const props = {
      event_types: prop({
        type: "STATIC_MULTI_SELECT_DROPDOWN",
        required: true,
        defaultValue: ["default", "focusTime", "outOfOffice"]
      }),
      singleEvents: prop({ type: "CHECKBOX" }),
      search: prop()
    };

    const sent = toPropsValue(
      "google-calendar",
      "google_calendar_get_events",
      props,
      {}
    );

    expect(sent.event_types).toEqual(["default", "focusTime", "outOfOffice"]);
    // The allowlist's own pin still applies alongside it.
    expect(sent.singleEvents).toBe(true);
    // A visible prop is the author's to fill and must never be pinned.
    expect("search" in sent).toBe(false);
  });

  it("never pins an optional prop's default — that is still the author's choice", () => {
    const props = { search: prop({ defaultValue: "everything" }) };
    expect(
      toPropsValue("google-calendar", "create_google_calendar_event", props, {})
    ).toEqual({});
  });

  // The Advanced section exists so an author CAN override us; a pin that beat a
  // deliberate choice would make that section a lie.
  it("lets a node value win over the pin", () => {
    expect(
      toPropsValue(
        "google-calendar",
        "google_calendar_get_events",
        { singleEvents: prop({ type: "CHECKBOX" }) },
        { singleEvents: bool(false) }
      )
    ).toEqual({ singleEvents: false });
  });

  it("falls back to the pin when the node's value resolved to nothing", () => {
    expect(
      toPropsValue(
        "google-calendar",
        "google_calendar_get_events",
        { singleEvents: prop({ type: "CHECKBOX" }) },
        { singleEvents: { kind: "primitive", of: "null", value: null } }
      )
    ).toEqual({ singleEvents: true });
  });

  it("never invents a prop the action does not declare", () => {
    expect(
      toPropsValue(
        "google-calendar",
        "google_calendar_get_events",
        { search: prop() },
        {}
      )
    ).toEqual({});
  });

  it("falls back to the pin when a multi-select was emptied", () => {
    // Deselecting every option is "nothing chosen", not "send []" — a required
    // list prop read unguarded by the piece is exactly what crashed the vendor.
    const props = {
      eventTypes: prop({
        type: "STATIC_MULTI_SELECT_DROPDOWN",
        required: true,
        defaultValue: ["default"]
      })
    };
    const inputs = {
      eventTypes: {
        kind: "list" as const,
        of: { kind: "primitive" as const, of: "string" as const },
        items: []
      }
    };
    expect(toPropsValue("nope", "nope", props, inputs)).toEqual({
      eventTypes: ["default"]
    });
  });
});

describe("omit", () => {
  it("omits a prop the allowlist says to, carrying any pin", () => {
    expect(visibilityOf(prop(), { omit: true })).toEqual({
      show: false,
      omit: true
    });
    expect(
      visibilityOf(
        prop({ type: "CHECKBOX", required: true, defaultValue: true }),
        { omit: true, value: true }
      )
    ).toEqual({ show: false, omit: true, value: true });
  });

  // Activepieces `Property.MarkDown` is a paragraph of help text, not a field.
  it("omits a MARKDOWN prop with no override at all", () => {
    expect(visibilityOf(prop({ type: "MARKDOWN" }), undefined)).toEqual({
      show: false,
      omit: true
    });
  });

  it("still refuses a required prop omitted with nothing to send", () => {
    const required = prop({ type: "CHECKBOX", required: true });
    expect(() =>
      assertHiddenPropIsSatisfied("p", "a", "sendAsBot", required, {
        show: false,
        omit: true
      })
    ).toThrow("omitted with no value");
    expect(() =>
      assertHiddenPropIsSatisfied("p", "a", "sendAsBot", required, {
        show: false,
        omit: true,
        value: true
      })
    ).not.toThrow();
  });

  it("pins an omitted prop's value from the real slack row", () => {
    const sendAsBot = prop({
      type: "CHECKBOX",
      required: true,
      defaultValue: true
    });
    expect(
      toPropsValue("slack", "send_channel_message", { sendAsBot }, {})
    ).toEqual({ sendAsBot: true });
    expect(
      toPropsValue(
        "slack",
        "send_direct_message",
        { sendAsBot: prop({ type: "CHECKBOX" }) },
        {}
      )
    ).toEqual({});
  });

  // The omit exists to make the user-token path unreachable; a stale node value
  // for `sendAsBot` must not reopen it.
  it("drops a stale node value for an omitted or MARKDOWN prop but still sends the pin", () => {
    const props = {
      info: prop({ type: "MARKDOWN" }),
      channel: prop({ type: "DROPDOWN", required: true }),
      sendAsBot: prop({ type: "CHECKBOX", required: true, defaultValue: true }),
      blocks: prop({ type: "JSON" }),
      text: prop({ type: "LONG_TEXT" })
    };
    const text = (value: string) => ({
      kind: "primitive" as const,
      of: "string" as const,
      value
    });
    expect(
      toPropsValue("slack", "send_channel_message", props, {
        info: text("help"),
        channel: text("C1"),
        sendAsBot: { kind: "primitive", of: "boolean", value: false },
        blocks: text("[]"),
        text: text("hi")
      })
    ).toEqual({ channel: "C1", sendAsBot: true, text: "hi" });
  });
});
