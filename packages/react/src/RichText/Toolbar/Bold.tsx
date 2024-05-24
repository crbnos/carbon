import { BsTypeBold } from "react-icons/bs";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Bold: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Bold"
      onClick={() => editor.chain().focus().toggleBold().run()}
      isActive={editor.isActive("bold")}
      icon={<BsTypeBold />}
      disabled={!editor.isEditable}
    />
  );
};

export default Bold;
