// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { LINE_MERGE_FIELDS, MERGE_FIELDS } from "@carbon/documents/template";
import { describe, expect, it } from "vitest";
import { MERGE_FIELD_NAMES } from "./mergeFieldNames";

describe("MERGE_FIELD_NAMES", () => {
  it("translates every merge field and group a document offers", () => {
    const fields = [
      ...Object.values(MERGE_FIELDS),
      ...Object.values(LINE_MERGE_FIELDS)
    ].flat();
    for (const field of fields) {
      expect(MERGE_FIELD_NAMES[field.label], field.token).toBeDefined();
      expect(MERGE_FIELD_NAMES[field.group], field.token).toBeDefined();
    }
  });
});
