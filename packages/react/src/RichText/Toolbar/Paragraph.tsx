import { BsType } from "react-icons/bs";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Paragraph: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Normal text"
      onClick={() => editor.chain().focus().setParagraph().run()}
      isActive={editor.isActive("paragraph")}
      icon={<BsType />}
      disabled={!editor.isEditable}
    />
  );
};

export default Paragraph;
