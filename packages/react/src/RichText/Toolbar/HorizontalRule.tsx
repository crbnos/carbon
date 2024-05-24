import { MdHorizontalRule } from "react-icons/md";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const HorizontalRule: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Horizontal rule"
      onClick={() => editor.chain().focus().setHorizontalRule().run()}
      icon={<MdHorizontalRule />}
      disabled={!editor.isEditable}
    />
  );
};

export default HorizontalRule;
