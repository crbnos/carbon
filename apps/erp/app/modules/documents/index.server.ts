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
import {
  createDocumentUploadUrlTool,
  deleteDocumentTool,
  getDocumentExtensionsTool,
  getDocumentLabelsTool,
  getDocumentsTool,
  getDocumentTool,
  insertDocumentExtractionTool,
  insertUploadedDocumentTool,
  moveDocumentToTrashTool,
  restoreDocumentTool,
  updateDocumentFavoriteTool,
  updateDocumentLabelsTool,
  upsertDocumentCreateTool,
  upsertDocumentUpdateTool
} from "./documents.tools.server";

/** The documents module's operations, by entity. */
export const documents = {
  document: {
    recordDownload: recordDocumentDownload,
    delete: deleteDocumentTool,
    get: getDocumentTool,
    restore: restoreDocumentTool,
    create: upsertDocumentCreateTool,
    update: upsertDocumentUpdateTool
  },
  model: {
    upload: uploadModel,
    regenerateThumbnail: regenerateModelThumbnail,
    optimize: optimizeModel,
    cancelOptimize: cancelModelOptimize
  },
  documents: {
    get: getDocumentsTool
  },
  documentExtensions: {
    get: getDocumentExtensionsTool
  },
  documentLabels: {
    get: getDocumentLabelsTool,
    update: updateDocumentLabelsTool
  },
  documentToTrash: {
    move: moveDocumentToTrashTool
  },
  documentUploadUrl: {
    create: createDocumentUploadUrlTool
  },
  uploadedDocument: {
    insert: insertUploadedDocumentTool
  },
  documentFavorite: {
    update: updateDocumentFavoriteTool
  },
  documentExtraction: {
    insert: insertDocumentExtractionTool
  }
};
