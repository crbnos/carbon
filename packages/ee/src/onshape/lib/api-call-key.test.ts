// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { describe, expect, it } from "vitest";
import { apiCallPathKey } from "./api-call-key";

describe("apiCallPathKey", () => {
  it("counts every call to one endpoint under one key", () => {
    expect(
      apiCallPathKey("/api/v10/translations/5f1e2d3c4b5a69788796a5b4")
    ).toBe("/api/v10/translations/{id}");
    expect(
      apiCallPathKey(
        "/api/v10/assemblies/d/5f1e2d3c4b5a69788796a5b4/w/0a1b2c3d4e5f60718293a4b5/e/aaaabbbbccccddddeeeeffff/bom?indented=true"
      )
    ).toBe("/api/v10/assemblies/d/{id}/w/{id}/e/{id}/bom");
  });

  it("replaces part ids and other non-word segments", () => {
    expect(
      apiCallPathKey("/api/v10/metadata/d/abc123/v/def456/e/ghi789/p/JHD")
    ).toBe("/api/v10/metadata/d/{id}/v/{id}/e/{id}/p/{id}");
  });
});
