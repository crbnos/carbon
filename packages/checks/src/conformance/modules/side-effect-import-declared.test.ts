// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { sideEffectImportDeclared } from "./side-effect-import-declared";

const pkg = (sideEffects: false | string[], files: Record<string, string>) => ({
  dir: "apps/erp",
  sideEffects,
  paths: new Set(Object.keys(files)),
  files: Object.entries(files).map(([file, contents]) => ({ file, contents }))
});

const undeclared = (
  sideEffects: false | string[],
  files: Record<string, string>
) =>
  sideEffectImportDeclared
    .find({ packages: [pkg(sideEffects, files)] })
    .map((v) => v.snippet);

describe("sideEffectImportDeclared", () => {
  const files = {
    "apps/erp/app/entry.server.tsx": 'import "./modules/carbon.server";\n',
    "apps/erp/app/modules/carbon.server.ts": "registerCarbon();\n",
    "apps/erp/app/root.tsx":
      'import "~/zod.client";\nimport "./styles.css";\nimport "@carbon/lib/shims";\n',
    "apps/erp/app/zod.client.ts": "z.config({ jitless: true });\n"
  };

  it("flags a bare import of a file sideEffects does not list", () => {
    expect(undeclared(false, files)).toEqual([
      "./modules/carbon.server",
      "~/zod.client"
    ]);
  });

  it("passes once the files are listed, and ignores css and other packages", () => {
    expect(
      undeclared(["./app/modules/carbon.server.ts", "**/zod.client.ts"], files)
    ).toEqual([]);
  });

  it("ignores a css import whose file is in the package", () => {
    expect(
      undeclared(false, {
        "apps/erp/app/root.tsx": 'import "./styles.css";\n',
        "apps/erp/app/styles.css": ""
      })
    ).toEqual([]);
  });

  it("reads sideEffects as a path, a glob, or a bare file name anywhere", () => {
    const shims = {
      "apps/erp/app/root.tsx":
        'import "./shims";\nimport "./deep/polyfill";\nimport "./other";\n',
      "apps/erp/app/shims.ts": "",
      "apps/erp/app/deep/polyfill.ts": "",
      "apps/erp/app/other.ts": ""
    };
    expect(
      undeclared(["./app/shims.ts", "app/deep/*.ts", "other.ts"], shims)
    ).toEqual([]);
    expect(undeclared(["./app/shims.ts"], shims)).toEqual([
      "./deep/polyfill",
      "./other"
    ]);
  });
});
