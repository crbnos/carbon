// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";

/**
 * Merge fields — `{token}` placeholders that resolve to live document data at
 * render time. Inspired by Bindery's `{ expression }` content model, but kept
 * as inline string tokens so they compose inside rich text and key-value rows
 * the user already authors, with no separate value|expression object. Uses
 * single braces to match the storage-rules condition builder.
 */
export interface MergeField {
  /** Token text without braces, e.g. `invoice.number`. */
  token: string;
  label: string;
  group: string;
  /**
   * A figure: money or a quantity. The text that prints it by default must keep
   * it, so a typed number can never replace what the record says.
   */
  amount?: true;
  /**
   * A value one document cannot change, though its words may leave it out: what
   * identifies the record or a row, what must agree with a figure beside it, and
   * what differs per page of one document.
   */
  fixed?: true;
}

/** Whether one document can print its own text in place of this value. */
export function isEditableValue(field: MergeField): boolean {
  return !field.amount && !field.fixed;
}

export const TOKEN_RE = /\{\s*([\w.]+)\s*\}/g;

/** Replace every `{token}` in a string with its variable value ("" if unknown). */
export function interpolateString(
  text: string,
  vars: Record<string, string>
): string {
  return text.replace(TOKEN_RE, (_match, token: string) =>
    Object.hasOwn(vars, token) ? (vars[token] ?? "") : ""
  );
}

/** True when `text` has merge fields and every one of them resolves empty. */
export function tokensAllEmpty(
  text: string,
  vars: Record<string, string>
): boolean {
  const tokens = [...text.matchAll(TOKEN_RE)];
  return (
    tokens.length > 0 &&
    tokens.every(
      ([, token]) =>
        !(token && Object.hasOwn(vars, token) && vars[token]?.trim())
    )
  );
}

/**
 * True when a node holds text directly (a paragraph or heading), its text has
 * at least one merge field, and every merge field in it resolves empty.
 */
function isEmptiedByMergeFields(
  node: JSONContent,
  vars: Record<string, string>
): boolean {
  const children = node.content ?? [];
  if (!children.some((child) => typeof child.text === "string")) return false;
  let fields = 0;
  for (const child of children) {
    for (const [, token] of (child.text ?? "").matchAll(TOKEN_RE)) {
      fields++;
      if (token && Object.hasOwn(vars, token) && vars[token]?.trim()) {
        return false;
      }
    }
  }
  return fields > 0;
}

/**
 * Deep-clone a tiptap document, replacing `{token}` inside every text node.
 * A paragraph whose merge fields all resolve empty is left out, so
 * "Approved by {order.approvedBy}" prints nothing on an unapproved order
 * rather than "Approved by". A list or other container left with nothing in
 * it is left out too; the document itself is always returned.
 * Pure — never mutates the input (block state stays as the user authored it).
 */
export function interpolateContent(
  content: JSONContent,
  vars: Record<string, string>
): JSONContent {
  const walk = (node: JSONContent): JSONContent | null => {
    const next: JSONContent = { ...node };
    if (typeof next.text === "string") {
      next.text = interpolateString(next.text, vars);
    }
    if (Array.isArray(node.content)) {
      if (isEmptiedByMergeFields(node, vars)) return null;
      next.content = node.content
        .map(walk)
        .filter((child): child is JSONContent => child !== null);
      if (node.content.length > 0 && next.content.length === 0) return null;
    }
    return next;
  };
  return walk(content) ?? { ...content, content: [] };
}

/** Wrap a token for insertion into authored content. */
export function mergeToken(token: string): string {
  return `{${token}}`;
}
