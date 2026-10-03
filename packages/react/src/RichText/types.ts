// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Editor } from "@tiptap/react";

export interface WithEditor {
  editor: Editor;
}

export type EditorComponent = ({ editor }: WithEditor) => JSX.Element;
