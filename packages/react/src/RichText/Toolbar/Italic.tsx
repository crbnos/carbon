import { LuItalic } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Italic: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Italic"
      onClick={() => editor.chain().focus().toggleItalic().run()}
      isActive={editor.isActive("italic")}
      icon={<LuItalic />}
      disabled={!editor.isEditable}
    >
      I
    </ToolbarButton>
  );
};

export default Italic;
