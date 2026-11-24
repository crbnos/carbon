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
        "packages/react/src/hooks/useRevalidator.ts"
      )
    ).toEqual([]);
  });

  it("flags the realtime reload from before c1ae854f80, which dropped a new quote line", () => {
    // packages/query/src/useRealtime.tsx before c1ae854f80: a save's own
    // broadcast revalidated during its redirect and restarted that navigation.
    const before = `import { useFetchers, useMatches, useRevalidator } from "react-router";
const revalidator = useRevalidator();`;
    expect(
      scan(before, "packages/query/src/useRealtime.tsx").map((v) => v.line)
    ).toEqual([1]);
    // The fix imports the held one.
    expect(
      scan(
        `import { useMatches } from "react-router";\nimport { useRevalidator } from "./useRevalidator";\n`,
        "packages/query/src/useRealtime.tsx"
      )
    ).toEqual([]);
  });
});
