import { LuHeading1, LuHeading2, LuHeading3 } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

export const HeadingOne: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Heading 1"
      onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      isActive={editor.isActive("heading", { level: 1 })}
      icon={<LuHeading1 />}
      disabled={!editor.isEditable}
    />
  );
};

export const HeadingTwo: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Heading 2"
      onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      isActive={editor.isActive("heading", { level: 2 })}
      icon={<LuHeading2 />}
      disabled={!editor.isEditable}
    />
  );
};

export const HeadingThree: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Heading 3"
      onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      isActive={editor.isActive("heading", { level: 3 })}
      icon={<LuHeading3 />}
      disabled={!editor.isEditable}
    />
  );
};
