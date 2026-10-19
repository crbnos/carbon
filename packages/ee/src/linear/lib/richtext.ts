// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Utilities for bidirectional conversion between Markdown (Linear description format)
 * and Tiptap JSON (Carbon's rich text format).
 *
 * Linear's API uses plain markdown for the `description` field.
 * Carbon uses Tiptap/ProseMirror JSON for rich text editing.
 */

// Tiptap (ProseMirror) JSON format
export type TiptapNode = {
  type: string;
  attrs?: Record<string, any>;
  content?: TiptapNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, any> }[];
};

export type TiptapDocument = {
  type: "doc";
  content: TiptapNode[];
};

/**
 * Convert Markdown to Tiptap JSON format.
 * This is used when syncing from Linear → Carbon.
 */
export function markdownToTiptap(
  markdown: string | null | undefined
): TiptapDocument {
  if (!markdown || !markdown.trim()) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  const lines = markdown.split("\n");
  const content: TiptapNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      content.push({
        type: "heading",
        attrs: { level },
        content: parseInlineMarkdown(headingMatch[2]!)
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      content.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    // Code block
    if (line.startsWith("```")) {
      const language = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) {
        codeLines.push(lines[i]!);
        i++;
      }
      content.push({
        type: "codeBlock",
        attrs: language ? { language } : undefined,
        content:
          codeLines.length > 0
            ? [{ type: "text", text: codeLines.join("\n") }]
            : undefined
      });
      i++; // Skip closing ```
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i]!.startsWith("> ")) {
        quoteLines.push(lines[i]!.slice(2));
        i++;
      }
      content.push({
        type: "blockquote",
        content: [
          {
            type: "paragraph",
            content: parseInlineMarkdown(quoteLines.join("\n"))
          }
        ]
      });
      continue;
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line)) {
      const listItems: TiptapNode[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i]!)) {
        const itemText = lines[i]!.replace(/^[-*+]\s+/, "");
        listItems.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseInlineMarkdown(itemText)
            }
          ]
        });
        i++;
      }
      content.push({
        type: "bulletList",
        content: listItems
      });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line)) {
      const listItems: TiptapNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        const itemText = lines[i]!.replace(/^\d+\.\s+/, "");
        listItems.push({
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: parseInlineMarkdown(itemText)
            }
          ]
        });
        i++;
      }
      content.push({
        type: "orderedList",
        content: listItems
      });
      continue;
    }

    // Empty line or regular paragraph
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Regular paragraph
    content.push({
      type: "paragraph",
      content: parseInlineMarkdown(line)
    });
    i++;
  }

  if (content.length === 0) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }

  return { type: "doc", content };
}

/**
 * Parse inline markdown (bold, italic, links, code) into Tiptap nodes.
 */
