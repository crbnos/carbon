// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import type { SideEffectPackage } from "../../sources/side-effect-packages";
import { sideEffectImportDeclared } from "./side-effect-import-declared";

const findUndeclaredSideEffectImports = (packages: SideEffectPackage[]) =>
  sideEffectImportDeclared.find({ packages });

const pkg = (sideEffects: false | string[], files: Record<string, string>) => ({
  dir: "apps/erp",
  sideEffects,
  paths: new Set(Object.keys(files)),
  files: Object.entries(files).map(([file, contents]) => ({ file, contents }))
});

describe("sideEffectImportDeclared", () => {
  const files = {
    "apps/erp/app/entry.server.tsx": 'import "./modules/carbon.server";\n',
    "apps/erp/app/modules/carbon.server.ts": "registerCarbon();\n",
    "apps/erp/app/root.tsx":
      'import "~/zod.client";\nimport "./styles.css";\nimport "@carbon/lib/shims";\n',
    "apps/erp/app/zod.client.ts": "z.config({ jitless: true });\n"
  };

  it("flags a bare import of a file sideEffects does not list", () => {
    expect(
      findUndeclaredSideEffectImports([pkg(false, files)]).map((v) => v.snippet)
    ).toEqual(["./modules/carbon.server", "~/zod.client"]);
  });

  it("passes once the files are listed, and ignores css and other packages", () => {
    expect(
      findUndeclaredSideEffectImports([
        pkg(["./app/modules/carbon.server.ts", "**/zod.client.ts"], files)
      ])
    ).toEqual([]);
  });

  it("ignores a css import whose file is in the package", () => {
    expect(
      findUndeclaredSideEffectImports([
        pkg(false, {
          "apps/erp/app/root.tsx": 'import "./styles.css";\n',
          "apps/erp/app/styles.css": ""
        })
      ])
    ).toEqual([]);
  });
});
