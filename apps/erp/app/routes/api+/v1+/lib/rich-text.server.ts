// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Converts the strings an API caller sends for rich-text fields into TipTap
// documents before the service sees them. The manifest marks those fields
// (`publishRichTextFields`, `@carbon/api/rich-text`); this walks the value
// against the same schema, so only a field the caller was told takes Markdown
// is ever converted.
//
// The form validators coerce these fields with zod (`optionalTiptapDoc`), but
// the dispatcher validates against the published JSON Schema and never runs
// zod — without this, a string reached the service as-is and was stored as a
// JSON string scalar, which the editor cannot open and a Kysely copy rejects.

import { acceptsMarkdown } from "@carbon/api/rich-text";
import { markdownToTiptap } from "@carbon/tiptap/markdown";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A rich-text string as a TipTap document. A JSON-encoded document (what the
 * app's forms post) is decoded; anything else is Markdown.
 */
export function toRichTextDocument(value: string): Record<string, unknown> {
  if (value.trimStart().startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (isRecord(parsed) && parsed.type === "doc") return parsed;
    } catch {
      // Not JSON — Markdown that happens to start with a brace.
    }
  }
  return markdownToTiptap(value);
}

/**
 * The value with every Markdown string in a rich-text field replaced by its
 * TipTap document, wherever the object holding the field was sent: through
 * `properties`, each element of a list, and the object members of a union.
 * Never mutates the value it is given.
 */
export function withRichTextDocuments(
  schema: unknown,
  value: unknown
): unknown {
  if (!isRecord(schema)) return value;
  if (typeof value === "string") {
    return acceptsMarkdown(schema) ? toRichTextDocument(value) : value;
  }
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(alternatives)) {
    const kind = Array.isArray(value)
      ? "array"
      : isRecord(value)
        ? "object"
        : "";
    return alternatives
      .filter(
        (alternative) => isRecord(alternative) && alternative.type === kind
      )
      .reduce(
        (current, alternative) => withRichTextDocuments(alternative, current),
        value
      );
  }
  if (Array.isArray(value)) {
    if (!isRecord(schema.items)) return value;
    const items = value.map((element) =>
      withRichTextDocuments(schema.items, element)
    );
    return items.some((item, i) => item !== value[i]) ? items : value;
  }
  if (!isRecord(schema.properties) || !isRecord(value)) return value;
  let out = value;
  for (const [name, property] of Object.entries(schema.properties)) {
    if (!(name in value)) continue;
    const next = withRichTextDocuments(property, value[name]);
    if (next !== value[name]) {
      if (out === value) out = { ...value };
      out[name] = next;
    }
  }
  return out;
}
