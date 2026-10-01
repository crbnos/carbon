// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { applyLicenseHeader, LICENSE_HEADERS } from "../license-headers";
import { spdxLicenseHeader } from "./spdx-license-header";

const scan = (file: string, contents: string) =>
  spdxLicenseHeader.scan(file, contents);

describe("spdxLicenseHeader", () => {
  it("flags a file with no header, naming the expected license", () => {
    const [v] = scan("apps/erp/app/root.tsx", "export {};\n");
    expect(v).toMatchObject({ line: 1, file: "apps/erp/app/root.tsx" });
    expect(v?.snippet).toBe(`missing: expected ${LICENSE_HEADERS.agpl[0]}`);
    const [ee] = scan("packages/ee/src/plan.ts", "export {};\n");
    expect(ee?.snippet).toBe(
      `missing: expected ${LICENSE_HEADERS.commercial[0]}`
    );
  });

  it("flags the other license's header", () => {
    const agpl = applyLicenseHeader("export {};\n", "agpl");
    expect(scan("packages/ee/src/plan.ts", agpl)[0]?.snippet).toMatch(
      /^wrong-license:/
    );
    expect(
      scan("apps/erp/app/modules/x/ui/Thing.ee.tsx", agpl)[0]?.snippet
    ).toMatch(/^wrong-license:/);
  });

  it("passes exactly the files the fixer would leave unchanged", () => {
    for (const [file, kind] of [
      ["apps/erp/app/root.tsx", "agpl"],
      ["packages/ee/src/plan.ts", "commercial"],
      ["crates/planner/src/lib.rs", "agpl"]
    ] as const) {
      const fixed = applyLicenseHeader('"use client";\nexport {};\n', kind);
      expect(scan(file, fixed)).toEqual([]);
      expect(scan(file, fixed.replace("\n\n", "\n"))).toHaveLength(1);
    }
  });

  it("skips excluded files", () => {
    expect(scan("apps/erp/sst-env.d.ts", "/* x */\n")).toEqual([]);
    expect(
      scan(
        "packages/ee/src/workflows/catalog/events.generated.ts",
        "export {};\n"
      )
    ).toEqual([]);
    expect(
      scan("apps/erp/app/x.ts", "// GENERATED FILE — do not edit.\n")
    ).toEqual([]);
  });

  it("flags a third-party notice for a human instead of rewriting it", () => {
    const [v] = scan(
      "apps/erp/app/vendor.ts",
      "// SPDX-License-Identifier: MIT\nexport {};\n"
    );
    expect(v?.snippet).toMatch(/^foreign:/);
    expect(v?.message).toMatch(/PATH_EXCLUSIONS/);
  });
});
