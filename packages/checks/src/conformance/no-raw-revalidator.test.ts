// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noRawRevalidator } from "./no-raw-revalidator";

const scan = (
  contents: string,
  file = "apps/erp/app/components/Documents.tsx"
) => noRawRevalidator.scan(file, contents);

describe("noRawRevalidator", () => {
  it("flags React Router's hook, alone or among other imports", () => {
    expect(
      scan(`import { useRevalidator } from "react-router";\n`)
    ).toHaveLength(1);
    const violations = scan(
      `import { z } from "zod";\nimport {\n  useFetcher,\n  useRevalidator\n} from "react-router";\n`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe(2);
  });

  it("accepts the held one, and other react-router imports", () => {
    expect(
      scan(
        `import { useRevalidator } from "@carbon/query";\nimport { useFetcher, useNavigate } from "react-router";\n`
      )
    ).toEqual([]);
  });

  it("lets the wrapper take React Router's", () => {
    expect(
      scan(
        `import { useRevalidator as useRouterRevalidator } from "react-router";\n`,
        "packages/query/src/useRevalidator.ts"
      )
    ).toEqual([]);
  });
});
