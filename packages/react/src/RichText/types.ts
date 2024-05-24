import type { Editor } from "@tiptap/react";

export interface WithEditor {
  editor: Editor;
}

export type EditorComponent = ({ editor }: WithEditor) => JSX.Element;
