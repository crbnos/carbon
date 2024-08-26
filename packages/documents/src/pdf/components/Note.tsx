import type { JSONContent } from "@carbon/react";
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";

const convertTiptapJSON = (
  node: JSONContent,
  index?: number,
  parentNodeType?: string
) => {
  console.log({ node });
  switch (node.type) {
    case "doc":
      return (
        <View style={{ fontSize: 11 }}>
          <View style={styles.thead}>
            <Text>Notes</Text>
          </View>
          {node.content.map((child, index) => convertTiptapJSON(child))}
        </View>
      );

    case "heading":
      return (
        <Text
          key={`heading-${node.attrs.level}`}
          style={{
            fontSize: 16 - node.attrs.level * 2,
            fontWeight: "bold",
            marginBottom: 10,
          }}
        >
          {node.content.map((child) => convertTiptapJSON(child))}
        </Text>
      );

    case "paragraph":
      return (
        <Text key="paragraph" style={{ marginBottom: 10 }}>
          {node.content?.map((child) => convertTiptapJSON(child)) || ""}
        </Text>
      );

    case "bulletList":
      return (
        <View key="bulletList" style={{ marginLeft: 20 }}>
          {node.content.map((child, index) =>
            convertTiptapJSON(child, index, "bulletList")
          )}
        </View>
      );

    case "orderedList":
      return (
        <View key="orderedList" style={{ marginLeft: 20 }}>
          {node.content.map((child, index) =>
            convertTiptapJSON(child, index, "orderedList")
          )}
        </View>
      );

    case "listItem":
      const indicator = parentNodeType == "orderedList" ? `${index + 1}.` : "•";
      return (
        <View
          key={`listItem-${index}`}
          style={{ flexDirection: "row", marginBottom: 5 }}
        >
          <Text style={{ marginRight: 5 }}> {indicator} </Text>
          <View>
            {node.content.map((child, index) => convertTiptapJSON(child))}
          </View>
        </View>
      );

    case "taskList":
      return (
        <View key="taskList" style={{ marginLeft: 20 }}>
          {node.content.map((child, index) => convertTiptapJSON(child, index))}
        </View>
      );

    case "taskItem":
      return (
        <View
          key={`taskItem-${index}`}
          style={{ flexDirection: "row", marginBottom: 5 }}
        >
          <Text style={{ marginRight: 5 }}>•</Text>
          <View>
            {node.content.map((child, index) => convertTiptapJSON(child))}
          </View>
        </View>
      );

    case "text":
      return node.text;

    case "image":
      return (
        <Image
          key="image"
          src={node.attrs.src}
          style={{
            width: node.attrs.width || "auto",
            height: node.attrs.height || "auto",
          }}
        />
      );

    default:
      return null;
  }
};

const Note = ({ note }: { note: JSONContent }) => {
  if (!note || !("content" in note)) return null;
  return <View>{convertTiptapJSON(note)}</View>;
};

export default Note;

const styles = StyleSheet.create({
  thead: {
    flexGrow: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "20px",
    padding: "6px 3px 6px 3px",
    borderTop: 1,
    borderTopColor: "#CCCCCC",
    borderTopStyle: "solid",
    borderBottom: 1,
    borderBottomColor: "#CCCCCC",
    borderBottomStyle: "solid",
    fontSize: 9,
    fontWeight: 700,
    color: "#7d7d7d",
    textTransform: "uppercase",
  },
  tfoot: {
    flexGrow: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "6px 3px 6px 3px",
    borderTopStyle: "solid",
    borderBottom: 1,
    borderBottomColor: "#CCCCCC",
    borderBottomStyle: "solid",
    fontWeight: 700,
    color: "#7d7d7d",
    textTransform: "uppercase",
  },
});
