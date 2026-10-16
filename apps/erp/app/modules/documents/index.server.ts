// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  cancelModelOptimize,
  optimizeModel,
  recordDocumentDownload,
  regenerateModelThumbnail,
  uploadModel
} from "./documents.server";

/** The documents module's operations, by entity. */
export const documents = {
  document: { recordDownload: recordDocumentDownload },
  model: {
    upload: uploadModel,
    regenerateThumbnail: regenerateModelThumbnail,
    optimize: optimizeModel,
    cancelOptimize: cancelModelOptimize
  }
};
