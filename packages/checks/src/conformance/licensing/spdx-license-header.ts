// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { defineCheck } from "../../check";
import {
  classifyFile,
  type HeaderStatus,
  inspectLicenseHeader,
  LICENSE_HEADERS
} from "../../license-headers";
import { loadLicenseFiles } from "../../sources/license-files";

// Every first-party source file opens with an SPDX header naming its license:
// AGPL-3.0-only, or LicenseRef-Carbon-Commercial for the Enterprise files
// (packages/ee/ and any `.ee.` file name). Which files need which header, the
// exclusions and the insertion rules all live in ../../license-headers.ts, shared
// with the fixer — this check fails exactly the files the fixer would change.
// Its source is sources/license-files.ts (git-tracked files only).
export const spdxLicenseHeader = defineCheck({
  files: loadLicenseFiles,
  id: "spdx-license-header",
  description:
    "Every first-party source file starts with its SPDX license header",
  provenance: {
    deprecates: "source files with no license header",
    replacedBy: `${LICENSE_HEADERS.agpl[0]} / ${LICENSE_HEADERS.commercial[0]}`,
    since: "2026-09-30"
  },
  rule() {
    const fix = "run `pnpm --filter @carbon/checks license-headers`";
    const messages: Record<Exclude<HeaderStatus, "ok">, string> = {
      missing: `Missing SPDX license header — ${fix}`,
      "wrong-license": `Header names the other license (file moved across packages/ee or a .ee. rename?) — ${fix}`,
      malformed: `SPDX header text or spacing is not canonical — ${fix}`,
      foreign:
        "Carries a third-party notice (SPDX id, @license or copyright) — add it to PATH_EXCLUSIONS in license-headers.ts with its reason, or fix the header by hand"
    };
    return (file, contents) => {
      const classification = classifyFile(file, contents);
      if ("excluded" in classification) return [];
      const status = inspectLicenseHeader(contents, classification.kind);
      if (status === "ok") return [];
      return [
        {
          file,
          line: 1,
          snippet: `${status}: expected ${LICENSE_HEADERS[classification.kind][0]}`,
          message: messages[status]
        }
      ];
    };
  }
});
