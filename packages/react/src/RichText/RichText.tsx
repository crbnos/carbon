import { Color } from "@tiptap/extension-color";
import ListItem from "@tiptap/extension-list-item";
import TextStyle from "@tiptap/extension-text-style";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ComponentProps } from "react";
import { cn } from "../utils/cn";
import { VStack } from "../VStack";
import { Toolbar } from "./Toolbar";

export const useRichText = (content: string) => {
  const richText = useEditor({
    // Avoid SSR hydration mismatch (Tiptap renders on the client).
    immediatelyRender: false,
    extensions: [
      Color.configure({ types: [TextStyle.name, ListItem.name] }),
      TextStyle,
      StarterKit.configure({
        bulletList: {
          keepMarks: true,
          keepAttributes: false // TODO : Making this as `false` becase marks are not preserved when I try to preserve attrs, awaiting a bit of help
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false // TODO : Making this as `false` becase marks are not preserved when I try to preserve attrs, awaiting a bit of help
        }
      })
    ],
    content
  });

  return richText;
};

export type RichTextProps = Omit<
  ComponentProps<typeof EditorContent>,
  "onChange"
> & {
  editor: ReturnType<typeof useRichText>;
};

export const RichText = ({ editor, className, ...props }: RichTextProps) => {
  if (!editor) {
    return null;
  }

  return (
    <VStack spacing={0}>
      <Toolbar editor={editor} />
      <EditorContent
        editor={editor}
        className={cn(
          "w-full min-h-[300px] bg-background [&h1]:text-2xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight [&_h3]:text-lg [&_h3]:font-bold [&_h3]:tracking-tight [&_ul]:list-disc [&_ol]:list-decimal [&_ul], [&_ol]:ml-4 [&_pre]:bg-gray-100 [&_pre]:p-4 [&_pre]:rounded-md [&_pre]:overflow-auto [&_blockquote]:border-l-4 [&_blockquote]:border-gray-200 [&_blockquote]:pl-4 [&_blockquote]:ml-4 [&_hr]:border-none [&_hr]:border-b-1 [&_hr]:border-gray-200 [&_hr]:my-4 [&_.ProseMirror]:p-4 [&_.ProseMirror]:h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:focus:outline-none [&_.ProseMirror]:focus-visible:outline-none [&_.ProseMirror]:focus-visible:border-ring [&_.ProseMirror]:focus-visible:ring-[3px] [&_.ProseMirror]:focus-visible:ring-ring/50",
          className
        )}
        {...props}
      />
    </VStack>
  );
};
