import type { VariableTextPart } from "@carbon/react/VariableText";
import type { TemplatePart, ValueOrRef } from "@carbon/workflows";
import { decodeTokenId, encodeTokenId, refLabel } from "./tokenId";

/** What the editor shows for a stored value. Labels are resolved here and nowhere else. */
export function toEditorParts(
  value: ValueOrRef | undefined,
  nodeName: (id: string) => string | undefined,
  /** Keyed by position in a template's parts; a bare reference is position 0. */
  partIssues?: Record<number, string>
): VariableTextPart[] {
  const token = (part: TemplatePart, index: number): VariableTextPart => {
    if (part.kind === "text") return { kind: "text", text: part.text };
    return {
      kind: "token",
      id: encodeTokenId(part),
      label: refLabel(
        part,
        part.kind === "ref" ? nodeName(part.nodeId) : undefined
      ),
      invalid: partIssues?.[index] !== undefined
    };
  };

  if (!value) return [];
  if (value.kind === "template") return value.parts.map(token);
  if (value.kind === "ref" || value.kind === "item") return [token(value, 0)];
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

/** A brace left as plain text is not a variable — it would ship literally, which
 * is a wrong result rather than an error. Callers surface it as a field hint. */
export function hasStrayBrace(value: ValueOrRef | undefined): boolean {
  if (!value) return false;
  if (value.kind === "literal") return String(value.value ?? "").includes("{");
  if (value.kind === "template") {
    return value.parts.some((p) => p.kind === "text" && p.text.includes("{"));
  }
  return false;
}
