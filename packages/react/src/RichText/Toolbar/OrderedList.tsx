import { BsListOl } from "react-icons/bs";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const OrderedList: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Numbered list"
      onClick={() => editor.chain().focus().toggleOrderedList().run()}
      isActive={editor.isActive("orderedList")}
      icon={<BsListOl />}
      disabled={!editor.isEditable}
    />
  );
};

export default OrderedList;
