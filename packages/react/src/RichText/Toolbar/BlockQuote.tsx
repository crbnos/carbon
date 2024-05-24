import { GoQuote } from "react-icons/go";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const BlockQuote: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Blockquote"
      onClick={() => editor.chain().focus().toggleBlockquote().run()}
      isActive={editor.isActive("blockquote")}
      icon={<GoQuote />}
      disabled={!editor.isEditable}
    />
  );
};

export default BlockQuote;
