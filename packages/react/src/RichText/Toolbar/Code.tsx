import { LuCode } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Code: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Code"
      onClick={() => editor.chain().focus().toggleCode().run()}
      isActive={editor.isActive("code")}
      icon={<LuCode />}
      disabled={!editor.isEditable}
    />
  );
};

export default Code;
