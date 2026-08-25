import type { VariableTextPart } from "@carbon/react/VariableText";
import type { TemplatePart, ValueOrRef } from "@carbon/workflows";
import { decodeTokenId, encodeTokenId, namedPath, refLabel } from "./tokenId";

/** What the editor shows for a stored value. Labels are resolved here and nowhere else. */
export function toEditorParts(
  value: ValueOrRef | undefined,
  nodeName: (id: string) => string | undefined,
  /** Keyed by position in a template's parts; a bare reference is position 0. */
  partIssues?: Record<number, string>,
  /** Path segment -> what the customer calls it. A custom field's segment is an id. */
  segmentLabels?: Record<string, string>
): VariableTextPart[] {
  const token = (part: TemplatePart, index: number): VariableTextPart => {
    if (part.kind === "text") return { kind: "text", text: part.text };
    return {
      kind: "token",
      id: encodeTokenId(part),
      label: refLabel(
        part,
        part.kind === "ref" ? nodeName(part.nodeId) : undefined,
        namedPath(part.path, segmentLabels)
      ),
      invalid: partIssues?.[index] !== undefined
    };
  };

  if (!value) return [];
  if (value.kind === "template") return value.parts.map(token);
  if (value.kind === "ref" || value.kind === "item") return [token(value, 0)];
  // A set of rows is edited row by row, never as one stretch of text.
  if (value.kind === "pairs") return [];
  const text = value.value == null ? "" : String(value.value);
  return text ? [{ kind: "text", text }] : [];
}

export type SerializeOptions = {
  /**
   * True where the field type-checks a reference against its declared type.
   * A lone variable is then stored as a bare `ref`, which is what the rest of the
   * builder expects. False on template fields, whose variables may be of any type:
   * `checkInputs` accepts any template for a text input but type-checks a bare
   * ref, so collapsing there would reject values the template form allows.
   */
  collapseSingleRef: boolean;
};

/**
 * Drops the space the picker leaves after a token — only meaningful on blur, since until
 * then it is the gap before the next word. While it survives, a lone variable stays a
 * template and the clause loses the variable's own type. Returns the same array when
 * there is nothing to trim, so callers can skip the write.
 */
export function withoutTrailingSpace(
  parts: VariableTextPart[]
): VariableTextPart[] {
  // Trailing space in a field with no variable in it may well be deliberate.
  if (!parts.some((part) => part.kind === "token")) return parts;
  const last = parts[parts.length - 1];
  if (last?.kind !== "text") return parts;
  const text = last.text.replace(/\s+$/, "");
  if (text === last.text) return parts;
  return text ? [...parts.slice(0, -1), { ...last, text }] : parts.slice(0, -1);
}

/** Plain text stays a literal; mixed content is a template. */
export function fromEditorParts(
  parts: VariableTextPart[],
  { collapseSingleRef }: SerializeOptions
): ValueOrRef | undefined {
  const result: TemplatePart[] = [];
  for (const part of parts) {
    if (part.kind === "text") {
      if (part.text) result.push({ kind: "text", text: part.text });
      continue;
    }
    const ref = decodeTokenId(part.id);
    if (ref) result.push(ref);
  }

  if (result.length === 0) return undefined;
  if (collapseSingleRef && result.length === 1 && result[0].kind !== "text") {
    return result[0];
  }
  if (result.every((p) => p.kind === "text")) {
    return {
      kind: "literal",
      type: { kind: "primitive", of: "string" },
      value: result.map((p) => (p.kind === "text" ? p.text : "")).join("")
    };
  }
  return { kind: "template", parts: result };
}
