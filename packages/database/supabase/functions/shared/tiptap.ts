import type { Json } from "../lib/types.ts";

// Mirrors `textToTiptap` from @carbon/utils. Kept local because edge functions run on
// Deno and don't resolve the workspace import map.
function textToTiptap(text: string): Json {
  const lines = text.split("\n");
  const content = lines.map((line) =>
    // ProseMirror text nodes cannot be empty, so blank lines become a bare paragraph
    line === ""
      ? { type: "paragraph" }
      : { type: "paragraph", content: [{ type: "text", text: line }] }
  );
  return { type: "doc", content };
}

/**
 * Normalize an operation-step `description` into a valid tiptap doc (jsonb object).
 *
 * The Supabase client returns jsonb scalar strings as JS strings; re-inserting a JS
 * string into a jsonb column makes node-pg send unquoted text and Postgres rejects it.
 * Objects pass through, strings are wrapped into a doc, and null/empty become {}.
 */
export function toTiptapDoc(value: unknown): Json {
  if (value && typeof value === "object") return value as Json;
  if (typeof value === "string" && value.length > 0) return textToTiptap(value);
  return {};
}
