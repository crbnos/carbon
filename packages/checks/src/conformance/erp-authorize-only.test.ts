// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { erpAuthorizeOnly } from "./erp-authorize-only";

const scan = (contents: string, file = "apps/erp/app/routes/x.tsx") =>
  erpAuthorizeOnly.scan(file, contents);

describe("erpAuthorizeOnly", () => {
  it("flags requirePermissions, carbon and carbonFor imports", () => {
    expect(
      scan(`import { requirePermissions } from "@carbon/auth/auth.server";
import {
  carbon,
  carbonFor as bind,
  respond
} from "@carbon/api/carbon.server";
import type { requirePermissions as rp } from "@carbon/auth/auth.server";`).map(
        (v) => [v.line, v.snippet]
      )
    ).toEqual([
      [1, 'import { requirePermissions } from "@carbon/auth/auth.server"'],
      [2, 'import { carbon } from "@carbon/api/carbon.server"'],
      [2, 'import { carbonFor } from "@carbon/api/carbon.server"'],
      [7, 'import { requirePermissions } from "@carbon/auth/auth.server"']
    ]);
  });

  it("accepts authorize and the other exports", () => {
    expect(
      scan(`import { authorize, respond } from "@carbon/api/carbon.server";
import { hashApiKey } from "@carbon/auth/auth.server";
import { registerCarbon } from "@carbon/api/carbon.server";`)
    ).toEqual([]);
  });

  it("leaves MES and the packages alone", () => {
    const source = `import { requirePermissions } from "@carbon/auth/auth.server";`;
    expect(scan(source, "apps/mes/app/routes/x.tsx")).toEqual([]);
    expect(scan(source, "packages/ee/src/x.ts")).toEqual([]);
  });
});
