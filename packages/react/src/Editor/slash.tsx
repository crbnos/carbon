import type { EditorView } from "@tiptap/pm/view";
import { createSuggestionItems } from "novel/extensions";
import {
  LuCheckSquare,
  LuHeading1,
  LuHeading2,
  LuHeading3,
  LuImage,
  LuList,
  LuListOrdered,
  LuText,
} from "react-icons/lu";

export const getSuggestionItems = (
  uploadFn: (file: File, view: EditorView, pos: number) => void
) => {
  return createSuggestionItems([
    {
      title: "Text",
      description: "Just start typing with plain text.",
      searchTerms: ["p", "paragraph"],
      icon: <LuText size={18} />,
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .toggleNode("paragraph", "paragraph")
          .run();
      },
    },
    {
      title: "To-do List",
      description: "Track tasks with a to-do list.",
      searchTerms: ["todo", "task", "list", "check", "checkbox"],
      icon: <LuCheckSquare size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleTaskList().run();
      },
    },
    {
      title: "Heading 1",
      description: "Big section heading.",
      searchTerms: ["title", "big", "large"],
      icon: <LuHeading1 size={18} />,
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 1 })
          .run();
      },
    },
    {
      title: "Heading 2",
      description: "Medium section heading.",
      searchTerms: ["subtitle", "medium"],
      icon: <LuHeading2 size={18} />,
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 2 })
          .run();
      },
    },
    {
      title: "Heading 3",
      description: "Small section heading.",
      searchTerms: ["subtitle", "small"],
      icon: <LuHeading3 size={18} />,
      command: ({ editor, range }) => {
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 3 })
          .run();
      },
    },
    {
      title: "Bullet List",
      description: "Create a simple bullet list.",
      searchTerms: ["unordered", "point"],
      icon: <LuList size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: "Numbered List",
      description: "Create a list with numbering.",
      searchTerms: ["ordered"],
      icon: <LuListOrdered size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    // {
    //   title: "Code",
    //   description: "Capture a code snippet.",
    //   searchTerms: ["codeblock"],
    //   icon: <LuCode size={18} />,
    //   command: ({ editor, range }) =>
    //     editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    // },
    {
      title: "Image",
      description: "Upload an image from your computer.",
      searchTerms: ["photo", "picture", "media"],
      icon: <LuImage size={18} />,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        // upload image
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.onchange = async () => {
          if (input.files?.length) {
            const file = input.files[0];
            const pos = editor.view.state.selection.from;
            uploadFn(file, editor.view, pos);
          }
        };
        input.click();
      },
    },
  ]);
};
