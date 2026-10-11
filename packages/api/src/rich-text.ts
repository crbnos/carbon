// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Rich-text fields on the Carbon API. A note, a work instruction or a document
// body is stored as a TipTap (ProseMirror) JSON document. An API or MCP caller
// may send that document, or Markdown, which the dispatcher converts.
//
// The manifest generator decides WHICH fields (`publishRichTextFields`) and marks
// each one's string alternative with `format: "markdown"`. The dispatcher
// converts a string only where that mark is (`acceptsMarkdown`), so the
// published schema and the runtime cannot disagree about a field.

/**
 * Property names that hold a TipTap document wherever their schema is a
 * document slot (see `isDocumentSlot`). A name alone is not enough — `notes`
 * and `description` are plain text columns on many tables, published as
 * `{ type: "string" }`, and those are never touched.
 */
export const RICH_TEXT_FIELD_NAMES: ReadonlySet<string> = new Set([
  "notes",
  "internalNotes",
  "externalNotes",
  "content",
  "description",
  "workInstruction",
  "reasonForChange",
  "noteRichText",
  "salesTerms",
  "purchasingTerms"
]);

/** The `format` that marks a rich-text field's Markdown alternative. */
export const MARKDOWN_FORMAT = "markdown";

const RICH_TEXT_DESCRIPTION =
  "Rich text: a TipTap JSON document, or a Markdown string that is converted to one.";

type Schema = Record<string, unknown>;

function isRecord(value: unknown): value is Schema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function typesOf(schema: Schema): string[] {
  const type = schema.type;
  if (typeof type === "string") return [type];
  return Array.isArray(type)
    ? type.filter((t): t is string => typeof t === "string")
    : [];
}

/** A free-form object: no declared `properties`, so a document fits it. */
function isOpenObject(schema: Schema): boolean {
  const types = typesOf(schema);
  return (
    types.includes("object") &&
    types.every((t) => t === "object" || t === "null") &&
    !("properties" in schema)
  );
}

/**
 * Whether a property's schema is where a document goes: the database's `Json`
 * (published as `{}`), an open object (`JSONContent`, `Record<string, unknown>`),
 * or a string-or-open-object union (the form validators' `optionalTiptapDoc`),
 * each optionally nullable. Anything narrower — a plain string, an object with
 * declared properties, the flattened `Json` scalar union — is left alone.
 */
export function isDocumentSlot(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) {
    const members = alternatives.filter(isRecord);
    const nonNull = members.filter(
      (m) => !(typesOf(m).length === 1 && typesOf(m)[0] === "null")
    );
    return (
      nonNull.some(isOpenObject) &&
      nonNull.every(
        (m) =>
          isOpenObject(m) ||
          (typesOf(m).length === 1 &&
            typesOf(m)[0] === "string" &&
            !("enum" in m) &&
            !("format" in m && m.format !== MARKDOWN_FORMAT))
      )
    );
  }
  if (isOpenObject(schema)) return true;
  // `{}` — possibly carrying only a description.
  return Object.keys(schema).every((key) => key === "description");
}

function isNullable(schema: Schema): boolean {
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) {
    return alternatives.some((m) => isRecord(m) && typesOf(m).includes("null"));
  }
  return typesOf(schema).includes("null");
}

/** The schema a rich-text field is published with. */
export function richTextFieldSchema(previous: Schema): Schema {
  const members: Schema[] = [
    { type: "string", format: MARKDOWN_FORMAT },
    { type: "object", additionalProperties: {} }
  ];
  if (isNullable(previous)) members.push({ type: "null" });
  const description =
    typeof previous.description === "string" && previous.description
      ? `${previous.description} ${RICH_TEXT_DESCRIPTION}`
      : RICH_TEXT_DESCRIPTION;
  return { anyOf: members, description };
}

/**
 * Rewrite, in place, every rich-text property in an operation's input schema to
 * `richTextFieldSchema`. Walks `properties`, array `items` and union members.
 * Returns how many fields it rewrote.
 */
export function publishRichTextFields(schema: unknown): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    if (isRecord(node.properties)) {
      for (const [name, property] of Object.entries(node.properties)) {
        if (
          RICH_TEXT_FIELD_NAMES.has(name) &&
          isDocumentSlot(property) &&
          !acceptsMarkdown(property)
        ) {
          node.properties[name] = richTextFieldSchema(property as Schema);
          count++;
        } else {
          visit(property);
        }
      }
    }
    if (isRecord(node.items)) visit(node.items);
    if (Array.isArray(node.anyOf)) visit(node.anyOf);
    if (Array.isArray(node.oneOf)) visit(node.oneOf);
  };
  visit(schema);
  return count;
}

/** Whether a published schema is a rich-text field that takes Markdown. */
export function acceptsMarkdown(schema: unknown): boolean {
  if (!isRecord(schema)) return false;
  const alternatives = schema.anyOf ?? schema.oneOf;
  return (
    Array.isArray(alternatives) &&
    alternatives.some(
      (m) => isRecord(m) && m.type === "string" && m.format === MARKDOWN_FORMAT
    )
  );
}
