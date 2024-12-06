import TextStyle from "@tiptap/extension-text-style";
import type { JSONContent } from "@tiptap/react";
import { generateHTML as DefaultGenerateHTML } from "@tiptap/react";
import Editor from "./Editor";
import { defaultExtensions } from "./extensions";

const generateHTML = (content: JSONContent) => {
  if (typeof window === "undefined") {
    return "";
  }
  if (!content || !("type" in content)) {
    return "";
  }
  return DefaultGenerateHTML(content, [...defaultExtensions, TextStyle]);
};

export { Editor, generateHTML };
