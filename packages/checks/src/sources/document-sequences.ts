// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceFile } from "../check";
import {
  ATTACHMENTS_FILE,
  INTERCEPTOR_FILE,
  SEED_DATA_FILE
} from "../conformance/document-sequence-synced";

/** The three files `findUnsyncedDocumentSequences` compares. */
export function loadDocumentSequenceSources(root: string): {
  seedData: SourceFile;
  attachments: SourceFile;
  interceptor: SourceFile;
} {
  const load = (file: string): SourceFile => ({
    file,
    contents: readFileSync(join(root, file), "utf-8")
  });
  return {
    seedData: load(SEED_DATA_FILE),
    attachments: load(ATTACHMENTS_FILE),
    interceptor: load(INTERCEPTOR_FILE)
  };
}
