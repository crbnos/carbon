// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
