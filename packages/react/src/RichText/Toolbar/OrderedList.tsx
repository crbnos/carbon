// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { LuListOrdered } from "react-icons/lu";
import type { EditorComponent } from "../types";
import ToolbarButton from "./ToolbarButton";

const OrderedList: EditorComponent = ({ editor }) => {
  return (
    <ToolbarButton
      label="Numbered list"
      onClick={() => editor.chain().focus().toggleOrderedList().run()}
      isActive={editor.isActive("orderedList")}
      icon={<LuListOrdered />}
      disabled={!editor.isEditable}
    />
  );
};

export default OrderedList;
