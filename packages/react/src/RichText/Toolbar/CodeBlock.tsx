// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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
