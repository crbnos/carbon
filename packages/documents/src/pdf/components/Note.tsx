// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { JSONContent } from "@carbon/react";
import { Link, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { DocumentTheme } from "../../template";
import { useDocFontFamily, useDocTheme } from "../blocks/tw";
import { fontHasItalic } from "../fonts";

/**
 * Budget for a list item that is kept whole on one page, in characters of 9pt
 * text. react-pdf cannot split a `wrap={false}` node, and a node taller than
 * the page overflows and loses its text, so a larger item can break across
 * pages. A 120pt column on an A4 page holds about 1,000 characters of Courier,
 * the widest template font, and 1,200 to 1,500 of the others.
 */
const KEEP_TOGETHER_BUDGET = 800;

/**
 * A paragraph, heading or line break starts a new line however little text it
 * holds, so each one costs a full line. That over-counts in a narrow column,
 * which only makes an item break sooner.
 */
const CHARS_PER_LINE = 100;

/** Whether a list or task item is small enough to keep whole on one page. */
export function keepListItemTogether(item: JSONContent): boolean {
  const size = (node: JSONContent): number =>
    (node.content ?? []).reduce(
      (total, child) => total + size(child),
      (node.text?.length ?? 0) +
        (node.type === "paragraph" ||
        node.type === "heading" ||
        node.type === "hardBreak"
          ? CHARS_PER_LINE
          : 0)
    );
  return size(item) <= KEEP_TOGETHER_BUDGET;
}

/**
 * How a text's marks print. Italic only with an italic face: react-pdf fails the
 * whole document without one.
 */
export function markStyle(
  marks: JSONContent["marks"],
  allowItalic: boolean
): {
  fontWeight?: "bold";
  fontStyle?: "italic";
  textDecoration?: "underline" | "line-through" | "underline line-through";
} | null {
  const has = (type: string) => marks?.some((mark) => mark.type === type);
  const italic = allowItalic && has("italic");
  const textDecoration = has("underline")
    ? has("strike")
      ? "underline line-through"
      : "underline"
    : has("strike")
      ? "line-through"
      : undefined;
  if (!has("bold") && !italic && !textDecoration) return null;
  return {
    ...(has("bold") ? { fontWeight: "bold" as const } : {}),
    ...(italic ? { fontStyle: "italic" as const } : {}),
    ...(textDecoration ? { textDecoration } : {})
  };
}

/**
 * Build a tiptap → react-pdf renderer bound to a theme, so the title/headings
 * pick up `theme.heading` and body text inherits `theme.text` (set on the
 * wrapper). Closure over `theme` keeps the recursive calls clean.
 */
export function makeConvert(theme: DocumentTheme, allowItalic: boolean) {
  const convert = (
    node: JSONContent,
    args?: {
      index?: number;
      parentNodeType?: string;
      title?: string;
      leadsBreakingListItem?: boolean;
    }
  ): ReactNode => {
    switch (node.type) {
      case "doc":
        return (
          <View style={{ fontSize: 9, width: "100%" }}>
            {args?.title ? (
              <View style={[styles.thead, { color: theme.heading }]}>
                <Text>{args.title}</Text>
              </View>
            ) : null}
            {node?.content?.map((child) => convert(child))}
          </View>
        );

      case "heading":
        return (
          <Text
            key={`heading-${node.attrs?.level}`}
            style={{
              fontSize: 13,
              fontWeight: "bold",
              marginBottom: 10,
              width: "100%",
              color: theme.heading
            }}
          >
            {node?.content?.map((child) => convert(child))}
          </Text>
        );

      case "paragraph":
        return (
          <Text
            key="paragraph"
            // A list item too large to keep whole breaks across pages. Let its
            // first paragraph split after one line, so the indicator keeps
            // company. Both are needed: with the default widows of 2, a
            // two-line paragraph still moves whole.
            orphans={args?.leadsBreakingListItem ? 1 : undefined}
            widows={args?.leadsBreakingListItem ? 1 : undefined}
            style={{ marginBottom: 10, fontSize: 9, width: "100%" }}
          >
            {node.content?.map((child) => convert(child)) || ""}
          </Text>
        );

      case "bulletList":
        return (
          <View key="bulletList" style={{ marginLeft: 20 }}>
            {node?.content?.map((child, index) =>
              convert(child, { index, parentNodeType: "bulletList" })
            )}
          </View>
        );

      case "orderedList":
        return (
          <View key="orderedList" style={{ marginLeft: 20 }}>
            {node?.content?.map((child, index) =>
              convert(child, { index, parentNodeType: "orderedList" })
            )}
          </View>
        );

      case "listItem": {
        const indicator =
          args?.parentNodeType === "orderedList"
            ? `${(args?.index ?? 0) + 1}.`
            : "•";
        return listRow(
          node,
          `listItem-${args?.index}`,
          <Text style={{ marginRight: 5, fontSize: 9 }}> {indicator} </Text>
        );
      }

      case "taskList":
        return (
          <View key="taskList" style={{ marginLeft: 20 }}>
            {node?.content?.map((child, index) => convert(child, { index }))}
          </View>
        );

      case "taskItem":
        return listRow(
          node,
          `taskItem-${args?.index}`,
          // A drawn box: the bundled fonts have no ballot-box glyphs.
          <View
            style={{
              width: 7,
              height: 7,
              marginTop: 2,
              marginRight: 5,
              borderWidth: 0.75,
              borderColor: theme.text,
              backgroundColor: node.attrs?.checked ? theme.text : undefined
            }}
          />
        );

      case "text": {
        const style = markStyle(node.marks, allowItalic);
        const text = style ? <Text style={style}>{node.text}</Text> : node.text;
        const href = node.marks?.find((mark) => mark.type === "link")?.attrs
          ?.href;
        return typeof href === "string" && href ? (
          <Link
            src={href}
            style={{ color: theme.accent, textDecoration: "underline" }}
          >
            {text}
          </Link>
        ) : (
          text
        );
      }

      // Shift+Enter in the editor: a new line inside the same paragraph.
      case "hardBreak":
        return "\n";

      default:
        return null;
    }
  };

  // An indicator and its text. A small item is kept whole, so the bullet or
  // number never stays at the bottom of a page without its text.
  const listRow = (node: JSONContent, key: string, indicator: ReactNode) => {
    const keepTogether = keepListItemTogether(node);
    return (
      <View
        key={key}
        wrap={!keepTogether}
        style={{ flexDirection: "row", marginBottom: 5 }}
      >
        {indicator}
        <View style={{ flex: 1, minWidth: 0 }}>
          {node?.content?.map((child, index) =>
            convert(child, {
              leadsBreakingListItem: !keepTogether && index === 0
            })
          )}
        </View>
      </View>
    );
  };

  return convert;
}

const Note = ({ title, content }: { title?: string; content: JSONContent }) => {
  const theme = useDocTheme();
  const allowItalic = fontHasItalic(useDocFontFamily());
  if (!content) return null;
  if (typeof content !== "object") return null;
  if (!("content" in content)) return null;
  if (!Array.isArray(content.content) || content.content.length === 0)
    return null;

  return (
    <View style={{ width: "100%", color: theme.text }}>
      {makeConvert(theme, allowItalic)(content, { title })}
    </View>
  );
};

export default Note;

const styles = StyleSheet.create({
  thead: {
    flexGrow: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "20px",
    marginBottom: "10px",
    padding: "6px 3px 6px 3px",
    borderTop: 1,
    borderTopColor: "#CCCCCC",
    borderTopStyle: "solid",
    borderBottom: 1,
    borderBottomColor: "#CCCCCC",
    borderBottomStyle: "solid",
    fontSize: 9,
    fontWeight: 700,
    textTransform: "uppercase"
  }
});
