import type { JSONContent } from "@carbon/react";
import type { TermsBlock } from "../../template";
import { interpolateContent } from "../../template";

/** True when a tiptap doc has at least one node (i.e. renders something). */
export function hasContent(content?: JSONContent | null): boolean {
  return Boolean(
    content &&
      typeof content === "object" &&
      Array.isArray(content.content) &&
      content.content.length > 0
  );
}

/**
 * The effective terms for a document: the block's own authored content
 * (interpolated with merge fields) when present, otherwise the company-level
 * terms setting passed in as `fallback`. Returns undefined when neither exists.
 */
export function resolveTerms(
  block: TermsBlock,
  fallback: JSONContent | undefined,
  vars: Record<string, string>
): JSONContent | undefined {
  if (hasContent(block.content)) {
    return interpolateContent(block.content as JSONContent, vars);
  }
  return fallback;
}
