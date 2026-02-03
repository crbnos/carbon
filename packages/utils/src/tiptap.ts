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

export const textToTiptap = (text: string) => {
  const lines = text.split("\n");
  const content = lines.map((line) => ({
    type: "paragraph",
    content: [{ type: "text", text: line }]
  }));
  return { type: "doc", content };
};

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

function escapeHTMLChars(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
