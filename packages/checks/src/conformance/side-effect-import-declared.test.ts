// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  declaresSideEffects,
  findUndeclaredSideEffectImports
} from "./side-effect-import-declared";

const pkg = (sideEffects: false | string[], files: Record<string, string>) => ({
  dir: "apps/erp",
  sideEffects,
  paths: new Set(Object.keys(files)),
  files: Object.entries(files).map(([file, contents]) => ({ file, contents }))
});

describe("findUndeclaredSideEffectImports", () => {
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
});

describe("the 6984e529d8 fix", () => {
  // apps/erp/app/root.tsx and apps/erp/package.json before 6984e529d8: the
  // build dropped the import, so z.config({ jitless: true }) never ran and the
  // CSP reported zod's eval probe on every page load.
  const root = {
    "apps/erp/app/root.tsx":
      'import "./zod.client";\nimport { CONTROLLED_ENVIRONMENT, error, getBrowserEnv } from "@carbon/auth";\n',
    "apps/erp/app/zod.client.ts": "z.config({ jitless: true });\n"
  };

  it("flags the zod.client import from before 6984e529d8", () => {
    expect(
      findUndeclaredSideEffectImports([pkg(false, root)]).map((v) => [
        v.file,
        v.line,
        v.snippet
      ])
    ).toEqual([["apps/erp/app/root.tsx", 1, "./zod.client"]]);
  });

  it("passes the 6984e529d8 fix, which lists the file in sideEffects", () => {
    expect(
      findUndeclaredSideEffectImports([pkg(["./app/zod.client.ts"], root)])
    ).toEqual([]);
  });
});

describe("declaresSideEffects", () => {
  it("matches a path, a glob, and a bare file name anywhere", () => {
    expect(declaresSideEffects(["./src/shims.ts"], "src/shims.ts")).toBe(true);
    expect(declaresSideEffects(["src/*.css"], "src/a.css")).toBe(true);
    expect(declaresSideEffects(["shims.ts"], "src/deep/shims.ts")).toBe(true);
    expect(declaresSideEffects(["./src/shims.ts"], "src/other.ts")).toBe(false);
    expect(declaresSideEffects(false, "src/shims.ts")).toBe(false);
  });
});
