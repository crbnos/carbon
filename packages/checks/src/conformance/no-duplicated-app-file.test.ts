// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { findDuplicatedAppFiles } from "./no-duplicated-app-file";

const body = "export function useThing() {\n  return 1;\n}\n";
const reExport = '// header\n\nexport { useThing } from "@carbon/react";\n';

describe("findDuplicatedAppFiles", () => {
  it("flags a file with code in both apps", () => {
    expect(
      findDuplicatedAppFiles([
        { file: "apps/erp/app/hooks/useThing.ts", contents: body },
        { file: "apps/mes/app/hooks/useThing.ts", contents: body }
      ]).map((v) => v.file)
    ).toEqual(["useThing.ts"]);
  });

  it("accepts a file in one app, a re-export, and generic names", () => {
    expect(
      findDuplicatedAppFiles([
        { file: "apps/erp/app/hooks/useOnlyErp.ts", contents: body },
        { file: "apps/erp/app/hooks/useThing.ts", contents: reExport },
        { file: "apps/mes/app/hooks/useThing.ts", contents: reExport },
        { file: "apps/erp/app/hooks/index.ts", contents: body },
        { file: "apps/mes/app/hooks/index.ts", contents: body },
        { file: "apps/erp/app/components/A/Thing.tsx", contents: body },
        { file: "apps/erp/app/components/B/Thing.tsx", contents: body }
      ])
    ).toEqual([]);
  });
});
