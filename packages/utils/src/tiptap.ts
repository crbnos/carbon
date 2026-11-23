// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@tiptap/react";

/**
 * Recursively extracts unique item mention IDs from a TipTap/ProseMirror JSON document.
 * Handles deeply nested structures including paragraphs, lists, and other block elements.
 */
export function parseMentionsFromDocument(content: JSONContent): string[] {
  const mentionIds = new Set<string>();

  function traverse(node: JSONContent): void {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const child of node) {
        traverse(child);
      }
      return;
    }

    if (node.type === "mention" && node.attrs?.id) {
      mentionIds.add(node.attrs.id);
    }

    if (node.content) {
      traverse(node.content);
    }
  }

  traverse(content);
  return Array.from(mentionIds);
}

/**
 * True when a TipTap/ProseMirror JSON document contains at least one image node
 * (`image` or `updatedImage`). Reference imagery is often the entire content of a
 * step description with no accompanying text, so a plain text/mention check alone
 * (see {@link parseMentionsFromDocument}) reports such a description as empty.
 */
export function documentHasImages(
  content: JSONContent | null | undefined
): boolean {
  if (!content) return false;

  function traverse(node: JSONContent): boolean {
    if (!node) return false;

    if (Array.isArray(node)) {
      return node.some(traverse);
    }

    if (node.type === "image" || node.type === "updatedImage") {
      return true;
    }

    return node.content ? traverse(node.content) : false;
  }

  return traverse(content);
}

/**
 * Convert a Tiptap JSON document to an HTML string.
 * Works server-side without DOM dependencies.
 */
export function tiptapToHTML(doc: JSONContent | null | undefined): string {
  if (!doc || !doc.content) return "";
  return doc.content.map(tiptapNodeToHTML).join("");
}

function tiptapNodeToHTML(node: JSONContent): string {
  switch (node.type) {
    case "paragraph": {
      const inner = node.content
        ? node.content.map(tiptapInlineToHTML).join("")
        : "";
      return `<p>${inner}</p>`;
    }
    case "heading": {
      const level = node.attrs?.level ?? 1;
      const inner = node.content
        ? node.content.map(tiptapInlineToHTML).join("")
        : "";
      return `<h${level}>${inner}</h${level}>`;
    }
    case "bulletList":
      return `<ul>${(node.content ?? []).map(tiptapNodeToHTML).join("")}</ul>`;
    case "orderedList":
      return `<ol>${(node.content ?? []).map(tiptapNodeToHTML).join("")}</ol>`;
    case "listItem":
      return `<li>${(node.content ?? []).map(tiptapNodeToHTML).join("")}</li>`;
    case "blockquote":
      return `<blockquote>${(node.content ?? []).map(tiptapNodeToHTML).join("")}</blockquote>`;
    case "codeBlock": {
      const code = node.content?.[0]?.text ?? "";
      return `<pre><code>${escapeHTMLChars(code)}</code></pre>`;
    }
    case "horizontalRule":
      return "<hr>";
    default:
      return node.content ? node.content.map(tiptapInlineToHTML).join("") : "";
  }
}

function tiptapInlineToHTML(node: JSONContent): string {
  if (node.type === "text") {
    let text = escapeHTMLChars(node.text ?? "");

    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type) {
          case "bold":
            text = `<strong>${text}</strong>`;
            break;
          case "italic":
            text = `<em>${text}</em>`;
            break;
          case "underline":
            text = `<u>${text}</u>`;
            break;
          case "strike":
            text = `<s>${text}</s>`;
            break;
          case "code":
            text = `<code>${text}</code>`;
            break;
          case "link":
            text = `<a href="${escapeHTMLChars(mark.attrs?.href ?? "")}">${text}</a>`;
            break;
        }
      }
    }

    return text;
  }

  if (node.type === "hardBreak") {
    return "<br>";
  }

  return "";
}

export function escapeHTMLChars(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Plain text as a TipTap document: one paragraph per line, a blank line an
 * empty paragraph. Blank text is `null`, so an untyped field stays empty.
 * The shape the rich-text editor saves, and the one migration
 * `service-job-problem-rich-text` builds in SQL — keep the two in step.
 */
export function textToRichTextDoc(
  text: string | null | undefined
): JSONContent | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return {
    type: "doc",
    content: trimmed
      .split(/\r?\n/)
      .map((line) =>
        line
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" }
      )
  };
}

/** Blocks that hold text directly: each is a line, an empty one a blank line. */
const TEXT_BLOCK_TYPES = new Set(["paragraph", "heading", "codeBlock"]);
/** Blocks that hold other blocks: a line break around them, never a blank. */
const CONTAINER_BLOCK_TYPES = new Set([
  "listItem",
  "blockquote",
  "tableRow",
  "tableCell",
  "tableHeader"
]);

/**
 * The text of a TipTap document, for a one-line preview or a search: blocks
 * on their own lines, mentions by their label, images dropped. A string is
 * returned as it is, so a column read before or after a TEXT → JSONB change
 * reads the same. Anything else is "".
 */
export function richTextToPlainText(doc: unknown): string {
  if (typeof doc === "string") return doc.trim();
  if (!doc || typeof doc !== "object") return "";

  const lines: string[] = [];
  let current = "";

  const walk = (node: JSONContent) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "text" && typeof node.text === "string") {
      current += node.text;
      return;
    }
    if (node.type === "hardBreak") {
      lines.push(current);
      current = "";
      return;
    }
    if (node.type === "mention") {
      const label = node.attrs?.label ?? node.attrs?.id;
      if (label) current += String(label);
      return;
    }
    const isTextBlock = TEXT_BLOCK_TYPES.has(node.type ?? "");
    const isBlock = isTextBlock || CONTAINER_BLOCK_TYPES.has(node.type ?? "");
    if (isBlock && current) {
      lines.push(current);
      current = "";
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
    if (isTextBlock || (isBlock && current)) {
      lines.push(current);
      current = "";
    }
  };

  walk(doc as JSONContent);
  if (current) lines.push(current);
  return lines.join("\n").trim();
}
