import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import type { JSONContent } from "@tiptap/react";
import { generateHTML as DefaultGenerateHTML } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Editor from "./Editor";
import { defaultExtensions } from "./extensions";

const generateHTML = (content: JSONContent) => {
  if (typeof window === "undefined") {
    return "";
  }
  if (!content || !("type" in content)) {
    return "";
  }
  return DefaultGenerateHTML(content, [
    ...defaultExtensions,
    TextStyle,
    StarterKit,
    Underline,
  ]);
};

export { Editor, generateHTML };
