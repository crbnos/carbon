// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Tiptap documents to and from text, with no DOM, so it runs on the server and
// in the browser. Markdown goes through prosemirror-markdown's CommonMark
// tokenizer (raw HTML off) against a schema that uses the editor's node and
// mark names, so a parsed document loads in the editor as if typed there.

import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer
} from "@tiptap/pm/markdown";
import { Schema } from "@tiptap/pm/model";

/** Tiptap's JSON document shape (structurally `JSONContent` from @tiptap/core). */
export type JSONContent = {
  type?: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
  [key: string]: any;
};

type Format = "markdown" | "text";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    blockquote: { content: "block+", group: "block" },
    horizontalRule: { group: "block" },
    heading: {
      attrs: { level: { default: 1 } },
      content: "inline*",
      group: "block"
    },
    codeBlock: {
      attrs: { language: { default: null } },
      content: "text*",
      marks: "",
      group: "block",
      code: true
    },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: {
      attrs: { start: { default: 1 } },
      content: "listItem+",
      group: "block"
    },
    listItem: { content: "paragraph block*" },
    text: { group: "inline" },
    image: {
      attrs: {
        src: {},
        alt: { default: null },
        title: { default: null }
      },
      inline: true,
      group: "inline"
    },
    hardBreak: { inline: true, group: "inline", selectable: false }
  },
  marks: {
    bold: {},
    italic: {},
    strike: {},
    code: {},
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false
    }
  }
});

const parser = new MarkdownParser(
  schema,
  // Read-only reuse of the CommonMark tokenizer: `parse` does not mutate it.
  defaultMarkdownParser.tokenizer,
  {
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "listItem" },
    bullet_list: { block: "bulletList" },
    ordered_list: {
      block: "orderedList",
      getAttrs: (tok) => ({ start: Number(tok.attrGet("start")) || 1 })
    },
    heading: {
      block: "heading",
      getAttrs: (tok) => ({ level: Number(tok.tag.slice(1)) })
    },
    code_block: { block: "codeBlock", noCloseToken: true },
    fence: {
      block: "codeBlock",
      getAttrs: (tok) => ({ language: tok.info.trim() || null }),
      noCloseToken: true
    },
    hr: { node: "horizontalRule" },
    image: {
      node: "image",
      getAttrs: (tok) => ({
        src: tok.attrGet("src"),
        title: tok.attrGet("title") || null,
        alt: tok.children?.[0]?.content || null
      })
    },
    hardbreak: { node: "hardBreak" },
    // A single newline is kept as a line break rather than collapsed to a
    // space, so plain text with line breaks reads back the way it was written.
    softbreak: { node: "hardBreak" },
    em: { mark: "italic" },
    strong: { mark: "bold" },
    link: {
      mark: "link",
      getAttrs: (tok) => ({
        href: tok.attrGet("href"),
        title: tok.attrGet("title") || null
      })
    },
    code_inline: { mark: "code", noCloseToken: true }
  }
);

const md = defaultMarkdownSerializer;
const serializer = new MarkdownSerializer(
  {
    doc: (state, node) => state.renderContent(node),
    paragraph: md.nodes.paragraph!,
    blockquote: md.nodes.blockquote!,
    horizontalRule: md.nodes.horizontal_rule!,
    heading: md.nodes.heading!,
    codeBlock: (state, node) => {
      state.write(`\`\`\`${node.attrs.language ?? ""}\n`);
      state.text(node.textContent, false);
      state.write("\n```");
      state.closeBlock(node);
    },
    bulletList: (state, node) => state.renderList(node, "  ", () => "- "),
    orderedList: (state, node) => {
      const start = node.attrs.start ?? 1;
      state.renderList(node, "   ", (i) => `${start + i}. `);
    },
    listItem: md.nodes.list_item!,
    image: md.nodes.image!,
    hardBreak: md.nodes.hard_break!,
    text: md.nodes.text!
  },
  {
    bold: md.marks.strong!,
    italic: md.marks.em!,
    code: md.marks.code!,
    link: md.marks.link!,
    strike: {
      open: "~~",
      close: "~~",
      mixable: true,
      expelEnclosingWhitespace: true
    }
  }
);

const emptyDocument = (): JSONContent => ({
  type: "doc",
  content: [{ type: "paragraph" }]
});

