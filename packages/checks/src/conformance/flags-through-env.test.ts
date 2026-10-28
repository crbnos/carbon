// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { flagsThroughEnv } from "./flags-through-env";

const scan = (file: string, contents: string) =>
  flagsThroughEnv.scan(file, contents);

describe("flags-through-env", () => {
  it("flags an OpenFeature import in app code", () => {
    const found = scan(
      "apps/erp/app/routes/x+/thing.tsx",
      'import { OpenFeature } from "@openfeature/server-sdk";'
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.snippet).toContain("@openfeature/server-sdk");
  });

  it("flags a dynamic import and a type import", () => {
    expect(
      scan(
        "packages/ee/src/thing.ts",
        'const { FlagdCore } = await import("@openfeature/flagd-core");'
      )
    ).toHaveLength(1);
    expect(
      scan(
        "apps/mes/app/thing.ts",
        'import type { Client } from "@openfeature/server-sdk";'
      )
    ).toHaveLength(1);
  });

  it("allows the provider in packages/env", () => {
    expect(
      scan(
        "packages/env/src/flags.server.ts",
        'import { OpenFeature } from "@openfeature/server-sdk";'
      )
    ).toHaveLength(0);
  });

  it("allows the typed API", () => {
    expect(
      scan(
        "apps/erp/app/routes/x+/thing.tsx",
        'import { flags } from "@carbon/env/flags.server";'
      )
    ).toHaveLength(0);
  });
});
