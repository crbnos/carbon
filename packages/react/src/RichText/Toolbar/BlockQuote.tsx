import { LuQuote } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const BlockQuote: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Blockquote"
      onClick={() => editor.chain().focus().toggleBlockquote().run()}
      isActive={editor.isActive("blockquote")}
      icon={<LuQuote />}
      disabled={!editor.isEditable}
    />
  );
};

export default BlockQuote;
