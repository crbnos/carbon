// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import Image from "@tiptap/extension-image";

const UpdatedImage = Image.extend({
  name: "image",
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null
      },
      height: {
        default: null
      }
    };
  }
});

export default UpdatedImage;
