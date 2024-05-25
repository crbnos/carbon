import { LuCode2 } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const CodeBlock: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Codeblock"
      onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      isActive={editor.isActive("codeBlock")}
      icon={<LuCode2 />}
      disabled={!editor.isEditable}
    />
  );
};

export default CodeBlock;
