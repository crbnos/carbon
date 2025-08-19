export const textToTiptap = (text: string) => {
  const lines = text.split("\n");
  const content = lines.map((line) => ({
    type: "paragraph",
    content: [{ type: "text", text: line }],
  }));
  return { type: "doc", content };
};
