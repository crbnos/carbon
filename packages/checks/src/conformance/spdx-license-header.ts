// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";
import {
  classifyFile,
  type HeaderStatus,
  inspectLicenseHeader,
  LICENSE_HEADERS
} from "../license-headers";

// Every first-party source file opens with an SPDX header naming its license:
// AGPL-3.0-only, or LicenseRef-Carbon-Commercial for the Enterprise files
// (packages/ee/ and any `.ee.` file name). Which files need which header, the
// exclusions and the insertion rules all live in ../license-headers.ts, shared
// with the fixer — this check fails exactly the files the fixer would change.
// Its source is sources/license-files.ts (git-tracked files only).

const FIX = "run `pnpm --filter @carbon/checks license-headers`";

const MESSAGES: Record<Exclude<HeaderStatus, "ok">, string> = {
  missing: `Missing SPDX license header — ${FIX}`,
  "wrong-license": `Header names the other license (file moved across packages/ee or a .ee. rename?) — ${FIX}`,
  malformed: `SPDX header text or spacing is not canonical — ${FIX}`,
  foreign:
    "Carries a third-party notice (SPDX id, @license or copyright) — add it to PATH_EXCLUSIONS in license-headers.ts with its reason, or fix the header by hand"
};

export const spdxLicenseHeader: ConformanceCheck = {
  id: "spdx-license-header",
  description:
    "Every first-party source file starts with its SPDX license header",
  provenance: {
    deprecates: "source files with no license header",
    replacedBy: `${LICENSE_HEADERS.agpl[0]} / ${LICENSE_HEADERS.commercial[0]}`,
    since: "2026-09-30"
  },
  scan(file: string, contents: string): Violation[] {
    const classification = classifyFile(file, contents);
    if ("excluded" in classification) return [];
    const status = inspectLicenseHeader(contents, classification.kind);
    if (status === "ok") return [];
    return [
      {
        file,
        line: 1,
        snippet: `${status}: expected ${LICENSE_HEADERS[classification.kind][0]}`,
        message: MESSAGES[status]
      }
    ];
  }
};
