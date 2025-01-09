import { LuCodeXml } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const CodeBlock: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Codeblock"
      onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      isActive={editor.isActive("codeBlock")}
      icon={<LuCodeXml />}
      disabled={!editor.isEditable}
    />
  );
};

export default CodeBlock;
