// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { LuStrikethrough } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const Strike: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Strike"
      onClick={() => editor.chain().focus().toggleStrike().run()}
      isActive={editor.isActive("strike")}
      icon={<LuStrikethrough />}
      disabled={!editor.isEditable}
    />
  );
};

export default Strike;
