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
 * Build a tiptap → react-pdf renderer bound to a theme, so the title/headings
 * pick up `theme.heading` and body text inherits `theme.text` (set on the
 * wrapper). Closure over `theme` keeps the recursive calls clean.
 */
function makeConvert(theme: DocumentTheme, allowItalic: boolean) {
  const convert = (
    node: JSONContent,
    args?: { index?: number; parentNodeType?: string; title?: string }
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
        return (
          <View
            key={`listItem-${args?.index}`}
            style={{ flexDirection: "row", marginBottom: 5 }}
          >
            <Text style={{ marginRight: 5, fontSize: 9 }}> {indicator} </Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              {node?.content?.map((child) => convert(child))}
            </View>
          </View>
        );
      }

      case "taskList":
        return (
          <View key="taskList" style={{ marginLeft: 20 }}>
            {node?.content?.map((child, index) => convert(child, { index }))}
          </View>
        );

      case "taskItem":
        return (
          <View
            key={`taskItem-${args?.index}`}
            style={{ flexDirection: "row", marginBottom: 5 }}
          >
            <Text style={{ marginRight: 5, fontSize: 9 }}>•</Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              {node?.content?.map((child) => convert(child))}
            </View>
          </View>
        );

      case "text": {
        const marks = node.marks ?? [];
        if (marks.length === 0) return node.text;
        const style: { fontWeight?: "bold"; fontStyle?: "italic" } = {};
        if (marks.some((mark) => mark.type === "bold"))
          style.fontWeight = "bold";
        // Italic only with an italic face: react-pdf throws without one.
        if (allowItalic && marks.some((mark) => mark.type === "italic")) {
          style.fontStyle = "italic";
        }
        const text =
          Object.keys(style).length > 0 ? (
            <Text style={style}>{node.text}</Text>
          ) : (
            node.text
          );
        const href = marks.find((mark) => mark.type === "link")?.attrs?.href;
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

      default:
        return null;
    }
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
