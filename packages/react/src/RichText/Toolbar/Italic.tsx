import { BsTypeItalic } from "react-icons/bs";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Italic: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Italic"
      onClick={() => editor.chain().focus().toggleItalic().run()}
      isActive={editor.isActive("italic")}
      icon={<BsTypeItalic />}
      disabled={!editor.isEditable}
    >
      I
    </ToolbarButton>
  );
};

export default Italic;
