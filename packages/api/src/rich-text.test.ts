// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  acceptsMarkdown,
  isDocumentSlot,
  publishRichTextFields,
  richTextFieldSchema
} from "./rich-text";
import { jsonSchemaInput } from "./schema";

describe("isDocumentSlot", () => {
  it.each([
    ["Json", {}],
    ["Json with a description", { description: "The notes" }],
    ["JSONContent", { type: "object", additionalProperties: {} }],
    ["nullable object", { type: ["object", "null"] }],
    [
      "optionalTiptapDoc",
      {
        anyOf: [
          { type: "string" },
          { type: "object", propertyNames: { type: "string" } }
        ]
      }
    ]
  ])("accepts %s", (_, schema) => {
    expect(isDocumentSlot(schema)).toBe(true);
  });

  it.each([
    ["a text column", { type: "string" }],
    ["a nullable text column", { type: ["string", "null"] }],
    [
      "an object with declared fields",
      { type: "object", properties: { id: { type: "string" } } }
    ],
    [
      "the flattened Json scalar union",
      {
        anyOf: [
          { type: "string" },
          { type: "number" },
          { type: "boolean" },
          { type: "object" }
        ]
      }
    ],
    [
      "an enum",
      { anyOf: [{ type: "string", enum: ["A"] }, { type: "object" }] }
    ]
  ])("rejects %s", (_, schema) => {
    expect(isDocumentSlot(schema)).toBe(false);
  });
});

describe("publishRichTextFields", () => {
  it("rewrites only rich-text names whose schema is a document slot", () => {
    const schema = {
      type: "object",
      properties: {
        notes: {},
        description: { type: "string" },
        content: { type: ["object", "null"] },
        payload: {},
        lines: {
          type: "array",
          items: {
            type: "object",
            properties: { internalNotes: { type: "object" } }
          }
        }
      }
    };
    expect(publishRichTextFields(schema)).toBe(3);
    expect(acceptsMarkdown(schema.properties.notes)).toBe(true);
    expect(acceptsMarkdown(schema.properties.content)).toBe(true);
    expect(schema.properties.content).toMatchObject({
      anyOf: [{ type: "string" }, { type: "object" }, { type: "null" }]
    });
    expect(
      acceptsMarkdown(schema.properties.lines.items.properties.internalNotes)
    ).toBe(true);
    expect(schema.properties.description).toEqual({ type: "string" });
    expect(schema.properties.payload).toEqual({});
  });

  it("is idempotent", () => {
    const schema = { type: "object", properties: { notes: {} } };
    publishRichTextFields(schema);
    const once = structuredClone(schema);
    expect(publishRichTextFields(schema)).toBe(0);
    expect(schema).toEqual(once);
  });
});

describe("richTextFieldSchema as API input", () => {
  const input = jsonSchemaInput({
    type: "object",
    properties: { notes: richTextFieldSchema({ type: ["object", "null"] }) },
    required: ["notes"]
  });
  const validate = (value: unknown) =>
    input["~standard"].validate({ notes: value });

  it("accepts Markdown, a document and null", () => {
    expect(validate("**done**")).toEqual({ value: { notes: "**done**" } });
    const doc = { type: "doc", content: [] };
    expect(validate(doc)).toEqual({ value: { notes: doc } });
    expect(validate(null)).toEqual({ value: { notes: null } });
  });

  it("still rejects a number", () => {
    expect("issues" in validate(5)).toBe(true);
  });
});
