// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
