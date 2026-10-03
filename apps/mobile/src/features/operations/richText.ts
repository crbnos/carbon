// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Flatten a Tiptap document to plain text.
 *
 * A work instruction's `description` is rich text, authored in the ERP with
 * headings, lists, bold and links. There is no Tiptap renderer in this bundle
 * — `@carbon/tiptap` is a web package built on ProseMirror's DOM view — so the
 * choice is plain text or nothing, and nothing is not a choice: these are the
 * instructions for the part in the operator's hands. A step whose text
 * silently rendered blank would be worse than one shown without its bold.
 *
 * So this keeps the words and the BLOCK structure (each paragraph, heading and
 * list item on its own line, list items marked), and drops only the inline
 * formatting. It is deliberately tolerant: the input is `unknown` off the wire
 * and a shape this build does not recognise returns what text it can find
 * rather than throwing inside a list render.
 */

type Node = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
};

/** Node types that end a line. Everything else is inline. */
const BLOCK_TYPES = new Set([
  "paragraph",
  "heading",
  "listItem",
  "blockquote",
  "codeBlock",
  "tableRow"
]);

const LIST_ITEM_PREFIX = "• ";

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null;
}

/**
 * Accumulates lines with ONE line open at a time.
 *
 * The open line is what makes a bullet work. A `listItem` opens a line with
 * the bullet on it, then its child `paragraph` arrives — and a paragraph must
 * NOT start a new line here, or the bullet is left behind on an empty one and
 * the text lands unmarked below it. So a block only closes the open line when
 * that line already has words on it.
 */
class Lines {
  private readonly done: string[] = [];
  private open = "";

  /** Words, so far, ignoring a prefix that is still waiting for them. */
  private get hasWords() {
    return this.open.replace(LIST_ITEM_PREFIX, "").trim().length > 0;
  }

  startBlock(prefix = "") {
    if (this.hasWords) {
      this.done.push(this.open.trimEnd());
      this.open = "";
    }
    if (prefix && !this.open) this.open = prefix;
  }

  append(text: string) {
    this.open += text;
  }

  /** A standalone line that interrupts whatever is open (a rule). */
  push(line: string) {
    this.startBlock();
    this.done.push(line);
  }

  toString() {
    const all = this.hasWords ? [...this.done, this.open.trimEnd()] : this.done;
    return all
      .filter((line) => line.length > 0)
      .join("\n")
      .trim();
  }
}

/** Walks a node depth-first, writing into `lines`. */
function walk(value: unknown, lines: Lines, depth: number): void {
  // Guards a hand-edited or round-tripped document rather than recursing
  // forever: `description` is Json, so it can be any shape at all, and a stack
  // overflow here would take down the whole Instructions tab.
  if (depth > 32) return;

  if (Array.isArray(value)) {
    for (const child of value) walk(child, lines, depth + 1);
    return;
  }
  if (!isNode(value)) return;

  if (typeof value.text === "string") {
    lines.append(value.text);
    return;
  }

  const type = typeof value.type === "string" ? value.type : "";
  if (type === "horizontalRule") {
    lines.push("\u2014");
    return;
  }
  if (BLOCK_TYPES.has(type)) {
    lines.startBlock(type === "listItem" ? LIST_ITEM_PREFIX : "");
  }

  if (value.content !== undefined) walk(value.content, lines, depth + 1);
}

export function richTextToPlain(doc: unknown): string {
  if (doc === null || doc === undefined) return "";
  // Some rows carry a plain string where others carry a document.
  if (typeof doc === "string") return doc.trim();

  const lines = new Lines();
  walk(doc, lines, 0);
  return lines.toString();
}

/** True when there is no text to show, so a caller can say so instead. */
export function isRichTextEmpty(doc: unknown): boolean {
  return richTextToPlain(doc).length === 0;
}