/** Plain text as typed: one paragraph per line, `**text**` bold. */
function textDocument(text: string): JSONContent {
  const content = text.split(/\r\n|\r|\n/).map((line) =>
    // ProseMirror text nodes cannot be empty, so blank lines become a bare paragraph
    line === ""
      ? { type: "paragraph" }
      : {
          type: "paragraph",
          content: line
            .split(/(\*\*.+?\*\*)/)
            .filter(Boolean)
            .map((part) =>
              part.length > 4 && part.startsWith("**") && part.endsWith("**")
                ? {
                    type: "text",
                    text: part.slice(2, -2),
                    marks: [{ type: "bold" }]
                  }
                : { type: "text", text: part }
            )
        }
  );
  return { type: "doc", content };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A Tiptap document: an object whose `type` is `doc`. */
export const isTiptapDocument = (value: unknown): value is JSONContent =>
  isRecord(value) && value.type === "doc";

function readDocument(value: unknown, format: Format): JSONContent {
  if (isTiptapDocument(value)) return value;
  // Any other object is not a document. `{}` is how the editor stores an
  // empty one; stringifying it would read as "[object Object]".
  if (isRecord(value) || value === null || value === undefined) {
    return emptyDocument();
  }
  const text = String(value);
  // A document encoded as text (a form post, or a JSON string scalar stored by
  // an older API), or `{}`. Anything else that parses (`123`, `"quoted"`,
  // `{"a":1}`) is text.
  try {
    const parsed: unknown = JSON.parse(text);
    if (isTiptapDocument(parsed)) return parsed;
    if (isRecord(parsed) && Object.keys(parsed).length === 0) {
      return emptyDocument();
    }
  } catch {
    // Not JSON: read as text below.
  }
  if (!text.trim()) return emptyDocument();
  return format === "text"
    ? textDocument(text)
    : (parser.parse(text).toJSON() as JSONContent);
}

/** Plain text: blocks become lines; marks and non-text inline nodes drop. */
function documentText(doc: JSONContent): string {
  const inline = (node: JSONContent): string => {
    if (node.type === "text") return node.text ?? "";
    if (node.type === "hardBreak") return "\n";
    return (node.content ?? []).map(inline).join("");
  };
  const block = (node: JSONContent): string[] => {
    switch (node.type) {
      case "bulletList":
      case "orderedList":
      case "blockquote":
      case "listItem":
        return (node.content ?? []).flatMap(block);
      case "horizontalRule":
        return [];
      default:
        return [(node.content ?? []).map(inline).join("")];
    }
  };
  return (doc.content ?? [])
    .flatMap(block)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Reduce an editor document to the nodes and marks Markdown can say. A mention
 * becomes `@label`, an unknown wrapper (task list, table) keeps its children,
 * anything else unknown drops.
 */
function toMarkdownSchema(node: JSONContent): JSONContent[] {
  const type = node.type ?? "";
  if (type === "text") {
    if (!node.text) return [];
    const marks = node.marks?.filter((mark) => schema.marks[mark.type]);
    return [{ ...node, marks }];
  }
  if (type === "mention") {
    const label = node.attrs?.label ?? node.attrs?.id;
    return label ? [{ type: "text", text: `@${label}` }] : [];
  }
  if ((type === "image" || type === "updatedImage") && node.attrs?.src) {
    return [{ type: "image", attrs: node.attrs }];
  }
  const content = (node.content ?? []).flatMap(toMarkdownSchema);
  if (schema.nodes[type] && type !== "image") {
    return [{ type, attrs: node.attrs, content }];
  }
  return content;
}

function documentMarkdown(doc: JSONContent): string {
  const [normalized] = toMarkdownSchema({ ...doc, type: "doc" });
  if (!normalized?.content?.length) return "";
  return serializer
    .serialize(schema.nodeFromJSON(normalized), { tightLists: true })
    .trim();
}

/**
 * Rich text in one place: give it a stored document, a document encoded as
 * text, or text, and ask for the form you need.
 *
 * `format: "text"` reads text as typed (a field edited in a plain textarea and
 * read back with `toString`); the default reads it as Markdown.
 */
export function TiptapText(
  value: unknown,
  { format = "markdown" }: { format?: Format } = {}
) {
  const doc = readDocument(value, format);
  return {
    toDocument: () => doc,
    toString: () => documentText(doc),
    toMarkdown: () => documentMarkdown(doc)
  };
}
