import { LuText } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Paragraph: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Normal text"
      onClick={() => editor.chain().focus().setParagraph().run()}
      isActive={editor.isActive("paragraph")}
      icon={<LuText />}
      disabled={!editor.isEditable}
    />
  );
};

export default Paragraph;
