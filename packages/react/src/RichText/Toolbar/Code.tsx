// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
