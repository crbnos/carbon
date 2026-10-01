// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { BsListUl } from "react-icons/bs";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const UnorderedList: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Bullet list"
      onClick={() => editor.chain().focus().toggleBulletList().run()}
      isActive={editor.isActive("bulletList")}
      icon={<BsListUl />}
      disabled={!editor.isEditable}
    />
  );
};

export default UnorderedList;