function parseInlineMarkdown(text: string): TiptapNode[] {
  if (!text) return [];

  const nodes: TiptapNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Link: [text](url)
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      nodes.push({
        type: "text",
        text: linkMatch[1],
        marks: [{ type: "link", attrs: { href: linkMatch[2] } }]
      });
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold: **text** or __text__
    const boldMatch = remaining.match(/^(\*\*|__)(.+?)\1/);
    if (boldMatch) {
      nodes.push({
        type: "text",
        text: boldMatch[2],
        marks: [{ type: "bold" }]
      });
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text* or _text_
    const italicMatch = remaining.match(/^(\*|_)([^*_]+)\1/);
    if (italicMatch) {
      nodes.push({
        type: "text",
        text: italicMatch[2],
        marks: [{ type: "italic" }]
      });
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Strikethrough: ~~text~~
    const strikeMatch = remaining.match(/^~~(.+?)~~/);
    if (strikeMatch) {
      nodes.push({
        type: "text",
        text: strikeMatch[1],
        marks: [{ type: "strike" }]
      });
      remaining = remaining.slice(strikeMatch[0].length);
      continue;
    }

    // Inline code: `text`
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      nodes.push({
        type: "text",
        text: codeMatch[1],
        marks: [{ type: "code" }]
      });
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Plain text (find next special character or end)
    const nextSpecial = remaining.search(/[[*_~`]/);
    if (nextSpecial === -1) {
      nodes.push({ type: "text", text: remaining });
      break;
    } else if (nextSpecial === 0) {
      // The special character didn't match a pattern, treat as literal
      nodes.push({ type: "text", text: remaining[0] });
      remaining = remaining.slice(1);
    } else {
      nodes.push({ type: "text", text: remaining.slice(0, nextSpecial) });
      remaining = remaining.slice(nextSpecial);
    }
  }

  return nodes;
}

/**
 * Convert Tiptap JSON to Markdown format.
 * This is used when syncing from Carbon → Linear.
 */
export function tiptapToMarkdown(
  tiptapDoc: TiptapDocument | null | undefined
): string {
  if (!tiptapDoc || !tiptapDoc.content) return "";

  return tiptapDoc.content.map(nodeToMarkdown).join("\n\n");
}

function nodeToMarkdown(node: TiptapNode): string {
  switch (node.type) {
    case "paragraph":
      return node.content ? node.content.map(inlineToMarkdown).join("") : "";

    case "heading": {
      const level = node.attrs?.level ?? 1;
      const prefix = "#".repeat(level);
      const text = node.content
        ? node.content.map(inlineToMarkdown).join("")
        : "";
      return `${prefix} ${text}`;
    }

    case "bulletList":
      return (node.content ?? [])
        .map((item) => {
          const itemContent =
            item.content?.map(nodeToMarkdown).join("\n") ?? "";
          return `- ${itemContent}`;
        })
        .join("\n");

    case "orderedList":
      return (node.content ?? [])
        .map((item, index) => {
          const itemContent =
            item.content?.map(nodeToMarkdown).join("\n") ?? "";
          return `${index + 1}. ${itemContent}`;
        })
        .join("\n");

    case "blockquote":
      return (node.content ?? [])
        .map((child) => `> ${nodeToMarkdown(child)}`)
        .join("\n");

    case "codeBlock": {
      const language = node.attrs?.language ?? "";
      const code = node.content?.[0]?.text ?? "";
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }

    case "horizontalRule":
      return "---";

    case "listItem":
      return node.content?.map(nodeToMarkdown).join("\n") ?? "";

    default:
      return node.content ? node.content.map(inlineToMarkdown).join("") : "";
  }
}

function inlineToMarkdown(node: TiptapNode): string {
  if (node.type === "text") {
    let text = node.text ?? "";

    if (node.marks) {
      for (const mark of node.marks) {
        switch (mark.type) {
          case "bold":
            text = `**${text}**`;
            break;
          case "italic":
            text = `*${text}*`;
            break;
          case "strike":
            text = `~~${text}~~`;
            break;
          case "code":
            text = `\`${text}\``;
            break;
          case "link":
            text = `[${text}](${mark.attrs?.href ?? ""})`;
            break;
        }
      }
    }

    return text;
  }

  if (node.type === "hardBreak") {
    return "\n";
  }

  return "";
}

/**
 * Check if two Tiptap documents have the same content.
 * Used to prevent unnecessary syncs when content hasn't changed.
 */
export function tiptapDocumentsEqual(
  a: TiptapDocument | null | undefined,
  b: TiptapDocument | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Check if a Tiptap document is empty (no meaningful content).
 */
export function isTiptapEmpty(doc: TiptapDocument | null | undefined): boolean {
  if (!doc || !doc.content) return true;

  const hasContent = doc.content.some((node) => {
    if (node.type === "paragraph" && node.content) {
      return node.content.some(
        (inline) => inline.type === "text" && inline.text?.trim()
      );
    }
    return node.content && node.content.length > 0;
  });

  return !hasContent;
}
