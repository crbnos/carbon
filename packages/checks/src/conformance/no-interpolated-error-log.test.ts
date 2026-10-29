// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noInterpolatedErrorLog } from "./no-interpolated-error-log";

const scan = (contents: string) =>
  noInterpolatedErrorLog.scan("apps/erp/app/routes/x.tsx", contents);

describe("noInterpolatedErrorLog", () => {
  it("flags a value interpolated into an error message, on one line or several", () => {
    expect(
      scan(`logger.error(\`Failed to upload \${file.name}\`);
log.fatal(
  \`Lost \${id}\`,
  { error }
);`).map((v) => v.line)
    ).toEqual([1, 2]);
  });

  it("allows placeholders, plain templates and lower levels", () => {
    expect(
      scan(`logger.error("Failed to upload {fileName}", { fileName });
logger.error(\`Failed to upload\`);
logger.warn(\`Slow \${route}\`);`)
    ).toEqual([]);
  });
});
