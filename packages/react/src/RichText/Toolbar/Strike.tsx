import { LuStrikethrough } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Strike: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Strike"
      onClick={() => editor.chain().focus().toggleStrike().run()}
      isActive={editor.isActive("strike")}
      icon={<LuStrikethrough />}
      disabled={!editor.isEditable}
    />
  );
};

export default Strike;
