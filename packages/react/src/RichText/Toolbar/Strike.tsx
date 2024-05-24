import { BsTypeStrikethrough } from "react-icons/bs";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Strike: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Strike"
      onClick={() => editor.chain().focus().toggleStrike().run()}
      isActive={editor.isActive("strike")}
      icon={<BsTypeStrikethrough />}
      disabled={!editor.isEditable}
    />
  );
};

export default Strike;
