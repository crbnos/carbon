// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Markdown → TipTap JSON, with no DOM. The editor's own markdown support
// (tiptap-markdown) renders to HTML and parses that through the browser's
// DOMParser, so it cannot run on the server. This module tokenizes with
// prosemirror-markdown's CommonMark tokenizer (raw HTML off) and builds the
// document against a schema that uses the editor's node and mark names, so the
// result loads in the editor exactly as if it had been typed there.
//
// A separate entry point (`@carbon/tiptap/markdown`) on purpose: the package
// barrel pulls in React components, and the API dispatcher only needs this.

import { defaultMarkdownParser, MarkdownParser } from "@tiptap/pm/markdown";
import { Schema } from "@tiptap/pm/model";
import type { JSONContent } from "@tiptap/react";

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
    code: {},
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false
    }
  }
});

const parser = new MarkdownParser(
  schema,
  // Read-only reuse of the CommonMark tokenizer (`html: false`): `parse` does
  // not mutate it, and it saves shipping a second markdown-it.
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

/**
 * Convert Markdown to a TipTap document. Plain text is valid Markdown, so a
 * string with no markup becomes paragraphs of text. Raw HTML is not
 * interpreted — it is kept as literal text.
 */
export function markdownToTiptap(markdown: string): JSONContent {
  return parser.parse(markdown).toJSON() as JSONContent;
}
