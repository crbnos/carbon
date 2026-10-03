// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { ConformanceCheck, Violation } from "../check";

// An error log's message is exported as a span attribute and is what errors are
// grouped by. A value interpolated into it (`Failed to upload ${file.name}`)
// makes every occurrence a different error and puts the value in the trace.
// Name it instead: "Failed to upload {fileName}", { fileName: file.name }.
const INTERPOLATED = /\b\w*[lL]og(?:ger)?\.(?:error|fatal)\(\s*`[^`]*\$\{/g;

export const noInterpolatedErrorLog: ConformanceCheck = {
  id: "no-interpolated-error-log",
  description:
    "Error log messages name their values as {placeholders}, never interpolate them",
  provenance: {
    deprecates: "logger.error(`… ${value}`)",
    replacedBy: 'logger.error("… {value}", { value })',
    since: "2026-10-04"
  },
  scan(file: string, contents: string): Violation[] {
    return [...contents.matchAll(INTERPOLATED)].map((match) => {
      const line = contents.slice(0, match.index).split("\n").length;
      return {
        file,
        line,
        snippet: match[0].replace(/\s+/g, " "),
        message:
          'Use a {placeholder} in the message and pass the value as a property: logger.error("Failed to upload {fileName}", { fileName })'
      };
    });
  }
};
