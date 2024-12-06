import { LuMinus } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const HorizontalRule: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Horizontal rule"
      onClick={() => editor.chain().focus().setHorizontalRule().run()}
      icon={<LuMinus />}
      disabled={!editor.isEditable}
    />
  );
};

export default HorizontalRule;
