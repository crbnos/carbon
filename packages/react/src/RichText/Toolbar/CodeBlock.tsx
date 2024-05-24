import { BsCodeSlash } from "react-icons/bs";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const CodeBlock: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Codeblock"
      onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      isActive={editor.isActive("codeBlock")}
      icon={<BsCodeSlash />}
      disabled={!editor.isEditable}
    />
  );
};

export default CodeBlock;
