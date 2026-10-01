// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BsTypeBold } from "react-icons/bs";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Bold: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Bold"
      onClick={() => editor.chain().focus().toggleBold().run()}
      isActive={editor.isActive("bold")}
      icon={<BsTypeBold />}
      disabled={!editor.isEditable}
    />
  );
};

export default Bold;
